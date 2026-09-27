// One fixture end to end through the public compile entry, then both lanes for every case:
//   linux-dragon-layout: internal ios layout projection -> validator -> Dragon layout -> 1 device px against authored Chrome;
//   chrome-dual: Dragon's web output rendered in Chrome against the authored rendering, boxes and computed values exactly.
import type { Browser } from 'playwright';
import type { EngineFaults, LayoutInput, LayoutRect, LayoutUnsupported } from '@dragon/layout';
import { absoluteRects, ahemMeasurer, layoutWithFaults, validateLayoutInput } from '@dragon/layout';
import type { Assignment, CompilerFaults, Compiled, Diagnostic, FrontEndResult, Origin, Scalar, TextTopologyEntry } from 'dragon';
import { compiledCases, compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS, resolvedColors, resolvedTextColors, textTopology, WEB_CSS_PATH, webClassMap } from 'dragon';
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
import { authoredModel } from './render.ts';
import type { TreeExpectation } from './tree-fixture.ts';
import { readTreeExpectation } from './tree-fixture.ts';

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
  /** Dragon's text topology of this case (internal textTopology); null when the case did not resolve. */
  readonly topology: readonly TextTopologyEntry[] | null;
  /** Per laid-out text node: its compiler-computed context and the number of line fragments Dragon laid out. */
  readonly textLines: readonly { readonly address: string; readonly context: string; readonly lines: number }[];
};

export type FixtureOutcome = {
  readonly id: string;
  readonly format: FixtureSpec['format'];
  readonly kind: FixtureSpec['kind'];
  readonly status: 'pass' | 'fail';
  readonly reason: string | null;
  readonly diagnostics: readonly DiagnosticSummary[];
  /** Cases declared by hand (tree fixtures, MF1; 1 for HTML), rendered by the parity renderer, and enumerated by Dragon. */
  readonly expectedCases: number;
  readonly rendererCases: number;
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
  readonly engineFaults: EngineFaults;
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
      id: spec.id, format: spec.format, kind: spec.kind, diagnostics, webCss, expectedCases: 0, rendererCases: 0, dragonCases, cases: [],
      status: ok ? 'pass' : 'fail',
      reason: ok ? null : `expected ${spec.expect.code} on ${JSON.stringify(spec.expect.spanText)} with blocked ios and web outputs, no layout projection and no web files; got ${diagnostics.map((d) => `${d.code} ${JSON.stringify(d.spanText)}`).join(', ')}`,
    };
  }

  const cases = casesOf(spec, input);
  const declared = spec.format === 'tree' ? readTreeExpectation(spec.id) : null;
  const expectedCases = declared === null ? 1 : declared.cases;
  const outcomes: CaseOutcome[] = [];
  for (const c of cases) outcomes.push(await runCase(c, compiled, webCss, browser, opts));
  const problems: string[] = [];
  if (spec.format === 'tree') {
    if (declared === null) problems.push('a layout tree fixture must declare expected free states, cases, initial assignment and text topology in fixture.json');
    else problems.push(...caseCountProblems(declared, input, compiled), ...topologyProblems(declared, input, outcomes));
  }
  if (cases.length !== expectedCases) problems.push(`${cases.length} cases rendered, but ${expectedCases} are declared`);
  if (expectedCaseCount(spec, input) !== expectedCases) problems.push(`the renderer's domains give ${expectedCaseCount(spec, input)} cases, but ${expectedCases} are declared`);
  if (dragonCases !== expectedCases) problems.push(`Dragon enumerated ${dragonCases} cases, but ${expectedCases} are declared`);
  for (const o of outcomes) if (o.status === 'fail') problems.push(`${o.id}: ${o.reason}`);
  return {
    id: spec.id, format: spec.format, kind: spec.kind, diagnostics, webCss, expectedCases, rendererCases: cases.length, dragonCases, cases: outcomes,
    status: problems.length === 0 ? 'pass' : 'fail',
    reason: problems.length === 0 ? null : problems.join(' || '),
  };
}

type Term = { readonly instance: string; readonly state: string; readonly value: Scalar };
const terms = (a: Assignment): Term[] => a.map((e) => ({ instance: e.state.instance, state: e.state.state, value: e.value }));

/** MF1: the declared free states, case count and initial assignment against the renderer's and Dragon's, independently. */
export function caseCountProblems(declared: TreeExpectation, input: FrontEndResult, compiled: Compiled<'ios' | 'web'>): string[] {
  const problems: string[] = [];
  const model = authoredModel(input);
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const rendererFree = model.free.map((f) => ({ instance: f.instance, state: f.state, domain: f.domain }));
  if (!same(rendererFree, declared.freeStates)) problems.push(`renderer free states ${JSON.stringify(rendererFree)} differ from the declared ${JSON.stringify(declared.freeStates)}`);
  if (model.assignments.length !== declared.cases) problems.push(`the renderer enumerates ${model.assignments.length} cases, ${declared.cases} are declared`);
  const rendererInitial = model.assignments[model.initialIndex];
  if (rendererInitial === undefined || !same(terms(rendererInitial), declared.initial)) problems.push(`the renderer's initial case differs from the declared initial assignment`);
  const dragon = compiledCases(compiled);
  if (dragon.length !== declared.cases) problems.push(`Dragon enumerates ${dragon.length} cases, ${declared.cases} are declared`);
  const dragonInitial = dragon.filter((k) => k.isInitial);
  if (dragonInitial.length !== 1 || !same(terms((dragonInitial[0] as { assignment: Assignment }).assignment), declared.initial)) problems.push(`Dragon's initial case differs from the declared initial assignment`);
  const dragonFree = declared.freeStates.map((f) => ({
    instance: f.instance,
    state: f.state,
    domain: [...new Map(dragon.flatMap((k) => k.assignment.filter((e) => e.state.instance === f.instance && e.state.state === f.state).map((e) => [JSON.stringify(e.value), e.value] as const))).values()],
  }));
  const dragonStates = dragon[0] === undefined ? [] : dragon[0].assignment.map((e) => `${e.state.instance}.${e.state.state}`);
  if (!same(dragonStates, declared.freeStates.map((f) => `${f.instance}.${f.state}`)) || !same(dragonFree, declared.freeStates)) problems.push(`Dragon's free states differ from the declared ${JSON.stringify(declared.freeStates)}`);
  return problems;
}

/** docs/api.md §10: every case's text topology equals the hand-declared mapping; inherited text styles name the insertion parent. */
export function topologyProblems(declared: TreeExpectation, input: FrontEndResult, cases: readonly CaseOutcome[]): string[] {
  const problems: string[] = [];
  for (const c of cases) {
    const holds = (t: readonly [string, string, Scalar]): boolean => c.assignment.some((e) => e.state.instance === t[0] && e.state.state === t[1] && e.value === t[2]);
    const expected = declared.textTopology.filter((e) => (e.when === undefined ? [] : e.when).every(holds)).map((e) => ({
      address: e.address, component: e.component, template: e.template, at: e.at, ownerInstance: e.ownerInstance, insertionParent: e.insertionParent, context: e.context,
    }));
    if (c.topology === null) {
      problems.push(`${c.id}: no text topology`);
      continue;
    }
    const actual = c.topology.map((t) => ({
      address: t.address, component: t.component, template: t.template, at: spanText(input, t.origin), ownerInstance: t.ownerInstance, insertionParent: t.insertionParent, context: t.context,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) problems.push(`${c.id}: text topology ${JSON.stringify(actual)} differs from the declared ${JSON.stringify(expected)}`);
    for (const t of c.topology) {
      for (const [p, o] of Object.entries(t.inherited)) {
        if (o.kind !== 'inherited' || o.element !== t.insertionParent) problems.push(`${c.id}: ${t.address} ${p} is not inherited from its insertion parent ${t.insertionParent}`);
      }
    }
  }
  return problems;
}

async function runCase(c: ParityCase, compiled: Compiled<'ios' | 'web'>, webCss: string | null, browser: Browser, opts: RunOptions): Promise<CaseOutcome> {
  const features = { ios: compiledFeatures(compiled, 'ios', c.assignment), web: compiledFeatures(compiled, 'web', c.assignment) };
  const topology = textTopology(compiled, c.assignment);
  const base = { id: c.id, fixture: c.fixture, index: c.index, assignment: c.assignment, isInitial: c.isInitial, features, unsupported: null, comparison: null, dual: null, vector: null, topology, textLines: [] };
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
  const result = layoutWithFaults(validated.input, ahemMeasurer, opts.engineFaults);
  let layoutStatus: LaneStatus;
  let comparison: Comparison | null = null;
  let unsupported: LayoutUnsupported | null = null;
  const reasons: string[] = [];
  if (result.kind === 'unsupported') {
    unsupported = result.unsupported;
    layoutStatus = 'fail';
    reasons.push(`linux-dragon-layout: LayoutUnsupported ${unsupported.code} at ${unsupported.nodeId} (${unsupported.specSection}): ${unsupported.detail}`);
  } else {
    comparison = compareLayout(authored, absoluteRects(result.boxes), validated.input, ENVIRONMENT);
    layoutStatus = comparison.pass ? 'pass' : 'fail';
    if (!comparison.pass) reasons.push(`linux-dragon-layout: ${comparison.problems.join('; ')}`);
  }

  // Lane chrome-dual.
  const classOf = webClassMap(compiled, c.assignment);
  const colors = resolvedColors(compiled, c.assignment);
  const textColors = resolvedTextColors(compiled, c.assignment);
  if (classOf === null || colors === null || textColors === null) return fail('the compiled result has no web class map or resolved colours for this case');
  const compiledCapture = await captureFixture(browser, c.id, c.compiledHtml(webCss, classOf), ENVIRONMENT);
  const dual = compareDual(authored, compiledCapture, colors, textColors);
  if (!dual.pass) reasons.push(`chrome-dual: ${dual.problems.join('; ')}`);

  const pass = layoutStatus === 'pass' && dual.pass;
  const boxes = result.kind === 'ok' ? result.boxes : [];
  const textLines = (topology === null ? [] : topology).map((t) => ({
    address: t.address,
    context: t.context,
    lines: boxes.filter((b) => b.parent === t.address && b.id.startsWith(`${t.address}:line`)).length,
  }));
  return {
    ...base,
    textLines,
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
