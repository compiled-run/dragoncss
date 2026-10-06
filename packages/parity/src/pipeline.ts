// One fixture end to end through the public compile entry, then both lanes for every case in every environment:
//   linux-dragon-layout: internal ios layout projection -> validator -> Dragon layout -> 1 device px against authored Chrome;
//   chrome-dual: Dragon's web output rendered in Chrome against the authored rendering, boxes and computed values exactly.
import type { Browser } from 'playwright';
import type { EngineFaults, LayoutInput, LayoutRect, LayoutUnsupported } from '@dragon/layout';
import { absoluteRects, layoutWithFaults, measurerFor, validateLayoutInput } from '@dragon/layout';
import type { Assignment, CompilerFaults, Compiled, Diagnostic, Environment, FrontEndResult, Origin, Scalar, TextTopologyEntry } from 'dragon';
import { compiledCases, compiledFeatures, createProjectWith, interactionPartitionOf, iosLayoutProjection, laneOnlyNative, nativeLayoutProjection, NO_FAULTS, resolvedColors, resolvedTextColors, svgScenes, textTopology, WEB_CSS_PATH, webClassMap } from 'dragon';
import type { WebCapture } from './capture.ts';
import { captureFixture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf, expectedCaseCount, fixtureInput, forcedCasesOf } from './cases.ts';
import { INTERACTION_FORCED } from './fixture-groups/interaction.ts';
import { prepareOf } from './forced-pseudo.ts';
import type { Comparison } from './compare.ts';
import { compareLayout } from './compare.ts';
import { compareSvg } from './svg-compare.ts';
import type { DualComparison } from './dual.ts';
import { compareDual } from './dual.ts';
import { PROJECT_ID } from './fixture-reader.ts';
import type { FixtureSpec } from './fixtures.ts';
import { ENVIRONMENT, environmentsOf } from './fixtures.ts';
import { fontMapOf, withFontMapAssets } from './fixture-groups/fonts.ts';
import { fontDataUrl } from './font-reference.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
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

export type Direction = Environment['direction'];

export type CaseOutcome = {
  readonly id: string;
  readonly fixture: string;
  readonly index: number;
  readonly direction: Direction;
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

/** MF1 per environment: cases declared by hand (tree fixtures; 1 for HTML), rendered by the parity renderer, enumerated by Dragon. */
export type EnvironmentCount = { readonly direction: Direction; readonly expected: number; readonly renderer: number; readonly dragon: number };

export type FixtureOutcome = {
  readonly id: string;
  readonly format: FixtureSpec['format'];
  readonly kind: FixtureSpec['kind'];
  readonly status: 'pass' | 'fail';
  readonly reason: string | null;
  readonly diagnostics: readonly DiagnosticSummary[];
  /** Totals over the fixture's environments of the per-environment counts below. */
  readonly expectedCases: number;
  readonly rendererCases: number;
  readonly dragonCases: number;
  readonly environments: readonly EnvironmentCount[];
  readonly cases: readonly CaseOutcome[];
  /** Dragon's web CSS per environment direction; rtl only for tree fixtures. */
  readonly webCss: { readonly ltr: string | null; readonly rtl: string | null };
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
  /** The determinism check (S5 (c)) compiles an order-shuffled copy of the fixture input; every other run passes the input as read. */
  readonly transformInput?: (input: FrontEndResult) => FrontEndResult;
};

/** The engine measurer of the reference platform; any other platform is refused (docs/decisions.md). */
function referenceMeasurer() {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}

/** The front-end input a fixture compiles from; a fonts fixture's pinned faces' vendored files ride along as snapshot assets (TXT1-C). */
export function fixtureCompileInput(spec: FixtureSpec): FrontEndResult {
  const fonts = fontMapOf(spec.id);
  return fonts === undefined ? fixtureInput(spec) : withFontMapAssets(fixtureInput(spec), fonts);
}

const enforcedCompiles = new Map<string, Compiled<'ios' | 'web'>>();

/** compileFixture(spec, NO_FAULTS, 'enforce', direction).compiled, compiled once per fixture and direction in this process. */
export function enforcedCompile(spec: FixtureSpec, direction: Direction): Compiled<'ios' | 'web'> {
  const key = `${spec.id} ${direction}`;
  let c = enforcedCompiles.get(key);
  if (c === undefined) {
    c = compileFixture(spec, NO_FAULTS, 'enforce', direction).compiled;
    enforcedCompiles.set(key, c);
  }
  return c;
}

export function compileFixture(spec: FixtureSpec, faults: CompilerFaults = NO_FAULTS, profiles: 'enforce' | 'derive' = 'enforce', direction: Direction = 'ltr', transformInput: (input: FrontEndResult) => FrontEndResult = (i) => i): { input: FrontEndResult; compiled: Compiled<'ios' | 'web'> } {
  const fonts = fontMapOf(spec.id);
  const input = transformInput(fixtureCompileInput(spec));
  const rootFont = spec.kind === 'layout' ? spec.rootFont : 'ahem';
  // MQ-a: the native output is the @media band holding the fixed parity viewport, which is exact for every case here.
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} }, ...(fonts === undefined ? {} : { fonts }) }, { faults, profiles, direction, platform: REFERENCE_PLATFORM, rootFont, foldViewport: ENVIRONMENT.viewport, interactionLanes: true });
  return { input, compiled: project.compile(input) };
}

/** The web CSS the chrome-dual lane renders: dragon.css with each font asset's url("fonts/...") inlined as a data: URL. */
export const webCssOf = (compiled: Compiled<'ios' | 'web'>): string | null => {
  const webOut = compiled.outputs.web;
  if (webOut.kind !== 'ready') return null;
  const css = webOut.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? null;
  return css === null ? null : inlineFontAssets(css, webOut.assets);
};

/** css with every url("fonts/...") replaced by its asset's data: URL; a url naming no asset, or an asset no url names, throws. */
export function inlineFontAssets(css: string, assets: readonly { readonly path: string; readonly bytes: Uint8Array }[]): string {
  const byPath = new Map(assets.map((a) => [a.path, a]));
  const used = new Set<string>();
  const out = css.replace(/url\("(fonts\/[^"]*)"\)/g, (_m, path: string) => {
    const a = byPath.get(path);
    if (a === undefined) throw new Error(`dragon.css names ${path}, which is not a web output asset`);
    used.add(path);
    return `url("${fontDataUrl(a.bytes)}")`;
  });
  const unused = assets.filter((a) => !used.has(a.path)).map((a) => a.path);
  if (unused.length > 0) throw new Error(`web output assets that dragon.css never names: ${unused.join(', ')}`);
  return out;
}

/**
 * SELD-R2a: the forced cases of a fixture in INTERACTION_FORCED (every other fixture has none), from each direction's compile: one
 * per interaction state but none of every case, in case order.
 */
export function forcedCases(spec: FixtureSpec, compiledOf: (d: Direction) => Compiled<'ios' | 'web'> = (d) => compileFixture(spec, NO_FAULTS, 'enforce', d).compiled): ParityCase[] {
  if (!INTERACTION_FORCED.has(spec.id) || spec.kind !== 'layout') return [];
  const byDirection = new Map<Direction, Compiled<'ios' | 'web'>>();
  return casesOf(spec, fixtureInput(spec)).flatMap((c) => {
    const d = c.environment.direction;
    let compiled = byDirection.get(d);
    if (compiled === undefined) {
      compiled = compiledOf(d);
      byDirection.set(d, compiled);
    }
    return forcedCasesOf(spec, c, interactionPartitionOf(compiled, c.assignment));
  });
}

export async function runFixture(spec: FixtureSpec, browser: Browser, opts: RunOptions): Promise<FixtureOutcome> {
  const environments = environmentsOf(spec);
  const compiledBy = new Map(environments.map((e) => [e.direction, compileFixture(spec, opts.faults, opts.profiles, e.direction, opts.transformInput)] as const));
  const { input, compiled } = compiledBy.get('ltr') as { input: FrontEndResult; compiled: Compiled<'ios' | 'web'> };
  const rtl = compiledBy.get('rtl');
  const diagnostics = summarize(input, compiled.diagnostics);
  const webCss = { ltr: webCssOf(compiled), rtl: rtl === undefined ? null : webCssOf(rtl.compiled) };
  const dragonCases = compiledCases(compiled).length;

  if (spec.kind === 'reject') {
    const prefix = spec.expect.messagePrefix;
    const hit = diagnostics.find((d) => d.code === spec.expect.code && d.spanText === spec.expect.spanText && (d.target === null || d.target === 'ios') && (prefix === null || d.message.startsWith(prefix)));
    const blocked = compiled.outputs.ios.kind === 'blocked' && compiled.targets.ios === 'blocked' && compiled.outputs.web.kind === 'blocked' && compiled.targets.web === 'blocked';
    const noProjection = compiledCases(compiled).every((c) => iosLayoutProjection(compiled, ENVIRONMENT, c.assignment).kind === 'blocked') && iosLayoutProjection(compiled, ENVIRONMENT, []).kind === 'blocked';
    const ok = hit !== undefined && blocked && noProjection && webCss.ltr === null && !compiled.ok;
    return {
      id: spec.id, format: spec.format, kind: spec.kind, diagnostics, webCss, expectedCases: 0, rendererCases: 0, dragonCases, environments: [], cases: [],
      status: ok ? 'pass' : 'fail',
      reason: ok ? null : `expected ${spec.expect.code} on ${JSON.stringify(spec.expect.spanText)}${prefix === null ? '' : ` with a message starting ${JSON.stringify(prefix)}`} with blocked ios and web outputs, no layout projection and no web files; got ${diagnostics.map((d) => `${d.code} ${JSON.stringify(d.spanText)}`).join(', ')}`,
    };
  }

  const cases = casesOf(spec, input);
  const declared = spec.format === 'tree' ? readTreeExpectation(spec.id) : null;
  const perEnvironment = declared === null ? 1 : declared.cases;
  const outcomes: CaseOutcome[] = [];
  for (const c of cases) {
    const own = compiledBy.get(c.environment.direction) as { compiled: Compiled<'ios' | 'web'> };
    outcomes.push(await runCase(c, own.compiled, webCssOf(own.compiled), browser, opts));
  }
  const problems: string[] = [];
  const counts: EnvironmentCount[] = [];
  for (const e of environments) {
    const own = (compiledBy.get(e.direction) as { compiled: Compiled<'ios' | 'web'> }).compiled;
    const rendered = cases.filter((c) => c.environment.direction === e.direction).length;
    const dragon = compiledCases(own).length;
    counts.push({ direction: e.direction, expected: perEnvironment, renderer: rendered, dragon });
    if (spec.format === 'tree') {
      if (declared === null) problems.push('a layout tree fixture must declare expected free states, cases, initial assignment and text topology in fixture.json');
      else problems.push(...caseCountProblems(declared, input, own).map((p) => `${e.direction}: ${p}`), ...topologyProblems(declared, input, outcomes.filter((o) => o.direction === e.direction)).map((p) => `${e.direction}: ${p}`));
    }
    if (rendered !== perEnvironment) problems.push(`${e.direction}: ${rendered} cases rendered, but ${perEnvironment} are declared`);
    if (expectedCaseCount(spec, input) !== perEnvironment) problems.push(`${e.direction}: the renderer's domains give ${expectedCaseCount(spec, input)} cases, but ${perEnvironment} are declared`);
    if (dragon !== perEnvironment) problems.push(`${e.direction}: Dragon enumerated ${dragon} cases, but ${perEnvironment} are declared`);
  }
  // The forced cases run after the counted ones and are not counted: MF1 counts the reachable assignments only.
  for (const c of forcedCases(spec, (d) => (compiledBy.get(d) as { compiled: Compiled<'ios' | 'web'> }).compiled)) {
    const own = compiledBy.get(c.environment.direction) as { compiled: Compiled<'ios' | 'web'> };
    // A forced case's layout is compared, but it adds no engine vector: the vector corpora cover the counted cases.
    outcomes.push({ ...(await runCase(c, own.compiled, webCssOf(own.compiled), browser, opts)), vector: null });
  }
  for (const o of outcomes) if (o.status === 'fail') problems.push(`${o.id}: ${o.reason}`);
  const total = (f: (c: EnvironmentCount) => number): number => counts.reduce((n, c) => n + f(c), 0);
  return {
    id: spec.id, format: spec.format, kind: spec.kind, diagnostics, webCss, environments: counts, cases: outcomes,
    expectedCases: total((c) => c.expected), rendererCases: total((c) => c.renderer), dragonCases: total((c) => c.dragon),
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

/**
 * docs/api.md §10: every case's text topology equals the hand-declared mapping in its environment direction; inherited text
 * styles name the insertion parent.
 */
export function topologyProblems(declared: TreeExpectation, input: FrontEndResult, cases: readonly CaseOutcome[]): string[] {
  const problems: string[] = [];
  for (const c of cases) {
    const holds = (t: readonly [string, string, Scalar]): boolean => c.assignment.some((e) => e.state.instance === t[0] && e.state.state === t[1] && e.value === t[2]);
    const expected = declared.textTopology.filter((e) => (e.when === undefined ? [] : e.when).every(holds)).map((e) => ({
      address: e.address, component: e.component, template: e.template, at: e.at, ownerInstance: e.ownerInstance, insertionParent: e.insertionParent, context: e.context[c.direction],
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
  // SELD-R2: a case only the lanes compile on native (a user's compile refuses it there) proves no native row; web rows only.
  const features = { ios: laneOnlyNative(compiled, 'ios') ? [] : compiledFeatures(compiled, 'ios', c.assignment), web: compiledFeatures(compiled, 'web', c.assignment) };
  const topology = textTopology(compiled, c.assignment);
  const base = { id: c.id, fixture: c.fixture, index: c.index, direction: c.environment.direction, assignment: c.assignment, isInitial: c.isInitial, features, unsupported: null, comparison: null, dual: null, vector: null, topology, textLines: [] };
  const notRun = { 'linux-dragon-layout': 'not-run', 'chrome-dual': 'not-run' } as const;
  const fail = (reason: string): CaseOutcome => ({ ...base, lanes: notRun, status: 'fail', reason });
  const state = c.interaction ?? null;
  const projection = nativeLayoutProjection(compiled, c.environment, c.assignment, state);
  const errors = compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('; ');
  if (compiled.outputs.ios.kind === 'blocked' || projection.kind === 'blocked') return fail(`ios output blocked: ${projection.kind === 'blocked' ? projection.reason : ''} ${errors}`);
  if (webCss === null) return fail(`web output not ready: ${errors}`);
  const authored = await opts.authored(c);

  // Lane linux-dragon-layout.
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) return fail(`layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}`);
  const result = layoutWithFaults(validated.input, referenceMeasurer(), opts.engineFaults);
  let layoutStatus: LaneStatus;
  let comparison: Comparison | null = null;
  let unsupported: LayoutUnsupported | null = null;
  const reasons: string[] = [];
  if (result.kind === 'unsupported') {
    unsupported = result.unsupported;
    layoutStatus = 'fail';
    reasons.push(`linux-dragon-layout: LayoutUnsupported ${unsupported.code} at ${unsupported.nodeId} (${unsupported.specSection}): ${unsupported.detail}`);
  } else {
    comparison = compareLayout(authored, absoluteRects(result.boxes), validated.input, c.environment);
    // SVG-a1: the shapes' outline differential (svg-compare.ts) belongs to the layout lane.
    const scenes = svgScenes(compiled, c.assignment) ?? [];
    const svgProblems = compareSvg(authored, scenes, absoluteRects(result.boxes), validated.input);
    if (svgProblems.length > 0) comparison = { ...comparison, pass: false, problems: [...comparison.problems, ...svgProblems] };
    layoutStatus = comparison.pass ? 'pass' : 'fail';
    if (!comparison.pass) reasons.push(`linux-dragon-layout: ${comparison.problems.join('; ')}`);
  }

  // Lane chrome-dual.
  const classOf = webClassMap(compiled, c.assignment);
  const colors = resolvedColors(compiled, c.assignment, state);
  const textColors = resolvedTextColors(compiled, c.assignment, state);
  if (classOf === null || colors === null || textColors === null) return fail('the compiled result has no web class map or resolved colours for this case');
  const compiledCapture = await captureFixture(browser, c.id, c.compiledHtml(webCss, classOf), c.environment, c.computedExtra, prepareOf(c));
  const dual = compareDual(authored, compiledCapture, colors, textColors, c.computedExtra);
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

/** Authored captures taken live in the pinned Chrome, in the case's environment. */
export const liveAuthored = (browser: Browser) => (c: ParityCase): Promise<WebCapture> => captureFixture(browser, c.id, c.authoredHtml, c.environment, c.computedExtra, prepareOf(c));
