// T065 R2, R18: the Chrome capture of a frame case. The page opens frozen (chrome.ts openFrozenPage); a state step morphs the
// DOM in place to the next assignment's authored (or compiled) rendering, so the elements keep their transitions and animations,
// as one style change event; an advance sets currentTime += delta on every running animation and transition and never pauses one
// (a script-paused CSS animation survives a name change, M16); a dump reads each element's box, its text boxes and lines, and the
// computed value of every tracked property. document.timeline.currentTime is checked to stay 0 at every step. For the device-anim
// lane, the authored capture at a device DPR also reads Chrome's breaks at every dump and screenshots each R18 pixel sample.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Browser, CDPSession } from 'playwright';
import { absoluteRects, layout, rtEasing, rtInterpolate } from '@dragon/layout';
import type { CapturedNode } from './capture.ts';
import type { AnimCase, FrameDump, FrameStep } from './anim-cases.ts';
import { animCasesOf, animFixtures, frameScript, runFrameScript, trackedProperties } from './anim-cases.ts';
import { compareZoomedLayout } from './compare.ts';
import { referenceMeasurer } from './native-host.ts';
import { repoPath } from './paths.ts';
import { canonicalJsonText } from './state-cases.ts';
import { chromeArgsAt, CHROME_VERSION, openFrozenPage } from './chrome.ts';
import type { ChromeBreaks, ChromeBreakText } from './line-breaks.ts';
import { captureBreakTexts } from './line-breaks.ts';
import type { RgbaImage } from './native-compare.ts';
import type { RasterPath } from './pixel-reference.ts';
import { decodePng, PIXEL_CAPTURE, RASTER_RULE, rasterPathProblems, rasterSize } from './pixel-reference.ts';
import { authoredModel } from './render.ts';
import { fixtureInput } from './cases.ts';
import type { Assignment } from 'dragon';
import { programAt, programInput, StateRuntime, webClassMap } from 'dragon';
import type { AnimFaults } from './anim-cases.ts';
import { closureFrame, NO_ANIM_FAULTS, trackKey } from './anim-cases.ts';

export const FRAMES_CAPTURE_SCHEMA = 'dragon-frames-capture/1';

export type FrameSample = { readonly at: number; readonly settle: boolean; readonly nodes: readonly CapturedNode[] };

export type FrameCapture = {
  readonly schema: string;
  readonly case: string;
  readonly chrome: string;
  readonly rendering: 'authored' | 'compiled';
  readonly devicePixelRatio: number;
  readonly direction: 'ltr' | 'rtl';
  readonly viewport: { readonly width: number; readonly height: number };
  readonly steps: number;
  readonly samples: readonly FrameSample[];
};

type PageStep = { readonly kind: 'morph'; readonly html: string } | { readonly kind: 'advance'; readonly ms: number } | { readonly kind: 'dump' };

/** The HTML of every assignment the script reaches, in the authored rendering or the compiled one (chrome-dual). */
function renderings(c: AnimCase, steps: readonly FrameStep[], rendering: 'authored' | 'compiled', css: string | null): { initial: string; pageSteps: PageStep[] } {
  const model = authoredModel(fixtureInput(c.fixture.spec));
  const render = (a: Assignment): string => {
    if (rendering === 'authored') return model.render(a, { kind: 'authored' });
    const classOf = webClassMap(c.webCompiled, a);
    if (classOf === null || css === null) throw new Error(`${c.id}: the compiled web output is not ready`);
    return model.render(a, { kind: 'compiled', classOf, css });
  };
  const rt = new StateRuntime(c.sp);
  const initial = render((c.sp.assignments[rt.assignment] as { assignment: Assignment }).assignment);
  const pageSteps: PageStep[] = steps.map((s) => {
    if (s.kind === 'advance') return { kind: 'advance', ms: s.ms };
    if (s.kind === 'dump') return { kind: 'dump' };
    for (const x of s.sets) rt.set(x.state, x.value);
    return { kind: 'morph', html: render((c.sp.assignments[rt.assignment] as { assignment: Assignment }).assignment) };
  });
  return { initial, pageSteps };
}

/** Captures one frame case at one DPR in one rendering. */
export async function captureFrames(browser: Browser, c: AnimCase, steps: readonly FrameStep[], dpr: number, rendering: 'authored' | 'compiled' = 'authored', css: string | null = null): Promise<FrameCapture> {
  return (await runFrames(browser, c, steps, dpr, rendering, css, null)).capture;
}

/** The device lanes' per-sample Chrome references (R18): the breaks at every dump, and the PNG at each pixel sample (dump index). */
export type FrameRefs = { readonly breaks: readonly (readonly ChromeBreakText[])[]; readonly pixels: ReadonlyMap<number, Buffer> };

/** captureFrames in the authored rendering, also reading Chrome's breaks at every dump and screenshotting each of `pixels`. */
export async function captureFramesWithRefs(browser: Browser, c: AnimCase, steps: readonly FrameStep[], dpr: number, pixels: readonly number[]): Promise<{ readonly capture: FrameCapture; readonly refs: FrameRefs }> {
  const r = await runFrames(browser, c, steps, dpr, 'authored', null, new Set(pixels));
  if (r.refs === null) throw new Error(`${c.id}: no references were read`);
  return { capture: r.capture, refs: r.refs };
}

async function runFrames(browser: Browser, c: AnimCase, steps: readonly FrameStep[], dpr: number, rendering: 'authored' | 'compiled', css: string | null, pixels: ReadonlySet<number> | null): Promise<{ readonly capture: FrameCapture; readonly refs: FrameRefs | null }> {
  const { initial, pageSteps } = renderings(c, steps, rendering, css);
  const page = await openFrozenPage(browser, initial, { viewport: c.viewport, devicePixelRatio: dpr, direction: c.direction, rootFont: 'ahem' });
  try {
    const tracked = trackedProperties(c.ap);
    // Without references the script runs in one call; with them, in chunks that each end at a dump, read between chunks.
    const chunks: PageStep[][] = [[]];
    for (const s of pageSteps) {
      (chunks[chunks.length - 1] as PageStep[]).push(s);
      if (pixels !== null && s.kind === 'dump') chunks.push([]);
    }
    const dumps: CapturedNode[][] = [];
    const breaks: ChromeBreakText[][] = [];
    const shots = new Map<number, Buffer>();
    let cdp: CDPSession | null = null;
    for (const chunk of chunks) {
      if (chunk.length === 0) continue;
      const k = dumps.length;
      dumps.push(...await page.evaluate(({ pageSteps, tracked }) => {
        const frozen = (): void => {
          if (document.timeline.currentTime !== 0) throw new Error(`document.timeline.currentTime is ${String(document.timeline.currentTime)}, not 0`);
        };
        const idOf = (n: Node): string | null => (n.nodeType === Node.ELEMENT_NODE ? (n as Element).getAttribute('data-dragon-id') : null);
        // Morphs `to` into `from` in place: attributes, text and children by data-dragon-id; an element is moved only when out of place.
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
          for (const n of Array.from(from.childNodes)) if (n.nodeType === Node.TEXT_NODE && !wanted.includes(n)) from.removeChild(n);
        };
        const blank = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';
        const dump = (): CapturedNode[] => {
          const out: CapturedNode[] = [];
          for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
            const id = el.getAttribute('data-dragon-id') as string;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const computed: Record<string, string> = {};
            for (const t of tracked) if (t.node === id) computed[t.property] = cs.getPropertyValue(t.property);
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
        };
        const out: CapturedNode[][] = [];
        for (const s of pageSteps) {
          if (s.kind === 'morph') {
            const next = new DOMParser().parseFromString(s.html, 'text/html');
            sync(document.body, next.body);
            getComputedStyle(document.body).width;
          } else if (s.kind === 'advance') {
            for (const a of document.getAnimations()) if (a.playState === 'running') a.currentTime = Number(a.currentTime) + s.ms;
          } else out.push(dump());
          frozen();
        }
        return out;
      }, { pageSteps: chunk, tracked }));
      if (pixels === null || dumps.length === k) continue;
      if (dumps.length !== k + 1) throw new Error(`${c.id}: a reference chunk gave ${dumps.length - k} dumps`);
      // captureBreakTexts' transform twin would restyle the running script, so a transformed element is refused instead.
      const transformed = await page.evaluate(() => Array.from(document.querySelectorAll('[data-dragon-id]')).filter((el) => getComputedStyle(el).transform !== 'none').map((el) => el.getAttribute('data-dragon-id')));
      if (transformed.length > 0) throw new Error(`${c.id} sample ${k}: ${transformed.join(', ')} transformed; the frame break capture refuses the transform twin`);
      breaks.push(await captureBreakTexts(page));
      if (!pixels.has(k)) continue;
      // As parity:pixel-capture shoots: CDP Page.captureScreenshot, checked against the raster size rule.
      cdp ??= await page.context().newCDPSession(page);
      const png = Buffer.from(((await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string }).data, 'base64');
      const img = decodePng(png);
      const want = rasterSize(c.viewport, dpr);
      if (img.width !== want.width || img.height !== want.height) throw new Error(`${c.id}@${dpr} sample ${k}: Chrome captured ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
      const t = await page.evaluate(() => document.timeline.currentTime);
      if (t !== 0) throw new Error(`${c.id} sample ${k}: document.timeline.currentTime is ${String(t)} after the screenshot, not 0`);
      shots.set(k, png);
    }
    const dumpSteps = steps.filter((s): s is Extract<FrameStep, { kind: 'dump' }> => s.kind === 'dump');
    if (dumps.length !== dumpSteps.length) throw new Error(`${c.id}: Chrome gave ${dumps.length} dumps for ${dumpSteps.length} dump steps`);
    if (pixels !== null && (breaks.length !== dumps.length || shots.size !== pixels.size)) throw new Error(`${c.id}: ${breaks.length} break reads and ${shots.size} screenshots for ${dumps.length} dumps and ${pixels.size} pixel samples`);
    const capture: FrameCapture = {
      schema: FRAMES_CAPTURE_SCHEMA,
      case: c.id,
      chrome: CHROME_VERSION,
      rendering,
      devicePixelRatio: dpr,
      direction: c.direction,
      viewport: c.viewport,
      steps: steps.length,
      samples: dumps.map((nodes, i) => ({ at: (dumpSteps[i] as { at: number }).at, settle: (dumpSteps[i] as { settle: boolean }).settle, nodes })),
    };
    return { capture, refs: pixels === null ? null : { breaks, pixels: shots } };
  } finally {
    await page.context().close();
  }
}

export function frameCaptureJson(c: FrameCapture): string {
  return `${JSON.stringify(c, null, 1)}\n`;
}

// ---------------------------------------------------------------------------------------------------------------------
// The device-anim lane's references (R18): Chrome's breaks at every dump and its PNG at each pixel sample, authored, device DPRs.

export const FRAME_BREAKS_SCHEMA = 'dragon-frame-breaks/1';
export const FRAME_PIXELS_SCHEMA = 'dragon-frame-pixels/1';

export const expectedFramesRoot = (): string => repoPath('packages/parity/expected-frames');
export const frameBreaksPath = (caseId: string, dpr: number, dir: string = expectedFramesRoot()): string => `${dir}/${caseId}/breaks-dpr${dpr}.json`;
export const framePixelsDir = (caseId: string, dpr: number, dir: string = expectedFramesRoot()): string => `${dir}/${caseId}/pixels-dpr${dpr}`;

/** The breaks file of an authored capture: one record per dump, in dump order, each text one line. */
export function frameBreaksJson(cap: FrameCapture, breaks: readonly (readonly ChromeBreakText[])[]): string {
  if (cap.rendering !== 'authored' || breaks.length !== cap.samples.length) throw new Error(`${cap.case}: ${breaks.length} break records for ${cap.samples.length} ${cap.rendering} samples`);
  const samples = cap.samples.map((s, i) => {
    const texts = (breaks[i] as readonly ChromeBreakText[]).map((t) => `   ${JSON.stringify(t)}`).join(',\n');
    return `  {"at": ${JSON.stringify(s.at)}, "texts": [${texts === '' ? '' : `\n${texts}\n  `}]}`;
  });
  return `{\n "schema": ${JSON.stringify(FRAME_BREAKS_SCHEMA)},\n "case": ${JSON.stringify(cap.case)},\n "chrome": ${JSON.stringify(cap.chrome)},\n "dpr": ${JSON.stringify(cap.devicePixelRatio)},\n "samples": [\n${samples.join(',\n')}\n ]\n}\n`;
}

export type FramePixelManifest = {
  readonly schema: string;
  readonly case: string;
  readonly chrome: string;
  readonly capture: string;
  readonly rasterRule: string;
  readonly dpr: number;
  readonly flags: readonly string[];
  readonly raster: RasterPath;
  readonly samples: readonly { readonly k: number; readonly at: number; readonly width: number; readonly height: number; readonly sha256: string }[];
};

/** The manifest of a case's pixel samples at a DPR, beside the PNGs as manifest.json: the raster path and each PNG's sha256. */
export function framePixelManifestJson(cap: FrameCapture, raster: RasterPath, pngs: ReadonlyMap<number, Uint8Array>): string {
  const problems = rasterPathProblems(raster);
  if (problems.length > 0) throw new Error(`${cap.case}: ${problems.join('; ')}`);
  const samples = [...pngs].sort(([a], [b]) => a - b).map(([k, png]) => {
    const s = cap.samples[k];
    if (s === undefined) throw new Error(`${cap.case}: pixel sample ${k} is not one of ${cap.samples.length} dumps`);
    const img = decodePng(png);
    return `  ${JSON.stringify({ k, at: s.at, width: img.width, height: img.height, sha256: createHash('sha256').update(png).digest('hex') })}`;
  });
  const head = { schema: FRAME_PIXELS_SCHEMA, case: cap.case, chrome: cap.chrome, capture: PIXEL_CAPTURE, rasterRule: RASTER_RULE, dpr: cap.devicePixelRatio, flags: chromeArgsAt(cap.devicePixelRatio), raster: { rasterization: raster.rasterization, gpu_compositing: raster.gpu_compositing } };
  const lines = Object.entries(head).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${lines.join(',\n')},\n "samples": [\n${samples.join(',\n')}\n ]\n}\n`;
}

/** The committed authored capture a reference file belongs to; a reference without one is refused. */
function authoredFor(path: string, caseId: string, dpr: number, chrome: unknown, ats: readonly unknown[], dir: string): FrameCapture {
  const cap = committedFrames(caseId, 'authored', dpr, dir);
  if (cap === null) throw new Error(`${path}: no committed authored capture of ${caseId} at DPR ${dpr}`);
  if (chrome !== cap.chrome) throw new Error(`${path}: Chrome ${String(chrome)}, the authored capture ${cap.chrome}`);
  ats.forEach((at, i) => {
    if (cap.samples[i]?.at !== at) throw new Error(`${path}: sample ${i} at ${String(at)} ms, the authored capture's at ${String(cap.samples[i]?.at)}`);
  });
  return cap;
}

const isBreakText = (t: unknown): t is ChromeBreakText => {
  const x = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
  const ints = (v: unknown): boolean => Array.isArray(v) && v.every((n) => Number.isInteger(n));
  return typeof x['id'] === 'string' && typeof x['data'] === 'string' && Number.isInteger(x['lines']) && ints(x['units']) && ints(x['blank']);
};

/** Chrome's breaks at every dump of a frame case at a device DPR, in dump order; null when none are committed. */
export function committedFrameBreaks(caseId: string, dpr: number, dir: string = expectedFramesRoot()): readonly ChromeBreaks[] | null {
  const path = frameBreaksPath(caseId, dpr, dir);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const samples = raw['samples'];
  if (raw['schema'] !== FRAME_BREAKS_SCHEMA || raw['case'] !== caseId || raw['dpr'] !== dpr || !Array.isArray(samples)) throw new Error(`${path} is not the frame breaks of ${caseId} at DPR ${dpr}`);
  const cap = authoredFor(path, caseId, dpr, raw['chrome'], samples.map((s: { at?: unknown }) => s?.at), dir);
  if (samples.length !== cap.samples.length) throw new Error(`${path}: ${samples.length} samples, the authored capture ${cap.samples.length}`);
  return samples.map((s: { texts?: unknown }, i) => {
    if (!Array.isArray(s.texts) || !s.texts.every(isBreakText)) throw new Error(`${path}: sample ${i} has no list of break texts`);
    return { case: caseId, chrome: cap.chrome, dpr, texts: s.texts };
  });
}

const pixelManifests = new Map<string, FramePixelManifest>();

/** A case's committed pixel manifest at a DPR, checked against its authored capture and the software raster path; null when absent. */
export function committedFramePixelManifest(caseId: string, dpr: number, dir: string = expectedFramesRoot()): FramePixelManifest | null {
  const path = `${framePixelsDir(caseId, dpr, dir)}/manifest.json`;
  const hit = pixelManifests.get(path);
  if (hit !== undefined) return hit;
  if (!existsSync(path)) return null;
  const m = JSON.parse(readFileSync(path, 'utf8')) as FramePixelManifest;
  if (m.schema !== FRAME_PIXELS_SCHEMA || m.case !== caseId || m.dpr !== dpr || !Array.isArray(m.samples)) throw new Error(`${path} is not the frame pixel manifest of ${caseId} at DPR ${dpr}`);
  const problems = rasterPathProblems(m.raster);
  if (problems.length > 0) throw new Error(`${path}: ${problems.join('; ')}`);
  const cap = authoredFor(path, caseId, dpr, m.chrome, [], dir);
  const size = rasterSize(cap.viewport, dpr);
  m.samples.forEach((s, i) => {
    const prev = i === 0 ? -1 : (m.samples[i - 1] as { k: number }).k;
    if (!Number.isInteger(s?.k) || s.k <= prev || cap.samples[s.k]?.at !== s.at || typeof s.sha256 !== 'string') throw new Error(`${path}: sample entry ${i} is not an ascending dump index of the authored capture with its time and sha256`);
    if (s.width !== size.width || s.height !== size.height) throw new Error(`${path}: sample ${s.k} is ${String(s.width)}x${String(s.height)}, the raster rule ${size.width}x${size.height}`);
  });
  pixelManifests.set(path, m);
  return m;
}

/** The dump indexes whose Chrome PNG is committed for a case at a DPR; null when none are. */
export function framePixelSamples(caseId: string, dpr: number, dir: string = expectedFramesRoot()): readonly number[] | null {
  return committedFramePixelManifest(caseId, dpr, dir)?.samples.map((s) => s.k) ?? null;
}

const framePngs = new Map<string, RgbaImage>();

/** Chrome's PNG of a frame case's dump k at a device DPR, decoded; null when the case has no pixel references at that DPR. */
export function committedFramePixels(caseId: string, dpr: number, k: number, dir: string = expectedFramesRoot()): RgbaImage | null {
  const m = committedFramePixelManifest(caseId, dpr, dir);
  if (m === null) return null;
  const entry = m.samples.find((s) => s.k === k);
  if (entry === undefined) throw new Error(`${caseId} DPR ${dpr}: dump ${k} is not a pixel sample (${m.samples.map((s) => s.k).join(', ')})`);
  const path = `${framePixelsDir(caseId, dpr, dir)}/${k}.png`;
  const hit = framePngs.get(path);
  if (hit !== undefined) return hit;
  if (!existsSync(path)) throw new Error(`${path}: listed in the manifest but missing`);
  const png = readFileSync(path);
  if (createHash('sha256').update(png).digest('hex') !== entry.sha256) throw new Error(`${path}: the sha256 differs from the manifest`);
  const img = decodePng(png);
  if (img.width !== entry.width || img.height !== entry.height) throw new Error(`${path}: ${img.width}x${img.height}, the manifest ${entry.width}x${entry.height}`);
  framePngs.set(path, img);
  return img;
}

// ---------------------------------------------------------------------------------------------------------------------
// The host frame lanes (R18), against the committed captures.

/** The committed capture of a frame case, or null when it has none. */
export function committedFrames(caseId: string, rendering: 'authored' | 'compiled', dpr: number, dir: string = expectedFramesRoot()): FrameCapture | null {
  const path = `${dir}/${caseId}/${rendering}-dpr${dpr}.json`;
  if (!existsSync(path)) return null;
  const c = JSON.parse(readFileSync(path, 'utf8')) as FrameCapture;
  if (c.schema !== FRAMES_CAPTURE_SCHEMA || c.case !== caseId || c.rendering !== rendering || c.devicePixelRatio !== dpr) throw new Error(`${path} is not the ${rendering} capture of ${caseId} at DPR ${dpr}`);
  return c;
}

/** The properties whose getComputedStyle string is the computed value, so the animator's string must equal it. */
const STRING_COMPARED = (p: string): boolean => p === 'color' || p.endsWith('-color') || p.startsWith('margin-');

export type AnimReport = { readonly cases: number; readonly samples: number; readonly values: number; readonly boxes: number; readonly dual: number; readonly settles: number; readonly failures: readonly string[]; readonly passingCases: readonly string[] };

/** One frame case's host lanes; the failures name the case, DPR, sample time and what differs. */
export function animCaseReport(c: AnimCase, dprs: readonly number[] = [1, 2, 2.625, 3], faults: rtEasing.RtFaults = rtEasing.NO_RT_FAULTS, anim: AnimFaults = NO_ANIM_FAULTS, frames: typeof committedFrames = committedFrames): Omit<AnimReport, 'cases' | 'passingCases'> {
  const failures: string[] = [];
  const steps = frameScript(c);
  const dumps = runFrameScript(c, steps, faults, anim);
  const tracked = trackedProperties(c.ap);
  let samples = 0;
  let values = 0;
  let boxes = 0;
  let dual = 0;
  let settles = 0;
  const trig = { sin: Math.sin, cos: Math.cos };
  for (const dpr of dprs) {
    const cap = frames(c.id, 'authored', dpr);
    if (cap === null) {
      failures.push(`${c.id} DPR ${dpr}: no committed frame capture (pnpm run parity:anim-capture)`);
      continue;
    }
    if (cap.steps !== steps.length || cap.samples.length !== dumps.length) {
      failures.push(`${c.id} DPR ${dpr}: the capture has ${cap.samples.length} samples of ${cap.steps} steps, the script ${dumps.length} of ${steps.length}`);
      continue;
    }
    const env = { viewport: c.viewport, devicePixelRatio: dpr, direction: c.direction, rootFont: 'ahem' as const };
    cap.samples.forEach((s, i) => {
      const d = dumps[i] as FrameDump;
      const shown = closureFrame(d.frame, c.ap, anim);
      samples++;
      if (s.at !== d.at) failures.push(`${c.id} DPR ${dpr} sample ${i}: captured at ${s.at} ms, scripted at ${d.at} ms`);
      for (const t of tracked) {
        if (!STRING_COMPARED(t.property)) continue;
        const node = s.nodes.find((n) => n.id === t.node);
        if (node === undefined || !node.hasBox) continue;
        const want = (node.computed ?? {})[t.property];
        const mine = shown.get(trackKey(t.node, t.property)) ?? staticValue(c, d, t.node, t.property);
        if (mine === null) continue;
        values++;
        const got = rtInterpolate.serializeValue(mine, 0, 0, trig);
        if (got !== want) failures.push(`${c.id} DPR ${dpr} t=${s.at} ${t.node} ${t.property}: chrome ${String(want)}, dragon ${got}`);
      }
      const input = programInput(d.program, c.viewport, dpr);
      const out = layout(input, referenceMeasurer());
      if (out.kind !== 'ok') {
        failures.push(`${c.id} DPR ${dpr} t=${s.at}: the engine refused the live program`);
        return;
      }
      const capture = { fixture: c.id, chrome: cap.chrome, browser: '', platform: '', viewport: c.viewport, devicePixelRatio: dpr, direction: c.direction, nodes: s.nodes };
      const cmp = compareZoomedLayout(capture, absoluteRects(out.boxes), input, env);
      boxes += cmp.nodes.length;
      for (const p of cmp.problems) failures.push(`${c.id} DPR ${dpr} t=${s.at}: ${p}`);
      for (const n of cmp.nodes) if (n.dragon !== null && !n.exactLu) failures.push(`${c.id} DPR ${dpr} t=${s.at} ${n.id}: not exact in zoomed LU (chrome ${JSON.stringify(n.chrome)}, engine LU ${JSON.stringify(n.dragonLu)})`);
      if (s.settle && dpr === dprs[0]) {
        settles++;
        // The settle rule (R16): past every transition's end, the live program is the end assignment's static program, unless an
        // animation still runs or fills there.
        if (d.frame.size === 0 && canonicalJsonText(d.program) !== canonicalJsonText(programAt(c.sp, d.assignment))) failures.push(`${c.id}: the settle dump differs from the end assignment's static program`);
      }
    });
    if (dpr === 1) {
      const compiled = frames(c.id, 'compiled', 1);
      if (compiled === null) failures.push(`${c.id}: no committed compiled-rendering capture (chrome-dual)`);
      else {
        // Judged over every authored sample: a short, empty or stale compiled capture fails rather than proving its prefix.
        if (compiled.steps !== cap.steps || compiled.samples.length !== cap.samples.length) failures.push(`${c.id}: chrome-dual: the compiled capture has ${compiled.samples.length} samples of ${compiled.steps} steps, the authored one ${cap.samples.length} of ${cap.steps}`);
        cap.samples.forEach((a, i) => {
          dual++;
          const s = compiled.samples[i];
          if (s === undefined || s.at !== a.at || canonicalJsonText(s.nodes) !== canonicalJsonText(a.nodes)) failures.push(`${c.id} t=${a.at}: chrome-dual: the compiled rendering differs from the authored one`);
        });
      }
    }
  }
  return { samples, values, boxes, dual, settles, failures };
}

/** A tracked property's static value in a dump's assignment when nothing animates it: colours from the tables, margins from the engine input. */
function staticValue(c: AnimCase, d: FrameDump, node: string, property: string): rtInterpolate.AnimatedValue | null {
  const slot = c.ap.slots.find((s) => s.node === node && s.property === property);
  const base = c.ap.bases.find((b) => b.node === node && b.property === property);
  const v = (slot?.values[d.assignment] ?? base?.values[d.assignment]) ?? null;
  if (v === null) {
    // R9: a closure write inherits its source's colour or is currentcolor of it, so its static value is the source's.
    const source = c.ap.closure.find((x) => x.writes.some((w) => w.node === node && w.property === property))?.source;
    return source === undefined ? null : staticValue(c, d, source.node, source.property);
  }
  if (v.kind === 'color') return { kind: 'color', number: 0, length: rtInterpolate.ZERO_PX, color: rtInterpolate.legacyColor(v.r, v.g, v.b, v.alpha), ops: [] };
  if (v.kind === 'length' && !v.calc) return { kind: 'length', number: 0, length: v.percent !== 0 ? rtInterpolate.lengthPercent(v.percent) : rtInterpolate.lengthPx(v.px), color: rtInterpolate.TRANSPARENT, ops: [] };
  return null;
}

/** Every frame case's host lanes. */
export function animReport(dprs: readonly number[] = [1, 2, 2.625, 3]): AnimReport {
  const cases = animFixtures().flatMap(animCasesOf);
  const failures: string[] = [];
  const passingCases: string[] = [];
  const total = { samples: 0, values: 0, boxes: 0, dual: 0, settles: 0 };
  for (const c of cases) {
    const r = animCaseReport(c, dprs);
    failures.push(...r.failures);
    if (r.failures.length === 0) passingCases.push(c.id);
    total.samples += r.samples;
    total.values += r.values;
    total.boxes += r.boxes;
    total.dual += r.dual;
    total.settles += r.settles;
  }
  return { cases: cases.length, ...total, failures, passingCases };
}
