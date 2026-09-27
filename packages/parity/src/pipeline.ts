// One fixture end to end through the public compile entry, then both lanes:
//   linux-dragon-layout: internal ios layout projection -> validator -> Dragon layout -> 1 device px against authored Chrome;
//   chrome-dual: Dragon's web output rendered in Chrome against the authored rendering, boxes and computed values exactly.
import type { Browser } from 'playwright';
import type { LayoutInput, LayoutRect, LayoutUnsupported } from '@dragon/layout';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '@dragon/layout';
import type { CompilerFaults, Diagnostic } from 'dragon';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS, resolvedColors, WEB_CSS_PATH, webClassMap } from 'dragon';
import type { WebCapture } from './capture.ts';
import { captureFixture } from './capture.ts';
import type { Comparison } from './compare.ts';
import { compareLayout } from './compare.ts';
import type { DualComparison } from './dual.ts';
import { compareDual } from './dual.ts';
import { compiledFixtureHtml, PROJECT_ID, readFixture } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { ENVIRONMENT } from './fixtures.ts';

export type DiagnosticSummary = { readonly code: string; readonly message: string; readonly spanText: string | null; readonly targets: readonly string[] };

export type LaneStatus = 'pass' | 'fail' | 'not-run';

export type FixtureOutcome = {
  readonly id: string;
  readonly kind: FixtureSpec['kind'];
  readonly status: 'pass' | 'fail';
  readonly reason: string | null;
  readonly lanes: { readonly 'linux-dragon-layout': LaneStatus; readonly 'chrome-dual': LaneStatus };
  readonly diagnostics: readonly DiagnosticSummary[];
  readonly unsupported: LayoutUnsupported | null;
  readonly comparison: Comparison | null;
  readonly dual: DualComparison | null;
  readonly features: { readonly ios: readonly string[]; readonly web: readonly string[] };
  readonly webCss: string | null;
  readonly vector: { readonly input: LayoutInput; readonly output: readonly LayoutRect[] } | null;
};

function summarize(html: string, diagnostics: readonly Diagnostic[]): DiagnosticSummary[] {
  return diagnostics.map((d) => ({
    code: d.code,
    message: d.message,
    spanText: d.span === null ? null : html.slice(d.span.start, d.span.end),
    targets: [...d.targets],
  }));
}

export type RunOptions = {
  /** The live (or committed) authored capture; required for layout fixtures. */
  readonly authored: WebCapture | null;
  readonly faults: CompilerFaults;
};

export async function runFixture(spec: FixtureSpec, browser: Browser, opts: RunOptions = { authored: null, faults: NO_FAULTS }): Promise<FixtureOutcome> {
  const { html, input } = readFixture(spec.id);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: opts.faults });
  const compiled = project.compile(input);
  const diagnostics = summarize(html, compiled.diagnostics);
  const features = { ios: compiledFeatures(compiled, 'ios'), web: compiledFeatures(compiled, 'web') };
  const projection = iosLayoutProjection(compiled, ENVIRONMENT);
  const webOut = compiled.outputs.web;
  const webCss = webOut.kind === 'ready' ? (webOut.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? null) : null;
  const base = { id: spec.id, kind: spec.kind, diagnostics, features, webCss, unsupported: null, comparison: null, dual: null, vector: null };
  const notRun = { 'linux-dragon-layout': 'not-run', 'chrome-dual': 'not-run' } as const;

  if (spec.kind === 'reject') {
    const hit = diagnostics.find((d) => d.code === spec.expect.code && d.spanText === spec.expect.spanText && (d.targets.length === 0 || d.targets.includes('ios')));
    const blocked = compiled.outputs.ios.kind === 'blocked' && compiled.targets.ios === 'blocked' && webOut.kind === 'blocked' && compiled.targets.web === 'blocked';
    const ok = hit !== undefined && blocked && projection.kind === 'blocked' && webCss === null && !compiled.ok;
    return {
      ...base,
      lanes: notRun,
      status: ok ? 'pass' : 'fail',
      reason: ok ? null : `expected ${spec.expect.code} on "${spec.expect.spanText}" with blocked ios and web outputs, no layout projection and no web files`,
    };
  }

  const fail = (reason: string, extra: Partial<FixtureOutcome> = {}): FixtureOutcome => ({ ...base, lanes: notRun, status: 'fail', reason, ...extra });
  if (compiled.outputs.ios.kind === 'blocked' || projection.kind === 'blocked') {
    return fail(`ios output blocked: ${diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  }
  if (webCss === null) return fail(`web output not ready: ${diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}`);
  if (opts.authored === null) return fail('no authored Chrome capture');
  const authored = opts.authored;

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
  const classOf = webClassMap(compiled);
  const colors = resolvedColors(compiled);
  if (classOf === null || colors === null) return fail('the compiled result has no web class map or resolved colours');
  const compiledCapture = await captureFixture(browser, spec.id, compiledFixtureHtml(html, webCss, classOf), ENVIRONMENT);
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
