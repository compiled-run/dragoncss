// One numeric test through Dragon: translate, gate with the compiler for the target, then the parity lane's layout path (compile
// with the native projection, validate, lay out with the reference measurer) and check-layout's assertions.
import type { LayoutInput, LayoutRect } from '@dragon/layout';
import { layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import type { Diagnostic, Environment, FrontEndResult } from 'dragon';
import { createProjectWith, nativeLayoutProjection, NO_FAULTS } from 'dragon';
import { fixtureToInput, PROJECT_ID } from '../../parity/src/fixture-reader.ts';
import { spanText } from '../../parity/src/pipeline.ts';
import { REFERENCE_PLATFORM } from '../../parity/src/platform.ts';
import type { SubtestResult } from './assertions.ts';
import { DomView, evaluate, unsupportedAssertion } from './assertions.ts';
import type { ReadWpt, Sidecar, Translation } from './translate.ts';
import { translate, WPT_VIEWPORT } from './translate.ts';

/** The WPT environment: 800x600 at DPR 1, left to right, with the UA root font (WPT pages do not set Ahem on the root). */
export const WPT_ENVIRONMENT: Environment = { viewport: { ...WPT_VIEWPORT }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' };

export type Target = 'web';
export const TARGETS: readonly Target[] = ['web'];

export type DragonOutcome =
  | { readonly status: 'not-runnable'; readonly missing: string }
  | {
      readonly status: 'pass' | 'fail';
      readonly subtests: { readonly pass: number; readonly total: number };
      readonly checks: { readonly pass: number; readonly total: number };
      readonly results: readonly SubtestResult[];
    };

export type Fixture = { readonly id: string; readonly html: string; readonly sidecar: Sidecar };

export type NumericRun = {
  readonly outcome: DragonOutcome;
  /** The translated fixtures and their sidecars (one per snapshot state; one for a static test), when the translator produced them. */
  readonly fixtures: readonly Fixture[];
};

const blocks = (d: Diagnostic, target: string): boolean => d.severity === 'error' && (d.target === null || d.target === target);

/** A not-runnable reason from a diagnostic: its code and the profile feature it names, or its source text. */
export function diagnosticReason(input: FrontEndResult, d: Diagnostic): string {
  const where = d.profile !== null ? d.profile.feature : (spanText(input, d.origin) ?? d.target ?? '');
  return `${d.code}:${where.replace(/\s+/g, ' ').trim().slice(0, 80)}`;
}

function referenceMeasurer() {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}

const OPTIONS = { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: WPT_ENVIRONMENT.rootFont } as const;

export type LaidOut =
  | { readonly kind: 'blocked'; readonly missing: string }
  | { readonly kind: 'laid-out'; readonly input: LayoutInput; readonly boxes: readonly LayoutRect[] };

/**
 * The gate and the parity lane's layout path for a translated fixture: Dragon's check for the target alone (its first blocking
 * diagnostic is the reason), then the cascade guard, then beforeLayout's reason if any, then the native projection, validation
 * and layout with the reference measurer.
 */
export function layOutTranslation(t: Extract<Translation, { kind: 'fixture' }>, target: Target, beforeLayout: () => string | null = () => null): LaidOut {
  const blocked = (missing: string): LaidOut => ({ kind: 'blocked', missing });
  let input: FrontEndResult;
  try {
    input = fixtureToInput(t.id, t.html);
  } catch (e) {
    return blocked(`translate:fixture-reader:${(e as Error).message.slice(0, 60)}`);
  }
  const report = createProjectWith({ projectId: PROJECT_ID, targets: { [target]: {} } as { web: object } }, OPTIONS).check(input);
  const first = report.diagnostics.find((d) => blocks(d, target));
  if (first !== undefined) return blocked(diagnosticReason(input, first));
  if (t.guard !== null) return blocked(t.guard);
  const before = beforeLayout();
  if (before !== null) return blocked(before);
  const compiled = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, OPTIONS).compile(input);
  const projection = nativeLayoutProjection(compiled, WPT_ENVIRONMENT, []);
  if (projection.kind === 'blocked') {
    const d = compiled.diagnostics.find((x) => blocks(x, 'ios'));
    return blocked(`layout-projection:${d === undefined ? projection.reason.slice(0, 60) : diagnosticReason(input, d)}`);
  }
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) return blocked(`layout-input:${validated.errors[0]?.code ?? 'invalid'}`);
  const result = layoutWithFaults(validated.input, referenceMeasurer(), NO_ENGINE_FAULTS);
  if (result.kind === 'unsupported') return blocked(`engine:${result.unsupported.code}`);
  return { kind: 'laid-out', input: validated.input, boxes: result.boxes as readonly LayoutRect[] };
}

/** Runs a translated fixture; refusals and the gate come first, then the cascade guard and the assertion kinds. */
export function runTranslation(t: Translation, target: Target): NumericRun {
  if (t.kind === 'refused') return { outcome: { status: 'not-runnable', missing: t.missing }, fixtures: [] };
  const fixture = { id: t.id, html: t.html, sidecar: t.sidecar };
  const laid = layOutTranslation(t, target, () => unsupportedAssertion(t.sidecar, (n) => t.elements.get(n)?.tag));
  if (laid.kind === 'blocked') return { outcome: { status: 'not-runnable', missing: laid.missing }, fixtures: [fixture] };
  const results = evaluate(t.sidecar, new DomView(laid.input, laid.boxes, t.elements));
  const checks = results.flatMap((s) => s.checks);
  const passed = results.filter((s) => s.pass).length;
  return {
    outcome: {
      status: passed === results.length ? 'pass' : 'fail',
      subtests: { pass: passed, total: results.length },
      checks: { pass: checks.filter((c) => c.pass).length, total: checks.length },
      results,
    },
    fixtures: [fixture],
  };
}

/**
 * A script-driven test from its snapshot states: each state is its own case; the file is not runnable when any state is not
 * (the first state's reason), and passes when every subtest of every state passes.
 */
export function runTranslations(ts: readonly Translation[], target: Target): NumericRun {
  const runs = ts.map((t) => runTranslation(t, target));
  const fixtures = runs.flatMap((r) => r.fixtures);
  const blocked = runs.find((r) => r.outcome.status === 'not-runnable');
  if (blocked !== undefined) return { outcome: blocked.outcome, fixtures };
  const results = runs.flatMap((r) => (r.outcome.status === 'not-runnable' ? [] : r.outcome.results));
  const checks = results.flatMap((s) => s.checks);
  const passed = results.filter((s) => s.pass).length;
  return {
    outcome: {
      status: passed === results.length ? 'pass' : 'fail',
      subtests: { pass: passed, total: results.length },
      checks: { pass: checks.filter((c) => c.pass).length, total: checks.length },
      results,
    },
    fixtures,
  };
}

export function runNumeric(path: string, source: string, commit: string, target: Target, readWpt: ReadWpt): NumericRun {
  return runTranslation(translate(path, source, commit, readWpt), target);
}
