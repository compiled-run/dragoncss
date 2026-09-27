// One fixture end to end through the public compile entry, then both lanes for every case:
//   linux-dragon-layout: internal ios layout projection -> validator -> Dragon layout -> 1 device px against authored Chrome;
//   chrome-dual: Dragon's web output rendered in Chrome against the authored rendering, boxes and computed values exactly.
import type { Browser } from 'playwright';
import type { LayoutInput, LayoutRect, LayoutUnsupported } from '@dragon/layout';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '@dragon/layout';
import type { Assignment, CompilerFaults, Compiled, Diagnostic, FrontEndResult, Origin } from 'dragon';
import { compiledCases, compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS, resolvedColors, WEB_CSS_PATH, webClassMap } from 'dragon';
import type { WebCapture } from './capture.ts';
import { captureFixture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf, expectedCaseCount, fixtureInput } from './cases.ts';
import type { Comparison } from './compare.ts';
import { compareLayout } from './compare.ts';
import type { DualComparison } from './dual.ts';
import { compareDual } from './dual.ts';
import { PROJECT_ID } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { ENVIRONMENT } from './fixtures.ts';

export type DiagnosticSummary = {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly spanText: string | null;
  readonly target: string | null;
  readonly fix: 'edit' | 'manual' | null;
};

export type LaneStatus = 'pass' | 'fail' | 'not-run';

export type CaseOutcome = {
  readonly id: string;
  readonly fixture: string;
  readonly index: number;
  readonly assignment: Assignment;
  readonly isInitial: boolean;
  readonly status: 'pass' | 'fail';
  readonly reason: string | null;
  readonly lanes: { readonly 'linux-dragon-layout': LaneStatus; readonly 'chrome-dual': LaneStatus };
  readonly unsupported: LayoutUnsupported | null;
  readonly comparison: Comparison | null;
  readonly dual: DualComparison | null;
  readonly features: { readonly ios: readonly string[]; readonly web: readonly string[] };
  readonly vector: { readonly input: LayoutInput; readonly output: readonly LayoutRect[] } | null;
};

export type FixtureOutcome = {
  readonly id: string;
  readonly format: FixtureSpec['format'];
  readonly kind: FixtureSpec['kind'];
  readonly status: 'pass' | 'fail';
  readonly reason: string | null;
  readonly diagnostics: readonly DiagnosticSummary[];
  /** Cases from the source (the product of the free states' domains) and the cases Dragon enumerated. */
  readonly expectedCases: number;
  readonly dragonCases: number;
  readonly cases: readonly CaseOutcome[];
  readonly webCss: string | null;
};

export function spanText(input: FrontEndResult, origin: Origin): string | null {
  if (origin.kind !== 'authored') return null;
  const src = input.snapshot.sources.find((s) => s.ref.uri === origin.span.source.uri);
  return src === undefined ? null : src.text.slice(origin.span.start, origin.span.end);
}

function summarize(input: FrontEndResult, diagnostics: readonly Diagnostic[]): DiagnosticSummary[] {
  return diagnostics.map((d) => ({
    code: d.code,
    severity: d.severity,
    message: d.message,
    spanText: spanText(input, d.origin),
    target: d.target,
    fix: d.fix === null ? null : 'manual' in d.fix ? 'manual' : 'edit',
  }));
}

export type RunOptions = {
  /** The authored capture of a case: live in tests, committed for the vector and profile scripts. */
  readonly authored: (c: ParityCase) => Promise<WebCapture>;
  readonly faults: CompilerFaults;
  /** Only scripts/gen-profile-rows.ts derives: it finds which cases pass before the rows exist. */
  readonly profiles: 'enforce' | 'derive';
};

export function compileFixture(spec: FixtureSpec, faults: CompilerFaults = NO_FAULTS, profiles: 'enforce' | 'derive' = 'enforce'): { input: FrontEndResult; compiled: Compiled<'ios' | 'web'> } {
  const input = fixtureInput(spec);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles });
  return { input, compiled: project.compile(input) };
}

export async function runFixture(spec: FixtureSpec, browser: Browser, opts: RunOptions): Promise<FixtureOutcome> {
  const { input, compiled } = compileFixture(spec, opts.faults, opts.profiles);
  const diagnostics = summarize(input, compiled.diagnostics);
  const webOut = compiled.outputs.web;
  const webCss = webOut.kind === 'ready' ? (webOut.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? null) : null;
  const dragonCases = compiledCases(compiled).length;

  if (spec.kind === 'reject') {
    const hit = diagnostics.find((d) => d.code === spec.expect.code && d.spanText === spec.expect.spanText && (d.target === null || d.target === 'ios'));
    const blocked = compiled.outputs.ios.kind === 'blocked' && compiled.targets.ios === 'blocked' && webOut.kind === 'blocked' && compiled.targets.web === 'blocked';
    const noProjection = compiledCases(compiled).every((c) => iosLayoutProjection(compiled, ENVIRONMENT, c.assignment).kind === 'blocked') && iosLayoutProjection(compiled, ENVIRONMENT, []).kind === 'blocked';
    const ok = hit !== undefined && blocked && noProjection && webCss === null && !compiled.ok;
    return {
      id: spec.id, format: spec.format, kind: spec.kind, diagnostics, webCss, expectedCases: 0, dragonCases, cases: [],
      status: ok ? 'pass' : 'fail',
      reason: ok ? null : `expected ${spec.expect.code} on ${JSON.stringify(spec.expect.spanText)} with blocked ios and web outputs, no layout projection and no web files; got ${diagnostics.map((d) => `${d.code} ${JSON.stringify(d.spanText)}`).join(', ')}`,
    };
  }

  const cases = casesOf(spec, input);
  const expectedCases = expectedCaseCount(spec, input);
  const outcomes: CaseOutcome[] = [];
  for (const c of cases) outcomes.push(await runCase(c, compiled, webCss, browser, opts));
  const problems: string[] = [];
  if (cases.length !== expectedCases) problems.push(`${cases.length} cases rendered, but the domains give ${expectedCases}`);
  if (dragonCases !== expectedCases) problems.push(`Dragon enumerated ${dragonCases} cases, the source has ${expectedCases}`);
  for (const o of outcomes) if (o.status === 'fail') problems.push(`${o.id}: ${o.reason}`);
  return {
    id: spec.id, format: spec.format, kind: spec.kind, diagnostics, webCss, expectedCases, dragonCases, cases: outcomes,
    status: problems.length === 0 ? 'pass' : 'fail',
    reason: problems.length === 0 ? null : problems.join(' || '),
  };
}

async function runCase(c: ParityCase, compiled: Compiled<'ios' | 'web'>, webCss: string | null, browser: Browser, opts: RunOptions): Promise<CaseOutcome> {
  const features = { ios: compiledFeatures(compiled, 'ios', c.assignment), web: compiledFeatures(compiled, 'web', c.assignment) };
  const base = { id: c.id, fixture: c.fixture, index: c.index, assignment: c.assignment, isInitial: c.isInitial, features, unsupported: null, comparison: null, dual: null, vector: null };
  const notRun = { 'linux-dragon-layout': 'not-run', 'chrome-dual': 'not-run' } as const;
  const fail = (reason: string): CaseOutcome => ({ ...base, lanes: notRun, status: 'fail', reason });
  const projection = iosLayoutProjection(compiled, ENVIRONMENT, c.assignment);
  const errors = compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ');
  if (compiled.outputs.ios.kind === 'blocked' || projection.kind === 'blocked') return fail(`ios output blocked: ${projection.kind === 'blocked' ? projection.reason : ''} ${errors}`);
  if (webCss === null) return fail(`web output not ready: ${errors}`);
  const authored = await opts.authored(c);

  // Lane linux-dragon-layout.
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) return fail(`layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}`);
  const result = layout(validated.input, ahemMeasurer);
  let layoutStatus: LaneStatus;
  let comparison: Comparison | null = null;
  let unsupported: LayoutUnsupported | null = null;
  const reasons: string[] = [];
  if (result.kind === 'unsupported') {
    unsupported = result.unsupported;
    layoutStatus = 'fail';
    reasons.push(`linux-dragon-layout: LayoutUnsupported ${unsupported.code} at ${unsupported.nodeId} (${unsupported.specSection}): ${unsupported.detail}`);
  } else {
    comparison = compareLayout(authored, absoluteRects(validated.input, result.boxes), ENVIRONMENT);
    layoutStatus = comparison.pass ? 'pass' : 'fail';
    if (!comparison.pass) reasons.push(`linux-dragon-layout: ${comparison.problems.join('; ')}`);
  }

  // Lane chrome-dual.
  const classOf = webClassMap(compiled, c.assignment);
  const colors = resolvedColors(compiled, c.assignment);
  if (classOf === null || colors === null) return fail('the compiled result has no web class map or resolved colours for this case');
  const compiledCapture = await captureFixture(browser, c.id, c.compiledHtml(webCss, classOf), ENVIRONMENT);
  const dual = compareDual(authored, compiledCapture, colors);
  if (!dual.pass) reasons.push(`chrome-dual: ${dual.problems.join('; ')}`);

  const pass = layoutStatus === 'pass' && dual.pass;
  return {
    ...base,
    lanes: { 'linux-dragon-layout': layoutStatus, 'chrome-dual': dual.pass ? 'pass' : 'fail' },
    status: pass ? 'pass' : 'fail',
    reason: pass ? null : reasons.join(' | '),
    unsupported,
    comparison,
    dual,
    vector: layoutStatus === 'pass' && result.kind === 'ok' ? { input: validated.input, output: result.boxes } : null,
  };
}

/** Authored captures taken live in the pinned Chrome. */
export const liveAuthored = (browser: Browser) => (c: ParityCase): Promise<WebCapture> => captureFixture(browser, c.id, c.authoredHtml, ENVIRONMENT);
