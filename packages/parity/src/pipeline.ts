// One fixture end to end: public compile -> internal ios layout projection -> validator -> Dragon layout -> compare with Chrome.
import type { LayoutInput, LayoutRect, LayoutUnsupported } from '@dragon/layout';
import { absoluteRects, ahemMeasurer, layout, validateLayoutInput } from '@dragon/layout';
import type { Diagnostic } from 'dragon';
import type { LoweringFaults } from 'dragon';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS } from 'dragon';
import type { WebCapture } from './capture.ts';
import type { Comparison } from './compare.ts';
import { compareLayout } from './compare.ts';
import { readFixture, PROJECT_ID } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { VIEWPORT } from './fixtures.ts';

export type DiagnosticSummary = { readonly code: string; readonly message: string; readonly spanText: string | null; readonly targets: readonly string[] };

export type FixtureOutcome = {
  readonly id: string;
  readonly kind: FixtureSpec['kind'];
  readonly status: 'pass' | 'fail';
  readonly reason: string | null;
  readonly diagnostics: readonly DiagnosticSummary[];
  readonly unsupported: LayoutUnsupported | null;
  readonly comparison: Comparison | null;
  readonly features: readonly string[];
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

export function runFixture(spec: FixtureSpec, capture: WebCapture | null, faults: LoweringFaults = NO_FAULTS): FixtureOutcome {
  const { html, input } = readFixture(spec.id);
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' } } }, { faults });
  const compiled = project.compile(input);
  const diagnostics = summarize(html, compiled.diagnostics);
  const features = compiledFeatures(compiled, 'ios');
  const base = { id: spec.id, kind: spec.kind, diagnostics, features, unsupported: null, comparison: null, vector: null };
  const projection = iosLayoutProjection(compiled, VIEWPORT);

  if (spec.kind === 'reject') {
    const hit = diagnostics.find((d) => d.code === spec.expect.code && d.spanText === spec.expect.spanText && d.targets.includes('ios'));
    const blocked = compiled.outputs.ios.kind === 'blocked' && compiled.targets.ios === 'blocked';
    const ok = hit !== undefined && blocked && projection.kind === 'blocked' && !compiled.ok;
    return {
      ...base,
      status: ok ? 'pass' : 'fail',
      reason: ok ? null : `expected ${spec.expect.code} on "${spec.expect.spanText}" with a blocked ios output and no layout projection`,
    };
  }

  if (compiled.outputs.ios.kind === 'blocked' || projection.kind === 'blocked') {
    return { ...base, status: 'fail', reason: `ios output blocked: ${diagnostics.map((d) => `${d.code} ${d.message}`).join('; ')}` };
  }
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) {
    return { ...base, status: 'fail', reason: `layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}` };
  }
  const result = layout(validated.input, ahemMeasurer);
  if (result.kind === 'unsupported') {
    return { ...base, status: 'fail', unsupported: result.unsupported, reason: `LayoutUnsupported ${result.unsupported.code} at ${result.unsupported.nodeId} (${result.unsupported.specSection}): ${result.unsupported.detail}` };
  }
  if (capture === null) return { ...base, status: 'fail', reason: 'no Chrome capture' };
  const comparison = compareLayout(capture, absoluteRects(validated.input, result.boxes));
  return {
    ...base,
    status: comparison.pass ? 'pass' : 'fail',
    reason: comparison.pass ? null : comparison.problems.join('; '),
    comparison,
    vector: { input: validated.input, output: result.boxes },
  };
}
