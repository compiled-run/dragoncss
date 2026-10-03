// Device DPR (docs/research/native-strategy.md section 2): the milestone-1 layout cases captured in Chrome at the device pixel
// ratios the native lanes run at, and the DPR lane that compares the engine with them. DPR 1 captures, vectors and reports are
// untouched; every DPR set holds the same case ids.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import type { DprChromeDeviation, EngineFaults, LayoutInput, LayoutRect } from '@dragon/layout';
import { absoluteRects, dprChromeDeviations, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, snapEdges, validateLayoutInput } from '@dragon/layout';
import { isShapedInput, joinHyphenRects } from './text-latin-run.ts';
import { referenceShapedMeasurer } from './text-shaper-host.ts';
import type { Compiled, Environment } from 'dragon';
import { iosLayoutProjection, NO_FAULTS } from 'dragon';
import type { WebCapture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf } from './cases.ts';
import { openPage } from './chrome.ts';
import { expectedPath } from './committed.ts';
import type { ZoomedComparison } from './compare.ts';
import { compareZoomedLayout, GATE_DEVICE_PX } from './compare.ts';
import type { FixtureSpec } from './fixtures.ts';
import { FIXTURES } from './fixtures.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import type { Projection } from './pipeline.ts';
import { compileFixture } from './pipeline.ts';

/** The pixel ratios both native platforms run at (owner decision, Native lanes, milestone 2). */
export const SHARED_DPRS: readonly number[] = [2, 3];

/** Extras run by one platform only, each named with its platform; never a substitute for a shared ratio. */
export const EXTRA_DPRS: readonly { readonly dpr: number; readonly name: string; readonly platform: 'android' }[] = [
  { dpr: 2.625, name: 'android-extra-420dpi', platform: 'android' },
];

/** Every DPR set captured and vectored, shared first. */
export const DPRS: readonly number[] = [...SHARED_DPRS, ...EXTRA_DPRS.map((e) => e.dpr)];

/** The gate every DPR case is judged by: the one milestone-1 constant, never a literal. */
export const DPR_GATE_DEVICE_PX = GATE_DEVICE_PX;

/** A 0.5px border, as getComputedStyle reports it when Chrome's zoom really equals the DPR (floor to whole device px, then / N). */
export const ZOOM_GUARD: ReadonlyMap<number, string> = new Map([
  [2, '0.5px'],
  [3, '0.333333px'],
  [2.625, '0.380952px'],
]);

export const dprLabel = (dpr: number): string => `dpr-${dpr}`;

/** Captures live outside expected/<platform>, whose entries platform.test.ts reads as files. */
export const expectedDprDir = (dpr: number, platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-dpr/${platform}/${dprLabel(dpr)}`);
export const expectedDprPath = (caseId: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${expectedDprDir(dpr, platform)}/${caseId}.web.json`;
export const dprVectorDir = (dpr: number): string => repoPath(`packages/layout/vectors/${dprLabel(dpr)}`);
export const dprVectorPath = (caseId: string, dpr: number): string => `${dprVectorDir(dpr)}/${caseId}.json`;
export const dprSnapDir = (dpr: number): string => `${dprVectorDir(dpr)}/snap`;
export const dprSnapPath = (caseId: string, dpr: number): string => `${dprSnapDir(dpr)}/${caseId}.json`;

/** The case environment at a device pixel ratio: the milestone-1 environment with only devicePixelRatio changed. */
export function atDpr(env: Environment, dpr: number): Environment {
  return { ...env, devicePixelRatio: dpr };
}

/** Every layout case of the corpus, in fixture order: the same ids at every DPR (the DPR-1 ids). */
export function layoutCases(): { readonly spec: FixtureSpec; readonly cases: readonly ParityCase[] }[] {
  const out: { spec: FixtureSpec; cases: ParityCase[] }[] = [];
  for (const spec of FIXTURES) {
    if (spec.kind !== 'layout') continue;
    const { input } = compileFixture(spec);
    out.push({ spec, cases: casesOf(spec, input) });
  }
  return out;
}

const GUARD_HTML = '<!doctype html><html><head></head><body><div id="g" style="border-top:0.5px solid black;width:10px;height:10px"></div></body></html>';

/**
 * The zoom-applied guard: Chrome must lay out in zoomed units (--force-device-scale-factor=N), not only report
 * devicePixelRatio N (a context deviceScaleFactor alone). Throws unless the 0.5px border computes to the ZOOM_GUARD value.
 */
export async function zoomGuard(browser: Browser, dpr: number): Promise<string> {
  const want = ZOOM_GUARD.get(dpr);
  if (want === undefined) throw new Error(`no zoom guard value for DPR ${dpr}`);
  const page = await openPage(browser, GUARD_HTML, { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ahem' });
  try {
    const got = await page.evaluate(() => getComputedStyle(document.getElementById('g') as Element).borderTopWidth);
    if (got !== want) throw new Error(`zoom guard: a 0.5px border computes to ${got} at DPR ${dpr}, not ${want}; Chrome is not laying out at the device pixel ratio`);
    return got;
  } finally {
    await page.context().close();
  }
}

export type DprCaseOutcome = {
  readonly id: string;
  readonly dpr: number;
  readonly status: 'pass' | 'fail';
  readonly reason: string | null;
  readonly comparison: ZoomedComparison | null;
  /** Nodes whose four absolute edges equal Chrome's in zoomed LU (1/64 device px). */
  readonly exact: number;
  readonly nodes: number;
  readonly vector: { readonly input: LayoutInput; readonly output: readonly LayoutRect[] } | null;
};

function referenceMeasurer() {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m;
}

/**
 * The DPR lane of one case: projection at the DPR, validator, engine, then the 1 device px gate against the DPR capture. faults are
 * planted engine faults; only the DPR deviation registry check passes anything but NO_ENGINE_FAULTS.
 */
export function runDprCase(c: ParityCase, compiled: Compiled<'ios' | 'web'>, dpr: number, capture: WebCapture, faults: EngineFaults = NO_ENGINE_FAULTS, projectionOf: Projection | null = null): DprCaseOutcome {
  const env = atDpr(c.environment, dpr);
  const base = { id: c.id, dpr, comparison: null, exact: 0, nodes: 0, vector: null };
  const projection = (projectionOf ?? iosLayoutProjection)(compiled, env, c.assignment);
  if (projection.kind === 'blocked') return { ...base, status: 'fail', reason: `ios projection blocked: ${projection.reason}` };
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) return { ...base, status: 'fail', reason: `layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}` };
  const result = layoutWithFaults(validated.input, referenceShapedMeasurer(faults), faults);
  if (result.kind === 'unsupported') return { ...base, status: 'fail', reason: `LayoutUnsupported ${result.unsupported.code} at ${result.unsupported.nodeId}` };
  // TXT1a-2: a shaped case is compared against the capture with its generated hyphen rects joined (text-latin-run.ts).
  const comparison = compareZoomedLayout(isShapedInput(validated.input) ? joinHyphenRects(capture) : capture, absoluteRects(result.boxes), validated.input, env);
  const compared = comparison.nodes.filter((n) => n.dragon !== null);
  const exact = compared.filter((n) => n.exactLu).length;
  const problems = [...comparison.problems];
  for (const n of compared) if (!n.exactLu) problems.push(`${n.id}: not exact in zoomed LU (chrome ${JSON.stringify(n.chrome)}, engine LU ${JSON.stringify(n.dragonLu)})`);
  const pass = comparison.pass && problems.length === 0;
  return {
    ...base,
    comparison,
    exact,
    nodes: compared.length,
    status: pass ? 'pass' : 'fail',
    reason: pass ? null : problems.join('; '),
    vector: pass ? { input: validated.input, output: result.boxes } : null,
  };
}

/** The vector file text of a passing DPR case: the four milestone-1 keys (vectors/README.md). */
export function dprVectorText(v: { readonly input: LayoutInput; readonly output: readonly LayoutRect[] }): string {
  return `${JSON.stringify({ platform: REFERENCE_PLATFORM, measurer: referenceMeasurer().key, input: v.input, output: v.output }, null, 1)}\n`;
}

/** The snap vector text of a passing DPR case: the engine rects and their snapped device-px edges (vectors/README.md). */
export function snapVectorText(dpr: number, output: readonly LayoutRect[]): string {
  return `${JSON.stringify({ platform: REFERENCE_PLATFORM, devicePixelRatio: dpr, input: output, output: snapEdges(output) }, null, 1)}\n`;
}

/** A committed DPR capture; at DPR 1, the milestone-1 capture (expected/<platform>). */
export function committedDprCapture(caseId: string, dpr: number): WebCapture {
  return JSON.parse(readFileSync(dpr === 1 ? expectedPath(caseId) : expectedDprPath(caseId, dpr), 'utf8')) as WebCapture;
}

export type DprLaneSummary = {
  readonly dpr: number;
  readonly role: 'shared' | 'extra';
  readonly cases: number;
  readonly pass: number;
  readonly nodes: number;
  readonly exact: number;
  readonly outcomes: readonly DprCaseOutcome[];
};

/** The DPR lane over every layout case at every DPR, against the committed DPR captures. Needs no browser. */
export function runDprLane(dprs: readonly number[] = DPRS): DprLaneSummary[] {
  const compiled = new Map<string, Compiled<'ios' | 'web'>>();
  const compiledFor = (spec: FixtureSpec, direction: Environment['direction']): Compiled<'ios' | 'web'> => {
    const key = `${spec.id} ${direction}`;
    let c = compiled.get(key);
    if (c === undefined) {
      c = compileFixture(spec, NO_FAULTS, 'enforce', direction).compiled;
      compiled.set(key, c);
    }
    return c;
  };
  const all = layoutCases();
  return dprs.map((dpr) => {
    const outcomes: DprCaseOutcome[] = [];
    for (const f of all) for (const c of f.cases) outcomes.push(runDprCase(c, compiledFor(f.spec, c.environment.direction), dpr, committedDprCapture(c.id, dpr)));
    return {
      dpr,
      role: SHARED_DPRS.includes(dpr) ? 'shared' : 'extra',
      cases: outcomes.length,
      pass: outcomes.filter((o) => o.status === 'pass').length,
      nodes: outcomes.reduce((n, o) => n + o.nodes, 0),
      exact: outcomes.reduce((n, o) => n + o.exact, 0),
      outcomes,
    };
  });
}

// ---------------------------------------------------------------- DPR deviation registry (chrome-deviations-dpr.ts)

/** One registered node or control, checked at its DPR with the fault off and with the deviation's spec-reading fault on. */
export type DprRegistryRow = {
  readonly deviation: string;
  readonly kind: 'node' | 'control';
  /** The branch of a node, or the frame of a control. */
  readonly detail: string;
  readonly fixture: string;
  readonly node: string;
  readonly dpr: number;
  /** Exact in zoomed LU against Chrome with the fault off. */
  readonly exact: boolean;
  /** Exact in zoomed LU against Chrome with the spec-reading fault on (a node must not be). */
  readonly exactUnderFault: boolean;
  /** The largest edge gap under the fault, in device px. */
  readonly gapUnderFault: number;
  /** A control keeps its rect relative to its frame under the fault; null for a node. */
  readonly held: boolean | null;
};

/** The single case of a registered ltr HTML fixture. */
function registeredCase(fixture: string): { readonly spec: FixtureSpec; readonly c: ParityCase } {
  const spec = FIXTURES.find((f) => f.id === fixture);
  if (spec === undefined || spec.kind !== 'layout') throw new Error(`DPR registry names ${fixture}, which is not a layout fixture`);
  const c = casesOf(spec, compileFixture(spec).input).find((x) => x.id === fixture);
  if (c === undefined) throw new Error(`DPR registry fixture ${fixture} has no ltr case ${fixture}`);
  return { spec, c };
}

/** Every node and control of the DPR registry, checked in the DPR lane. */
export function dprRegistryRows(registry: readonly DprChromeDeviation[] = dprChromeDeviations): DprRegistryRow[] {
  const rows: DprRegistryRow[] = [];
  const runs = new Map<string, { readonly main: DprCaseOutcome; readonly faulty: DprCaseOutcome }>();
  const run = (d: DprChromeDeviation, fixture: string, dpr: number): { readonly main: DprCaseOutcome; readonly faulty: DprCaseOutcome } => {
    const key = `${d.fault} ${fixture} ${dpr}`;
    const hit = runs.get(key);
    if (hit !== undefined) return hit;
    const { spec, c } = registeredCase(fixture);
    const compiled = compileFixture(spec, NO_FAULTS, 'enforce', c.environment.direction).compiled;
    const capture = committedDprCapture(c.id, dpr);
    const out = { main: runDprCase(c, compiled, dpr, capture), faulty: runDprCase(c, compiled, dpr, capture, { ...NO_ENGINE_FAULTS, [d.fault]: true }) };
    runs.set(key, out);
    return out;
  };
  const nodeOf = (o: DprCaseOutcome, id: string) => {
    const n = (o.comparison?.nodes ?? []).find((x) => x.id === id);
    if (n === undefined || n.dragonLu === null) throw new Error(`${o.id} @${o.dpr}: registered node ${id} is not compared`);
    return n;
  };
  const gap = (o: DprCaseOutcome, id: string): number => {
    const n = nodeOf(o, id);
    return n.delta === null ? Infinity : Math.max(Math.abs(n.delta.left), Math.abs(n.delta.top), Math.abs(n.delta.right), Math.abs(n.delta.bottom)) * o.dpr;
  };
  for (const d of registry) {
    for (const n of d.nodes) {
      const r = run(d, n.fixture, n.dpr);
      rows.push({ deviation: d.id, kind: 'node', detail: n.branch, fixture: n.fixture, node: n.node, dpr: n.dpr, exact: nodeOf(r.main, n.node).exactLu, exactUnderFault: nodeOf(r.faulty, n.node).exactLu, gapUnderFault: gap(r.faulty, n.node), held: null });
    }
    for (const c of d.controls) {
      const r = run(d, c.fixture, c.dpr);
      const rel = (o: DprCaseOutcome): number[] => {
        const a = nodeOf(o, c.node).dragonLu as { left: number; top: number; right: number; bottom: number };
        const f = nodeOf(o, c.relativeTo).dragonLu as { left: number; top: number; right: number; bottom: number };
        return [a.left - f.left, a.top - f.top, a.right - f.left, a.bottom - f.top];
      };
      rows.push({ deviation: d.id, kind: 'control', detail: c.relativeTo, fixture: c.fixture, node: c.node, dpr: c.dpr, exact: nodeOf(r.main, c.node).exactLu, exactUnderFault: nodeOf(r.faulty, c.node).exactLu, gapUnderFault: gap(r.faulty, c.node), held: JSON.stringify(rel(r.main)) === JSON.stringify(rel(r.faulty)) });
    }
  }
  return rows;
}

/** A registry row passes when it is exact with the fault off, and a node is non-exact under the fault while a control holds. */
export function registryRowPasses(r: DprRegistryRow): boolean {
  return r.exact && (r.kind === 'node' ? !r.exactUnderFault : r.held === true);
}
