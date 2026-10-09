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
import type { Assignment, BandRuntimeFaults, Compiled, MediaDevice, NativeBackend, NativeProgram, PointerReadings, Rgba8, StateProgram } from 'dragon';
import { DESKTOP_DEVICE, LONGHANDS, pointerBits, nativeBandOfViewport, nativeBandProgram, nativeBandPrograms, nativeBands, NO_BAND_RUNTIME_FAULTS, parseComputedColor, programInput, stateKey, webClassMap } from 'dragon';
import type { CapturedNode } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf } from './cases.ts';
import { CHROME_VERSION, openPage } from './chrome.ts';
import { compareZoomedLayout } from './compare.ts';
import type { RgbaImage } from './native-compare.ts';
import { decodePng, rasterSize } from './pixel-reference.ts';
import type { FixtureSpec } from './fixtures.ts';
import { directionSuffix, environmentsOf, FIXTURES } from './fixtures.ts';
import type { ResizeScript, ResizeStep, Size } from './fixture-groups/media-runtime.ts';
import { RESIZE_SCRIPTS, resizeSizeProblem } from './fixture-groups/media-runtime.ts';
import { ENV_SCRIPTS, MEDIA_ENVIRONMENT_FIXTURES } from './fixture-groups/media-environment.ts';
import { nativeCompile, referenceMeasurer } from './native-host.ts';
import { repoPath } from './paths.ts';
import { compileFixture, fixtureCompileInput, webCssOf } from './pipeline.ts';
import { canonicalJsonText } from './state-cases.ts';
import { MediaRuntime } from './media-runtime.ts';

export const RESIZE_SCHEMA = 'dragon-resize-capture/1';
export const RESIZE_DPRS: readonly number[] = [1, 2, 2.625, 3];
/** The computed values a sample records: every longhand at DPR 1 (chrome-dual compares them), the background colour elsewhere. */
export const DPR_PROPERTIES: readonly string[] = ['background-color'];

/** One resize case: a script in one direction, with its native compile (both backends' band programs) and web rendering. */
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

/** The native backends whose band programs the resize lanes run: each backend derives its own deltas through env#band. */
export const RESIZE_BACKENDS: readonly NativeBackend[] = ['uikit', 'android-views'];

/** The band program of a resize case for a backend, derived once per process. */
export function resizeProgram(c: ResizeCase, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS, backend: NativeBackend = 'uikit'): StateProgram {
  const plain = faults === NO_BAND_RUNTIME_FAULTS;
  const key = `${c.id} ${backend}`;
  const cached = plain ? bandPrograms.get(key) : undefined;
  if (cached !== undefined) return cached;
  const sp = nativeBandProgram(c.compiled, backend, undefined, faults);
  if (plain) bandPrograms.set(key, sp);
  return sp;
}

/** Why a script cannot run, or null: a known layout fixture, sizes on the 8 px grid within the largest stage, sets naming free states. */
/** The fixture of a script: a layout fixture, or (MQ-R2) a media-environment fixture, which runs only as its script. */
const scriptFixture = (id: string): FixtureSpec | undefined => [...FIXTURES, ...MEDIA_ENVIRONMENT_FIXTURES].find((f) => f.id === id);

/** Every resize script: the media-runtime ones, then (MQ-R2) the media-environment ones. */
export const ALL_RESIZE_SCRIPTS: readonly ResizeScript[] = [...RESIZE_SCRIPTS, ...ENV_SCRIPTS];

export function scriptProblem(s: ResizeScript): string | null {
  const spec = scriptFixture(s.fixture);
  if (spec === undefined || spec.kind !== 'layout') return `${s.fixture} is not a layout fixture`;
  for (const size of [s.start, ...s.steps.flatMap((x) => (x.kind === 'resize' ? [{ width: x.width, height: x.height }] : []))]) {
    const p = resizeSizeProblem(size);
    if (p !== null) return `${s.fixture}: ${p}`;
  }
  if (s.steps.length === 0) return `${s.fixture}: a script needs a step`;
  // MQ-R2: Chrome takes a pointers step's readings at launch, on a new page, so the script carries no app state or touch emulation over it.
  const pointers = s.steps.filter((x) => x.kind === 'env' && x.reading === 'pointers');
  if (pointers.length > 0 && s.steps.some((x) => x.kind === 'set')) return `${s.fixture}: a script with a pointers step has no set steps (Chrome reopens its page)`;
  const first = s.steps.findIndex((x) => x.kind === 'env' && x.reading === 'pointers');
  if (first >= 0 && s.steps.slice(first).some((x) => x.kind === 'env' && x.reading === 'pointer')) return `${s.fixture}: a touch or desktop step follows a pointers step (touch emulation restores the launch's readings, not a desktop's)`;
  for (const x of pointers) {
    try {
      if (x.kind === 'env' && x.reading === 'pointers') pointerBits(x.value);
    } catch (e) {
      return `${s.fixture}: ${(e as Error).message}`;
    }
  }
  return null;
}

/** Blink's pointer and hover type bits (ui/base/pointer/pointer_device.h PointerType and HoverType). */
const POINTER_TYPE = { none: 1, coarse: 2, fine: 4 } as const;
const HOVER_TYPE = { none: 1, hover: 2 } as const;

/** The Chrome flag that sets every pointer and hover reading of a page (Blink's settings, which the media features read). */
export function blinkPointerArgs(p: PointerReadings): string[] {
  pointerBits(p);
  const available = p.anyPointer.length === 0 ? POINTER_TYPE.none : p.anyPointer.reduce((a, k) => a | POINTER_TYPE[k], 0);
  return [`--blink-settings=primaryPointerType=${POINTER_TYPE[p.pointer]},availablePointerTypes=${available},primaryHoverType=${HOVER_TYPE[p.hover]},availableHoverTypes=${HOVER_TYPE[p.anyHover]}`];
}

/** The media queries that read a device's pointer, hover and motion readings, and the answers the readings give them. */
export function readingQueries(d: Omit<MediaDevice, 'dpr'>): [string, boolean][] {
  const any: readonly string[] = d.anyPointer.length === 0 ? ['none'] : d.anyPointer;
  return [
    ...(['none', 'coarse', 'fine'] as const).map((k): [string, boolean] => [`(pointer: ${k})`, d.pointer === k]),
    ...(['none', 'coarse', 'fine'] as const).map((k): [string, boolean] => [`(any-pointer: ${k})`, any.includes(k)]),
    ...(['none', 'hover'] as const).map((k): [string, boolean] => [`(hover: ${k})`, d.hover === k]),
    ...(['none', 'hover'] as const).map((k): [string, boolean] => [`(any-hover: ${k})`, d.anyHover === k]),
    ...(['no-preference', 'reduce'] as const).map((k): [string, boolean] => [`(prefers-reduced-motion: ${k})`, d.reducedMotion === k]),
  ];
}

let all: readonly ResizeCase[] | null = null;

/** Every resize case: each script in each environment direction of its fixture, ids "<fixture>[-rtl]~resize". */
export function resizeCases(): readonly ResizeCase[] {
  if (all !== null) return all;
  const out: ResizeCase[] = [];
  for (const script of ALL_RESIZE_SCRIPTS) {
    const problem = scriptProblem(script);
    if (problem !== null) throw new Error(`resize script: ${problem}`);
    const spec = scriptFixture(script.fixture) as FixtureSpec;
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

/**
 * One point of a script: the root size, the app assignment and (MQ-R2) the device readings after the start or a step. The scale
 * is not a reading of the script: deviceAt gives the readings at a DPR.
 */
export type ScriptPoint = { readonly size: Size; readonly assignment: Assignment; readonly device: MediaDevice };

/** A touch screen alone (hasTouch, M7): coarse, no hover. */
const TOUCH_READINGS = { pointer: 'coarse', anyPointer: ['coarse'], hover: 'none', anyHover: 'none' } as const;
const DESKTOP_READINGS = { pointer: 'fine', anyPointer: ['fine'], hover: 'hover', anyHover: 'hover' } as const;

/** The readings after an env step. */
export function readingsAfter(d: MediaDevice, s: ResizeStep & { kind: 'env' }): MediaDevice {
  if (s.reading === 'motion') return { ...d, reducedMotion: s.value };
  if (s.reading === 'pointers') return { ...d, pointer: s.value.pointer, anyPointer: [...s.value.anyPointer], hover: s.value.hover, anyHover: s.value.anyHover };
  return { ...d, ...(s.value === 'touch' ? TOUCH_READINGS : DESKTOP_READINGS) };
}

/** A point's device at a DPR. */
export const deviceAt = (pt: ScriptPoint, dpr: number): MediaDevice => ({ ...pt.device, dpr });

const keyOf = (e: Assignment[number]): string => stateKey(e.state.instance, e.state.state);

/** The app assignment and size after the start and after every step, from the script and the initial case alone. */
export function scriptPoints(c: ResizeCase): ScriptPoint[] {
  const initial = c.cases.find((p) => p.isInitial);
  if (initial === undefined) throw new Error(`${c.id}: no initial case`);
  let assignment: Assignment = initial.assignment;
  let size = c.script.start;
  // Chrome's page starts as a desktop: a mouse, no motion preference.
  let device: MediaDevice = DESKTOP_DEVICE;
  const out: ScriptPoint[] = [{ size, assignment, device }];
  for (const s of c.script.steps) {
    if (s.kind === 'resize') size = { width: s.width, height: s.height };
    else if (s.kind === 'env') device = readingsAfter(device, s);
    else {
      if (!assignment.some((e) => keyOf(e) === s.state)) throw new Error(`${c.id}: set ${s.state}: no such free state`);
      assignment = assignment.map((e) => (keyOf(e) === s.state ? { state: e.state, value: s.value } : e));
    }
    out.push({ size, assignment, device });
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
export function rendering(c: ResizeCase, a: Assignment, r: 'authored' | 'compiled'): string {
  const p = caseOf(c, a);
  if (r === 'authored') return p.authoredHtml;
  const classOf = webClassMap(c.webCompiled, a);
  if (classOf === null || c.webCss === null) throw new Error(`${c.id}: the compiled web output is not ready`);
  return p.compiledHtml(c.webCss, classOf);
}

/**
 * Captures one resize case at one DPR in one rendering; the browser must be launched at that DPR (chrome.ts launchChrome). shot,
 * when given, takes Chrome's pixels after the start and every step (Page.captureScreenshot, the pixel lane's capture). MQ-R2:
 * browserFor gives a Chrome at that DPR launched with a pointers step's readings (blinkPointerArgs), where the step's page opens.
 */
export async function captureResize(browser: Browser, c: ResizeCase, dpr: number, r: 'authored' | 'compiled' = 'authored', shot: ((step: number, png: Buffer) => void) | null = null, browserFor: ((p: PointerReadings) => Promise<Browser>) | null = null): Promise<ResizeCapture> {
  const points = scriptPoints(c);
  const first = points[0] as ScriptPoint;
  const open = (b: Browser, at: ScriptPoint) => openPage(b, rendering(c, at.assignment, r), { viewport: at.size, devicePixelRatio: dpr, direction: c.direction, rootFont: 'ahem' });
  let page = await open(browser, first);
  const props = dpr === 1 ? [...LONGHANDS] : [...DPR_PROPERTIES];
  const settle = (): Promise<void> => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  try {
    const samples: ResizeSample[] = [];
    const dump = async (size: Size): Promise<void> => {
      const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      if (inner[0] !== size.width || inner[1] !== size.height) throw new Error(`${c.id} DPR ${dpr}: the viewport is ${inner.join('x')}, the script's ${size.width}x${size.height}`);
      samples.push({ size, nodes: await page.evaluate(pageStep, { kind: 'dump', props } as PageStep) });
      // MQ-R2: Chrome answers the readings the script says it emulates, or the capture is not of them.
      const device = (points[samples.length - 1] as ScriptPoint).device;
      const queries = readingQueries(device);
      const got = await page.evaluate((qs) => qs.map((q) => matchMedia(q).matches), queries.map(([q]) => q));
      const wrong = queries.filter(([, want], k) => got[k] !== want).map(([q, want]) => `${q} ${want ? 'does not match' : 'matches'}`);
      if (wrong.length > 0) throw new Error(`${c.id} DPR ${dpr} step ${samples.length - 1}: Chrome's readings are not the script's: ${wrong.join(', ')}`);
      if (shot !== null) {
        // A resize can leave raster tiles Chrome does not repaint (a box edge of the previous size stays in about half the runs of
        // mqr-music-shape step 1 at DPR 2), so the pixels are taken after one whole-document repaint: the root hidden for a frame and
        // its style attribute restored exactly. Layout is untouched (visibility), and the samples above are taken before it.
        await page.evaluate(() => {
          const e = document.documentElement;
          (window as unknown as { dragonRootStyle: string | null }).dragonRootStyle = e.getAttribute('style');
          e.style.setProperty('visibility', 'hidden');
        });
        await settle();
        await page.evaluate(() => {
          const e = document.documentElement;
          const was = (window as unknown as { dragonRootStyle: string | null }).dragonRootStyle;
          if (was === null) e.removeAttribute('style');
          else e.setAttribute('style', was);
        });
        await settle();
        const cdp = await page.context().newCDPSession(page);
        try {
          const png = Buffer.from(((await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string }).data, 'base64');
          const img = decodePng(png);
          const want = rasterSize(size, dpr);
          if (img.width !== want.width || img.height !== want.height) throw new Error(`${c.id} DPR ${dpr} step ${samples.length - 1}: Chrome captured ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
          shot(samples.length - 1, png);
        } finally {
          await cdp.detach();
        }
      }
    };
    // MQ-R2: an env step switches touch emulation (pointer and hover, M7) or emulates prefers-reduced-motion, on the live page. The
    // overrides belong to the CDP session that set them (a detached session's are cleared), so one session holds them to the end.
    let emulation: Awaited<ReturnType<ReturnType<typeof page.context>['newCDPSession']>> | null = null;
    const emulate = async (s: ResizeStep & { kind: 'env'; reading: 'pointer' | 'motion' }): Promise<void> => {
      emulation ??= await page.context().newCDPSession(page);
      if (s.reading === 'pointer') await emulation.send('Emulation.setTouchEmulationEnabled', s.value === 'touch' ? { enabled: true, maxTouchPoints: 1 } : { enabled: false });
      else await emulation.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: s.value }] });
    };
    await dump(first.size);
    for (let i = 0; i < c.script.steps.length; i++) {
      const s = c.script.steps[i] as ResizeStep;
      const at = points[i + 1] as ScriptPoint;
      if (s.kind === 'resize') await page.setViewportSize({ width: s.width, height: s.height });
      else if (s.kind === 'env' && s.reading === 'pointers') {
        // A new page at the step's size in a Chrome launched with its readings; the reduced-motion setting is emulated again there.
        if (browserFor === null) throw new Error(`${c.id}: a pointers step needs browserFor`);
        const next = await open(await browserFor(s.value), at);
        await page.context().close();
        page = next;
        emulation = null;
        if (at.device.reducedMotion === 'reduce') await emulate({ kind: 'env', reading: 'motion', value: 'reduce' });
      } else if (s.kind === 'env') await emulate(s);
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
/** Chrome's pixels after step k of a resize case at a device DPR (the start is step 0), for the device-pixels lane. */
export const resizePixelsPath = (caseId: string, dpr: number, step: number): string => `${expectedResizeDir()}/${caseId}/pixels-dpr${dpr}/step${step}.png`;

const resizePngs = new Map<string, RgbaImage | null>();
/** The committed Chrome pixels of a resize step, or null when there are none. */
export function committedResizePixels(caseId: string, dpr: number, step: number): RgbaImage | null {
  const path = resizePixelsPath(caseId, dpr, step);
  const hit = resizePngs.get(path);
  if (hit !== undefined) return hit;
  const img = existsSync(path) ? decodePng(readFileSync(path)) : null;
  resizePngs.set(path, img);
  return img;
}

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
export function runResizeScript(c: ResizeCase, dpr: number, faults: BandRuntimeFaults = NO_BAND_RUNTIME_FAULTS, backend: NativeBackend = 'uikit'): ResizeDump[] {
  const table = nativeBands(c.compiled)?.table ?? { atoms: [], bands: [[]] };
  const rt = new MediaRuntime(resizeProgram(c, faults, backend), table, dpr, pxOf(c, c.script.start, dpr), faults);
  const dump = (): ResizeDump => ({ band: rt.band, program: rt.program(), viewport: rt.viewport(), layouts: rt.layouts });
  const out = [dump()];
  for (const s of c.script.steps) {
    if (s.kind === 'resize') rt.resize(pxOf(c, { width: s.width, height: s.height }, dpr));
    else if (s.kind === 'env') rt.setDevice(readingsAfter(rt.readings, s));
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
    const cap = captures(c.id, 'authored', dpr);
    const sizes = (xs: readonly { readonly size: Size }[]): string => canonicalJsonText(xs.map((x) => x.size));
    const capProblem = cap === null
      ? `${c.id} DPR ${dpr}: no committed resize capture (pnpm run parity:resize-capture)`
      : canonicalJsonText(cap.start) !== canonicalJsonText(c.script.start) || canonicalJsonText(cap.steps) !== canonicalJsonText(c.script.steps) || cap.samples.length !== points.length || sizes(cap.samples) !== sizes(points)
        ? `${c.id} DPR ${dpr}: the capture is of another script (${cap.samples.length} samples; the script has ${points.length}) (pnpm run parity:resize-capture)`
        : null;
    if (capProblem !== null) failures.push(capProblem);
    for (const backend of RESIZE_BACKENDS) {
      let dumps: ResizeDump[];
      try {
        dumps = runResizeScript(c, dpr, faults, backend);
      } catch (e) {
        failures.push(`${c.id} DPR ${dpr} ${backend}: the runtime failed: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      // R5: after every step, the per-case program of (the app assignment, the partition's band of the size) at that size, one
      // layout per step.
      points.forEach((pt, i) => {
        const d = dumps[i] as ResizeDump;
        const at = `${c.id} DPR ${dpr} ${backend} step ${i} (${pt.size.width}x${pt.size.height})`;
        oracle++;
        const band = nativeBandOfViewport(c.compiled, pt.size, deviceAt(pt, dpr));
        if (band === null) {
          failures.push(`${at}: no band of the partition holds the size`);
          return;
        }
        const want = nativeBandPrograms(c.compiled, pt.assignment, band);
        if (want.kind !== 'ready') failures.push(`${at}: no per-case program: ${want.reason}`);
        else if (canonicalJsonText(d.program) !== canonicalJsonText(want.programs[backend])) failures.push(`${at}: the runtime's program (band ${d.band}) is not the per-case program of band ${band}`);
        if (d.viewport.width !== pt.size.width || d.viewport.height !== pt.size.height) failures.push(`${at}: laid out at ${d.viewport.width}x${d.viewport.height}`);
        if (d.layouts !== i + 1) failures.push(`${at}: ${d.layouts} layouts after ${i} steps, not ${i + 1} (one per step)`);
      });
      if (cap === null || capProblem !== null) continue;
      cap.samples.forEach((s, i) => {
        const d = dumps[i] as ResizeDump;
        const at = `${c.id} DPR ${dpr} ${backend} step ${i} (${s.size.width}x${s.size.height})`;
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
    }
    if (cap === null || capProblem !== null) continue;
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
