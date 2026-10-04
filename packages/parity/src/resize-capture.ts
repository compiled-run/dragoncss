// MQ-R1 (notes/T067-mq-r-spec.md R5, R7 (a)): the resize traces. Chrome runs each resize script (fixture-groups/media-runtime.ts)
// through Page.setViewportSize, with a state step morphing the DOM in place to the next assignment's rendering, and dumps every
// element's box, text boxes and computed values after the start and after every step, at DPR 1, 2, 2.625 and 3 (authored) and at
// DPR 1 in the compiled web rendering (chrome-dual). The host lanes run the same script on the band runtime reference
// (media-runtime.ts MediaRuntime) over the compile's band program: after every step its program must be the per-case program
// of (the app assignment, the band the compile-time partition gives the size) at the step's size (the R5 oracle), its engine frames
// must equal Chrome's in zoomed LU, its background colours Chrome's computed ones, and the compiled rendering the authored one.
import { existsSync, readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { absoluteRects, layout } from '@dragon/layout';
import type { Assignment, BandRuntimeFaults, Compiled, NativeProgram, Rgba8, StateProgram } from 'dragon';
import { LONGHANDS, nativeBandOfViewport, nativeBandProgram, nativeBandPrograms, nativeBands, NO_BAND_RUNTIME_FAULTS, parseComputedColor, programInput, stateKey, webClassMap } from 'dragon';
import type { CapturedNode } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf } from './cases.ts';
import { CHROME_VERSION, openPage } from './chrome.ts';
import { compareZoomedLayout } from './compare.ts';
import type { FixtureSpec } from './fixtures.ts';
import { directionSuffix, environmentsOf, FIXTURES } from './fixtures.ts';
import type { ResizeScript, ResizeStep, Size } from './fixture-groups/media-runtime.ts';
import { RESIZE_SCRIPTS, resizeSizeProblem } from './fixture-groups/media-runtime.ts';
import { nativeCompile, referenceMeasurer } from './native-host.ts';
import { repoPath } from './paths.ts';
import { compileFixture, fixtureCompileInput, webCssOf } from './pipeline.ts';
import { canonicalJsonText } from './state-cases.ts';
import { MediaRuntime } from './media-runtime.ts';

export const RESIZE_SCHEMA = 'dragon-resize-capture/1';
export const RESIZE_DPRS: readonly number[] = [1, 2, 2.625, 3];
/** The computed values a sample records: every longhand at DPR 1 (chrome-dual compares them), the background colour elsewhere. */
export const DPR_PROPERTIES: readonly string[] = ['background-color'];

/** One resize case: a script in one direction, with its native compile, band program (uikit) and web rendering. */
export type ResizeCase = {
  readonly id: string;
  readonly spec: FixtureSpec;
  readonly script: ResizeScript;
  readonly direction: 'ltr' | 'rtl';
  readonly compiled: Compiled<'ios' | 'android'>;
  readonly webCompiled: Compiled<'ios' | 'web'>;
  readonly webCss: string | null;
  /** The fixture's parity cases in this direction, one per assignment: their authored and compiled renderings. */
  readonly cases: readonly ParityCase[];
};

const bandPrograms = new Map<string, StateProgram>();

/** The band program of a resize case (uikit), derived once per process. */
export function resizeProgram(c: ResizeCase, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS): StateProgram {
  const plain = faults === NO_BAND_RUNTIME_FAULTS;
  const cached = plain ? bandPrograms.get(c.id) : undefined;
  if (cached !== undefined) return cached;
  const sp = nativeBandProgram(c.compiled, 'uikit', undefined, faults);
  if (plain) bandPrograms.set(c.id, sp);
  return sp;
}

/** Why a script cannot run, or null: a known layout fixture, sizes on the 8 px grid within the largest stage, sets naming free states. */
export function scriptProblem(s: ResizeScript): string | null {
  const spec = FIXTURES.find((f) => f.id === s.fixture);
  if (spec === undefined || spec.kind !== 'layout') return `${s.fixture} is not a layout fixture`;
  for (const size of [s.start, ...s.steps.flatMap((x) => (x.kind === 'resize' ? [{ width: x.width, height: x.height }] : []))]) {
    const p = resizeSizeProblem(size);
    if (p !== null) return `${s.fixture}: ${p}`;
  }
  if (s.steps.length === 0) return `${s.fixture}: a script needs a step`;
  return null;
}

let all: readonly ResizeCase[] | null = null;

/** Every resize case: each script in each environment direction of its fixture, ids "<fixture>[-rtl]~resize". */
export function resizeCases(): readonly ResizeCase[] {
  if (all !== null) return all;
  const out: ResizeCase[] = [];
  for (const script of RESIZE_SCRIPTS) {
    const problem = scriptProblem(script);
    if (problem !== null) throw new Error(`resize script: ${problem}`);
    const spec = FIXTURES.find((f) => f.id === script.fixture) as FixtureSpec;
    const parity = casesOf(spec, fixtureCompileInput(spec));
    for (const env of environmentsOf(spec)) {
      const direction = env.direction;
      const webCompiled = compileFixture(spec, undefined, 'derive', direction).compiled;
      out.push({
        id: `${spec.id}${directionSuffix(direction)}~resize`,
        spec,
        script,
        direction,
        compiled: nativeCompile(spec, direction),
        webCompiled,
        webCss: webCssOf(webCompiled),
        cases: parity.filter((c) => c.environment.direction === direction),
      });
    }
  }
  if (new Set(out.map((c) => c.id)).size !== out.length) throw new Error('two resize cases share an id');
  all = out;
  return out;
}

/** One point of a script: the root size and the app assignment after the start or a step. */
export type ScriptPoint = { readonly size: Size; readonly assignment: Assignment };

const keyOf = (e: Assignment[number]): string => stateKey(e.state.instance, e.state.state);

/** The app assignment and size after the start and after every step, from the script and the initial case alone. */
export function scriptPoints(c: ResizeCase): ScriptPoint[] {
  const initial = c.cases.find((p) => p.isInitial);
  if (initial === undefined) throw new Error(`${c.id}: no initial case`);
  let assignment: Assignment = initial.assignment;
  let size = c.script.start;
  const out: ScriptPoint[] = [{ size, assignment }];
  for (const s of c.script.steps) {
    if (s.kind === 'resize') size = { width: s.width, height: s.height };
    else {
      if (!assignment.some((e) => keyOf(e) === s.state)) throw new Error(`${c.id}: set ${s.state}: no such free state`);
      assignment = assignment.map((e) => (keyOf(e) === s.state ? { state: e.state, value: s.value } : e));
    }
    out.push({ size, assignment });
  }
  return out;
}

/** The parity case of an app assignment in this direction. */
function caseOf(c: ResizeCase, a: Assignment): ParityCase {
  const found = c.cases.find((p) => canonicalJsonText(p.assignment) === canonicalJsonText(a));
  if (found === undefined) throw new Error(`${c.id}: no parity case for ${JSON.stringify(a)}`);
  return found;
}

// ---------------------------------------------------------------- the Chrome capture

export type ResizeSample = { readonly size: Size; readonly nodes: readonly CapturedNode[] };

export type ResizeCapture = {
  readonly schema: string;
  readonly case: string;
  readonly chrome: string;
  readonly rendering: 'authored' | 'compiled';
  readonly devicePixelRatio: number;
  readonly direction: 'ltr' | 'rtl';
  readonly start: Size;
  readonly steps: readonly ResizeStep[];
  readonly samples: readonly ResizeSample[];
};

type PageStep = { readonly kind: 'dump'; readonly props: readonly string[] } | { readonly kind: 'morph'; readonly html: string };

/** One page step: a morph of the body to another rendering in place (as frame-capture.ts does), or a dump of every node. */
function pageStep(s: PageStep): CapturedNode[] {
  const idOf = (n: Node): string | null => (n.nodeType === Node.ELEMENT_NODE ? (n as Element).getAttribute('data-dragon-id') : null);
  if (s.kind === 'morph') {
    const sync = (from: Element, to: Element): void => {
      for (const a of Array.from(from.attributes)) if (!to.hasAttribute(a.name)) from.removeAttribute(a.name);
      for (const a of Array.from(to.attributes)) if (from.getAttribute(a.name) !== a.value) from.setAttribute(a.name, a.value);
      const old = new Map(Array.from(from.children).flatMap((e) => {
        const id = idOf(e);
        return id === null ? [] : [[id, e] as const];
      }));
      const wanted: Node[] = [];
      for (const n of Array.from(to.childNodes)) {
        const id = idOf(n);
        if (id !== null && old.has(id)) {
          const kept = old.get(id) as Element;
          sync(kept, n as Element);
          wanted.push(kept);
        } else wanted.push(document.importNode(n, true));
      }
      wanted.forEach((n, i) => {
        if (from.childNodes[i] !== n) from.insertBefore(n, from.childNodes[i] ?? null);
      });
      while (from.childNodes.length > wanted.length) from.removeChild(from.lastChild as Node);
    };
    const next = new DOMParser().parseFromString(s.html, 'text/html');
    sync(document.body, next.body);
    getComputedStyle(document.body).width;
    return [];
  }
  const blank = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';
  const out: CapturedNode[] = [];
  for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
    const id = el.getAttribute('data-dragon-id') as string;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const computed: Record<string, string> = {};
    for (const p of s.props) computed[p] = cs.getPropertyValue(p);
    out.push({ id, kind: 'element', hasBox: el.getClientRects().length > 0, x: r.x, y: r.y, width: r.width, height: r.height, computed });
    let k = 0;
    let spaces = 0;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      const rects = Array.from(range.getClientRects());
      const isBlank = blank((child as Text).data);
      const textId = isBlank ? `${id}:space${spaces++}` : `${id}:text${k++}`;
      if (isBlank && rects.length === 0) continue;
      const t = range.getBoundingClientRect();
      out.push({ id: textId, kind: 'text', hasBox: rects.length > 0, x: t.x, y: t.y, width: t.width, height: t.height, computed: null });
      rects.forEach((q, j) => out.push({ id: `${textId}:line${j}`, kind: 'line', hasBox: true, x: q.x, y: q.y, width: q.width, height: q.height, computed: null }));
    }
  }
  return out;
}

/** The HTML of an assignment in the authored or the compiled web rendering. */
function rendering(c: ResizeCase, a: Assignment, r: 'authored' | 'compiled'): string {
  const p = caseOf(c, a);
  if (r === 'authored') return p.authoredHtml;
  const classOf = webClassMap(c.webCompiled, a);
  if (classOf === null || c.webCss === null) throw new Error(`${c.id}: the compiled web output is not ready`);
  return p.compiledHtml(c.webCss, classOf);
}

/** Captures one resize case at one DPR in one rendering; the browser must be launched at that DPR (chrome.ts launchChrome). */
export async function captureResize(browser: Browser, c: ResizeCase, dpr: number, r: 'authored' | 'compiled' = 'authored'): Promise<ResizeCapture> {
  const points = scriptPoints(c);
  const first = points[0] as ScriptPoint;
  const page = await openPage(browser, rendering(c, first.assignment, r), { viewport: first.size, devicePixelRatio: dpr, direction: c.direction, rootFont: 'ahem' });
  const props = dpr === 1 ? [...LONGHANDS] : [...DPR_PROPERTIES];
  const settle = (): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  try {
    const samples: ResizeSample[] = [];
    const dump = async (size: Size): Promise<void> => {
      const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      if (inner[0] !== size.width || inner[1] !== size.height) throw new Error(`${c.id} DPR ${dpr}: the viewport is ${inner.join('x')}, the script's ${size.width}x${size.height}`);
      samples.push({ size, nodes: await page.evaluate(pageStep, { kind: 'dump', props } as PageStep) });
    };
    await dump(first.size);
    for (let i = 0; i < c.script.steps.length; i++) {
      const s = c.script.steps[i] as ResizeStep;
      const at = points[i + 1] as ScriptPoint;
      if (s.kind === 'resize') await page.setViewportSize({ width: s.width, height: s.height });
      else await page.evaluate(pageStep, { kind: 'morph', html: rendering(c, at.assignment, r) } as PageStep);
      await settle();
      await dump(at.size);
    }
    const reported = await page.evaluate(() => window.devicePixelRatio);
    if (reported !== dpr) throw new Error(`${c.id}: devicePixelRatio ${reported} after the script, not ${dpr}`);
    return { schema: RESIZE_SCHEMA, case: c.id, chrome: CHROME_VERSION, rendering: r, devicePixelRatio: dpr, direction: c.direction, start: c.script.start, steps: c.script.steps, samples };
  } finally {
    await page.context().close();
  }
}

export function resizeCaptureJson(c: ResizeCapture): string {
  return `${JSON.stringify(c, null, 1)}\n`;
}

export const expectedResizeDir = (): string => repoPath('packages/parity/expected-resize');
export const resizeCapturePath = (caseId: string, r: 'authored' | 'compiled', dpr: number): string => `${expectedResizeDir()}/${caseId}/${r}-dpr${dpr}.json`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSize = (v: unknown): v is Size => isObject(v) && typeof v['width'] === 'number' && typeof v['height'] === 'number';

/** Why a parsed capture file is not a resize capture of this case, rendering and DPR, or null: every field the lanes read is checked. */
export function resizeCaptureProblem(v: unknown, caseId: string, r: 'authored' | 'compiled', dpr: number): string | null {
  if (!isObject(v)) return 'not an object';
  if (v['schema'] !== RESIZE_SCHEMA || v['case'] !== caseId || v['rendering'] !== r || v['devicePixelRatio'] !== dpr) return `not the ${r} resize capture of ${caseId} at DPR ${dpr}`;
  if (typeof v['chrome'] !== 'string' || (v['direction'] !== 'ltr' && v['direction'] !== 'rtl') || !isSize(v['start']) || !Array.isArray(v['steps'])) return 'chrome, direction, start or steps is missing or mistyped';
  const samples = v['samples'];
  if (!Array.isArray(samples)) return 'samples is not a list';
  for (const [i, s] of samples.entries()) {
    if (!isObject(s) || !isSize(s['size']) || !Array.isArray(s['nodes'])) return `sample ${i} has no size or nodes`;
    for (const n of s['nodes'] as unknown[]) {
      if (!isObject(n) || typeof n['id'] !== 'string' || !['element', 'text', 'line'].includes(n['kind'] as string) || typeof n['hasBox'] !== 'boolean') return `sample ${i}: a node without an id, kind or hasBox`;
      if (!['x', 'y', 'width', 'height'].every((k) => typeof n[k] === 'number')) return `sample ${i}: node ${n['id']} has a non-numeric box`;
      const computed = n['computed'];
      if (computed !== null && (!isObject(computed) || !Object.values(computed).every((x) => typeof x === 'string'))) return `sample ${i}: node ${n['id']} has computed values that are not strings`;
    }
  }
  return null;
}

/** The committed capture of a resize case, or null when it has none; a file that is not that capture throws, naming why. */
export function committedResize(caseId: string, r: 'authored' | 'compiled', dpr: number): ResizeCapture | null {
  const path = resizeCapturePath(caseId, r, dpr);
  if (!existsSync(path)) return null;
  const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const problem = resizeCaptureProblem(v, caseId, r, dpr);
  if (problem !== null) throw new Error(`${path}: ${problem}`);
  return v as ResizeCapture;
}

// ---------------------------------------------------------------- the host lanes

/** One dump of the runtime reference: the app assignment, band, program on screen, viewport and layouts so far. */
export type ResizeDump = { readonly band: number; readonly program: NativeProgram; readonly viewport: Size; readonly layouts: number };

const pxOf = (c: ResizeCase, size: Size, dpr: number): { widthPx: number; heightPx: number } => {
  const widthPx = size.width * dpr;
  const heightPx = size.height * dpr;
  // Chrome's emulated frame is ceil(W x dpr) device px (notes/T067 M5); on the 8 px grid it is exact, so no rounding happens.
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx)) throw new Error(`${c.id}: ${size.width}x${size.height} is not whole device px at DPR ${dpr}`);
  return { widthPx, heightPx };
};

/** Runs a resize case's script on the band runtime reference at one DPR: a dump after the start and after every step. */
export function runResizeScript(c: ResizeCase, dpr: number, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS): ResizeDump[] {
  const table = nativeBands(c.compiled)?.table ?? { atoms: [], bands: [[]] };
  const rt = new MediaRuntime(resizeProgram(c, faults), table, dpr, pxOf(c, c.script.start, dpr), faults);
  const dump = (): ResizeDump => ({ band: rt.band, program: rt.program(), viewport: rt.viewport(), layouts: rt.layouts });
  const out = [dump()];
  for (const s of c.script.steps) {
    if (s.kind === 'resize') rt.resize(pxOf(c, { width: s.width, height: s.height }, dpr));
    else rt.set(s.state, s.value);
    out.push(dump());
  }
  return out;
}

const TRANSPARENT: Rgba8 = { r: 0, g: 0, b: 0, alpha: 0 };

/** The background colour a program node draws: its background write, or transparent. */
function programBackground(p: NativeProgram, id: string): Rgba8 | null {
  const n = p.nodes.find((x) => x.id === id);
  if (n === undefined || n.kind === 'text') return null;
  const w = n.writes.find((x) => x.kind === 'background-color');
  return w === undefined || w.kind !== 'background-color' ? TRANSPARENT : w.color;
}

const sameColor = (a: Rgba8, b: Rgba8): boolean => (a.alpha === 0 && b.alpha === 0) || (a.r === b.r && a.g === b.g && a.b === b.b && a.alpha === b.alpha);

export type ResizeReport = { readonly samples: number; readonly boxes: number; readonly colors: number; readonly dual: number; readonly oracle: number; readonly failures: readonly string[] };

/** One resize case's host lanes at the given DPRs; every failure names the case, DPR, step and what differs. */
export function resizeCaseReport(c: ResizeCase, dprs: readonly number[] = RESIZE_DPRS, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS, captures: typeof committedResize = committedResize): ResizeReport {
  const failures: string[] = [];
  const points = scriptPoints(c);
  let samples = 0;
  let boxes = 0;
  let colors = 0;
  let dual = 0;
  let oracle = 0;
  for (const dpr of dprs) {
    let dumps: ResizeDump[];
    try {
      dumps = runResizeScript(c, dpr, faults);
    } catch (e) {
      failures.push(`${c.id} DPR ${dpr}: the runtime failed: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    // R5: after every step, the per-case program of (the app assignment, the partition's band of the size) at that size, one
    // layout per step.
    points.forEach((pt, i) => {
      const d = dumps[i] as ResizeDump;
      const at = `${c.id} DPR ${dpr} step ${i} (${pt.size.width}x${pt.size.height})`;
      oracle++;
      const band = nativeBandOfViewport(c.compiled, pt.size);
      if (band === null) {
        failures.push(`${at}: no band of the partition holds the size`);
        return;
      }
      const want = nativeBandPrograms(c.compiled, pt.assignment, band);
      if (want.kind !== 'ready') failures.push(`${at}: no per-case program: ${want.reason}`);
      else if (canonicalJsonText(d.program) !== canonicalJsonText(want.programs.uikit)) failures.push(`${at}: the runtime's program (band ${d.band}) is not the per-case program of band ${band}`);
      if (d.viewport.width !== pt.size.width || d.viewport.height !== pt.size.height) failures.push(`${at}: laid out at ${d.viewport.width}x${d.viewport.height}`);
      if (d.layouts !== i + 1) failures.push(`${at}: ${d.layouts} layouts after ${i} steps, not ${i + 1} (one per step)`);
    });
    const cap = captures(c.id, 'authored', dpr);
    if (cap === null) {
      failures.push(`${c.id} DPR ${dpr}: no committed resize capture (pnpm run parity:resize-capture)`);
      continue;
    }
    const sizes = (xs: readonly { readonly size: Size }[]): string => canonicalJsonText(xs.map((x) => x.size));
    if (canonicalJsonText(cap.start) !== canonicalJsonText(c.script.start) || canonicalJsonText(cap.steps) !== canonicalJsonText(c.script.steps) || cap.samples.length !== points.length || sizes(cap.samples) !== sizes(points)) {
      failures.push(`${c.id} DPR ${dpr}: the capture is of another script (${cap.samples.length} samples; the script has ${points.length}) (pnpm run parity:resize-capture)`);
      continue;
    }
    cap.samples.forEach((s, i) => {
      const d = dumps[i] as ResizeDump;
      const at = `${c.id} DPR ${dpr} step ${i} (${s.size.width}x${s.size.height})`;
      samples++;
      const env = { viewport: s.size, devicePixelRatio: dpr, direction: c.direction, rootFont: 'ahem' as const };
      const input = programInput(d.program, d.viewport, dpr);
      const out = layout(input, referenceMeasurer());
      if (out.kind !== 'ok') {
        failures.push(`${at}: the engine refused the live program`);
        return;
      }
      const capture = { fixture: c.id, chrome: cap.chrome, browser: '', platform: '', viewport: s.size, devicePixelRatio: dpr, direction: c.direction, nodes: s.nodes };
      const cmp = compareZoomedLayout(capture, absoluteRects(out.boxes), input, env);
      boxes += cmp.nodes.length;
      for (const p of cmp.problems) failures.push(`${at}: ${p}`);
      for (const n of cmp.nodes) if (n.dragon !== null && !n.exactLu) failures.push(`${at} ${n.id}: not exact in zoomed LU (chrome ${JSON.stringify(n.chrome)}, engine LU ${JSON.stringify(n.dragonLu)})`);
      for (const n of s.nodes) {
        if (n.kind !== 'element' || n.computed === null) continue;
        const want = programBackground(d.program, n.id);
        const text = n.computed['background-color'];
        if (want === null || text === undefined) continue;
        const got = parseComputedColor(text);
        colors++;
        if (got === null || !sameColor(got, want)) failures.push(`${at} ${n.id}: background-color chrome ${text}, dragon ${JSON.stringify(want)}`);
      }
    });
    if (dpr === 1) {
      const compiled = captures(c.id, 'compiled', 1);
      if (compiled === null) failures.push(`${c.id}: no committed compiled-rendering resize capture (chrome-dual)`);
      else {
        if (compiled.samples.length !== cap.samples.length) failures.push(`${c.id}: chrome-dual: the compiled capture has ${compiled.samples.length} samples, the authored one ${cap.samples.length}`);
        cap.samples.forEach((a, i) => {
          dual++;
          const s = compiled.samples[i];
          if (s === undefined || canonicalJsonText(s) !== canonicalJsonText(a)) failures.push(`${c.id} step ${i}: chrome-dual: the compiled rendering differs from the authored one`);
        });
      }
    }
  }
  return { samples, boxes, colors, dual, oracle, failures };
}

/** Every resize case's host lanes, with the cases that pass all of them. */
export function resizeReport(dprs: readonly number[] = RESIZE_DPRS, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS): ResizeReport & { readonly cases: number; readonly passing: readonly ResizeCase[] } {
  const cases = resizeCases();
  const total = { samples: 0, boxes: 0, colors: 0, dual: 0, oracle: 0 };
  const failures: string[] = [];
  const passing: ResizeCase[] = [];
  for (const c of cases) {
    const r = resizeCaseReport(c, dprs, faults);
    failures.push(...r.failures);
    if (r.failures.length === 0) passing.push(c);
    total.samples += r.samples;
    total.boxes += r.boxes;
    total.colors += r.colors;
    total.dual += r.dual;
    total.oracle += r.oracle;
  }
  return { cases: cases.length, ...total, failures, passing };
}
