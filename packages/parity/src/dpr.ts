// Device DPR (docs/research/native-strategy.md section 2): the milestone-1 layout cases captured in Chrome at the device pixel
// ratios the native lanes run at, and the DPR lane that compares the engine with them. DPR 1 captures, vectors and reports are
// untouched; every DPR set holds the same case ids.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import type { LayoutInput, LayoutRect } from '@dragon/layout';
import { absoluteRects, layout, measurerFor, snapEdges, validateLayoutInput } from '@dragon/layout';
import type { Compiled, Environment } from 'dragon';
import { iosLayoutProjection, NO_FAULTS } from 'dragon';
import type { WebCapture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf } from './cases.ts';
import { openPage } from './chrome.ts';
import type { ZoomedComparison } from './compare.ts';
import { compareZoomedLayout, GATE_DEVICE_PX } from './compare.ts';
import type { FixtureSpec } from './fixtures.ts';
import { FIXTURES } from './fixtures.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
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

/** The DPR lane of one case: projection at the DPR, validator, engine, then the 1 device px gate against the DPR capture. */
export function runDprCase(c: ParityCase, compiled: Compiled<'ios' | 'web'>, dpr: number, capture: WebCapture): DprCaseOutcome {
  const env = atDpr(c.environment, dpr);
  const base = { id: c.id, dpr, comparison: null, exact: 0, nodes: 0, vector: null };
  const projection = iosLayoutProjection(compiled, env, c.assignment);
  if (projection.kind === 'blocked') return { ...base, status: 'fail', reason: `ios projection blocked: ${projection.reason}` };
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) return { ...base, status: 'fail', reason: `layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}` };
  const result = layout(validated.input, referenceMeasurer().measurer);
  if (result.kind === 'unsupported') return { ...base, status: 'fail', reason: `LayoutUnsupported ${result.unsupported.code} at ${result.unsupported.nodeId}` };
  const comparison = compareZoomedLayout(capture, absoluteRects(result.boxes), validated.input, env);
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

/** A committed DPR capture. */
export function committedDprCapture(caseId: string, dpr: number): WebCapture {
  return JSON.parse(readFileSync(expectedDprPath(caseId, dpr), 'utf8')) as WebCapture;
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
