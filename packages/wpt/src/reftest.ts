// reftest-layout (EXPERIMENTAL, report-only): pure-layout reftests made numeric. A reftest qualifies when both the test and its
// one match reference are box-only pages (no script, no text, no replaced or foreign content), Dragon can lay the test out, and
// a box paint model reproduces Chrome's own screenshots of both pages pixel for pixel.
//
// The paint model: each element's border box is filled with its background colour, then its solid single-colour borders, in a
// simplified CSS 2 Appendix E order (block backgrounds, then floats, then atomic inlines, each atomically; then positioned
// elements in tree order), clipped by overflow clips, over the canvas colour. Anything the model does not draw exactly
// (background images, shadows, outlines, radii, opacity, transforms, z-index, non-solid or multi-colour borders, markers,
// generated content, scrollbars, inline boxes with paint, page overflow) is refused in the page.
//
// The verdict compares Dragon's layout of the TEST, painted with the test's colours as Chrome computed them, against Chrome's
// layout of the REFERENCE: pass when the two rasters are identical. It also reports how many of the test's element boxes Dragon
// places exactly where Chrome places them on the test page. Colours come from Chrome; every geometry in Dragon's raster is
// Dragon's (its border boxes and its resolved border widths).
//
// Chrome captures are committed under packages/wpt/reftest-captures/ so the verdicts can be recomputed without Chrome. None of
// this counts toward the headline pass number or wpt:check's gate.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import type { LayoutRect } from '@dragon/layout';
import { absoluteRects, LU_PER_PX } from '@dragon/layout';
import { resolveBorder } from '../../layout/src/box.ts';
import type { Browser } from './chrome.ts';
import type { DomDocument, DomElement } from './dom.ts';
import { isElement, XHTML_NS } from './dom.ts';
import type { LaidOut, Target } from './dragon.ts';
import { layOutTranslation } from './dragon.ts';
import { packagePath } from './paths.ts';
import { decodePng } from './png.ts';
import type { ReadWpt, Translation } from './translate.ts';
import { parseWptDocument, resolveHref, translateDocument, WPT_VIEWPORT } from './translate.ts';

export const REFTEST_LAYOUT_KIND = 'reftest-layout';

/** One element of a page in document order (document.getElementsByTagName('*')), with what the paint model needs. */
export type PaintElement = {
  /** Parent index, -1 for the root. */
  readonly p: number;
  readonly tag: string;
  /** Border box [x, y, width, height] in CSS px; null when the element generates no box. */
  readonly box: readonly [number, number, number, number] | null;
  /** Background colour 0xRRGGBB; null when transparent. */
  readonly bg: number | null;
  /** Used border widths [top, right, bottom, left] in CSS px. */
  readonly bw: readonly [number, number, number, number];
  /** The one colour of every non-zero border side; null when there is no border. */
  readonly bc: number | null;
  readonly display: string;
  readonly position: string;
  readonly float: boolean;
  /** overflow is not visible: descendants are clipped to the padding box. */
  readonly clip: boolean;
  readonly visible: boolean;
};

export type PagePaint = { readonly canvas: number; readonly canvasFrom: 'html' | 'body' | null; readonly els: readonly PaintElement[] };

export type ReftestCapture = {
  readonly source: string;
  readonly ref: string;
  readonly wpt: string;
  readonly chrome: string;
  readonly result: { readonly refused: string } | { readonly test: PagePaint; readonly ref: PagePaint };
};

export type ReftestEntry =
  | {
      readonly status: 'pass' | 'fail';
      readonly ref: string;
      /** Pixels where Dragon's raster of the test differs from Chrome's raster of the reference (800x600). */
      readonly differingPixels: number;
      /** Elements with a box in Chrome's test page, and how many Dragon places at the same border box (within 1/64 px). */
      readonly geometry: { readonly match: number; readonly total: number };
    }
  | { readonly status: 'not-runnable'; readonly missing: string };

export type ReftestLayoutReport = {
  readonly wpt: string;
  readonly target: Target;
  readonly profileRevision: string;
  readonly kind: typeof REFTEST_LAYOUT_KIND;
  /** Reftest files refused before Dragon ran, by reason (they are not listed one by one). */
  readonly excluded: { readonly [reason: string]: number };
  /** Every reftest that passed the static filter: its verdict, or why it did not reach one. */
  readonly tests: { readonly [path: string]: ReftestEntry };
};

// ---------------------------------------------------------------------------------------------------------------------------
// The static filter.

const REPLACED = new Set(['img', 'svg', 'canvas', 'iframe', 'object', 'embed', 'video', 'audio', 'input', 'button', 'select', 'textarea', 'math', 'picture', 'frame', 'frameset', 'meter', 'progress']);
/** Elements with their own rendering (UA widgets, markers, legends) that the box paint model does not draw. */
const SPECIAL = new Set(['marquee', 'details', 'summary', 'dialog', 'fieldset', 'legend']);

const relTokens = (e: DomElement): string[] => (e.attrs.find(([k]) => k === 'rel')?.[1] ?? '').toLowerCase().split(/\s+/);
const attr = (e: DomElement, name: string): string | undefined => e.attrs.find(([k]) => k === name)?.[1];

function* elements(e: DomElement): Generator<DomElement> {
  yield e;
  for (const c of e.children) if (isElement(c)) yield* elements(c);
}

/** Why a page (test or reference) is outside the box-only subset, or null. */
function pageProblem(doc: DomDocument): string | null {
  const body = [...elements(doc.root)].find((e) => e.tag === 'body' && e.ns === XHTML_NS);
  for (const e of elements(doc.root)) {
    if (e.tag === 'script') return 'reftest-layout:script';
    if (e.ns !== XHTML_NS || REPLACED.has(e.tag)) return 'reftest-layout:replaced';
    if (SPECIAL.has(e.tag)) return 'reftest-layout:special-element';
    if (Array.from(e.attrs).some(([k]) => k.startsWith('on'))) return 'reftest-layout:script';
  }
  if (body !== undefined) {
    for (const e of elements(body)) {
      if (e.tag === 'style' || e.tag === 'title') continue;
      if (e.children.some((c) => !isElement(c) && c.text.trim() !== '')) return 'reftest-layout:text';
    }
  }
  return null;
}

export type Candidate =
  | { readonly kind: 'excluded'; readonly missing: string }
  | { readonly kind: 'candidate'; readonly ref: string; readonly translation: Translation };

/** The static filter for one reftest: its one match reference, both pages box-only, and the test's fixture. */
export function reftestCandidate(path: string, source: string, commit: string, readWpt: ReadWpt): Candidate {
  const excluded = (missing: string): Candidate => ({ kind: 'excluded', missing });
  const doc = parseWptDocument(path, source);
  if ('missing' in doc) return excluded(doc.missing);
  const links = [...elements(doc.root)].filter((e) => e.tag === 'link');
  if (links.some((e) => relTokens(e).includes('mismatch'))) return excluded('reftest-layout:mismatch');
  const matches = links.filter((e) => relTokens(e).includes('match'));
  if (matches.length !== 1) return excluded('reftest-layout:multiple-refs');
  if ([...elements(doc.root)].some((e) => e.tag === 'meta' && attr(e, 'name') === 'fuzzy')) return excluded('reftest-layout:fuzzy');
  if (/\breftest-wait\b/.test(attr(doc.root, 'class') ?? '')) return excluded('reftest-layout:reftest-wait');
  const ref = resolveHref(path, attr(matches[0] as DomElement, 'href') ?? '');
  const refSource = ref === null ? null : readWpt(ref);
  if (ref === null || refSource === null) return excluded('reftest-layout:ref-missing');
  const refDoc = parseWptDocument(ref, refSource);
  if ('missing' in refDoc) return excluded('reftest-layout:ref-parse');
  if ([...elements(refDoc.root)].some((e) => e.tag === 'link' && (relTokens(e).includes('match') || relTokens(e).includes('mismatch')))) return excluded('reftest-layout:ref-chain');
  const problem = pageProblem(doc) ?? pageProblem(refDoc);
  if (problem !== null) return excluded(problem);
  return { kind: 'candidate', ref, translation: translateDocument(path, doc, commit, readWpt, { mode: 'reftest' }) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Chrome.

/** Runs in the page: the paint list of every element, or the first reason the paint model cannot draw the page exactly. */
function collectPaint(): { refused: string } | PagePaint {
  const els = Array.from(document.getElementsByTagName('*'));
  const index = new Map<Element, number>(els.map((e, i) => [e, i]));
  const color = (c: string): number | null | 'alpha' => {
    const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(c);
    if (m === null) return 'alpha';
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (a === 0) return null;
    if (a !== 1) return 'alpha';
    return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
  };
  const root = document.documentElement;
  if (root.scrollWidth > innerWidth || root.scrollHeight > innerHeight) return { refused: 'reftest-layout:page-overflow' };
  const out: PaintElement[] = [];
  for (const el of els) {
    const cs = getComputedStyle(el);
    const rects = el.getClientRects();
    const r = el.getBoundingClientRect();
    const box: [number, number, number, number] | null = rects.length === 0 ? null : [r.x, r.y, r.width, r.height];
    const bg = color(cs.backgroundColor);
    if (bg === 'alpha') return { refused: 'reftest-layout:paint:alpha' };
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const bw = sides.map((s) => Number.parseFloat(cs.getPropertyValue(`border-${s}-width`))) as [number, number, number, number];
    let bc: number | null = null;
    for (const [k, s] of sides.entries()) {
      if ((bw[k] as number) === 0) continue;
      if (cs.getPropertyValue(`border-${s}-style`) !== 'solid') return { refused: 'reftest-layout:paint:border-style' };
      const c = color(cs.getPropertyValue(`border-${s}-color`));
      if (c === 'alpha' || c === null) return { refused: 'reftest-layout:paint:alpha' };
      if (bc !== null && bc !== c) return { refused: 'reftest-layout:paint:border-corner' };
      bc = c;
    }
    const visible = cs.visibility === 'visible';
    const paints = box !== null && visible && (bg !== null || bc !== null);
    if (box !== null) {
      if (cs.backgroundImage !== 'none') return { refused: 'reftest-layout:paint:background-image' };
      if (cs.boxShadow !== 'none') return { refused: 'reftest-layout:paint:box-shadow' };
      if (cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px') return { refused: 'reftest-layout:paint:outline' };
      if (cs.opacity !== '1') return { refused: 'reftest-layout:paint:opacity' };
      if (cs.transform !== 'none') return { refused: 'reftest-layout:paint:transform' };
      if (cs.filter !== 'none' || cs.backdropFilter !== 'none' || cs.clipPath !== 'none' || cs.maskImage !== 'none' || cs.mixBlendMode !== 'normal') return { refused: 'reftest-layout:paint:effect' };
      if (['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius'].some((p) => cs.getPropertyValue(p) !== '0px')) return { refused: 'reftest-layout:paint:border-radius' };
      if (cs.zIndex !== 'auto') return { refused: 'reftest-layout:paint:z-index' };
      if (cs.display.includes('list-item') && cs.listStyleType !== 'none') return { refused: 'reftest-layout:paint:list-marker' };
      for (const pseudo of ['::before', '::after', '::marker']) {
        const c = getComputedStyle(el, pseudo).content;
        if (c !== 'none' && c !== 'normal') return { refused: 'reftest-layout:paint:generated-content' };
      }
      if (cs.overflowX === 'scroll' || cs.overflowY === 'scroll' || ((cs.overflowX === 'auto' || cs.overflowY === 'auto') && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth))) return { refused: 'reftest-layout:paint:scrollbar' };
      if (cs.columnRuleStyle !== 'none' && cs.columnRuleWidth !== '0px') return { refused: 'reftest-layout:paint:column-rule' };
      if (cs.backgroundClip !== 'border-box' && bg !== null) return { refused: 'reftest-layout:paint:background-clip' };
      if (cs.borderCollapse === 'collapse' && bc !== null) return { refused: 'reftest-layout:paint:collapsed-borders' };
      if (paints && cs.display === 'inline') return { refused: 'reftest-layout:paint:inline-box' };
      if (paints && rects.length > 1) return { refused: 'reftest-layout:paint:fragments' };
    }
    out.push({
      p: el.parentElement === null ? -1 : (index.get(el.parentElement) ?? -1),
      tag: el.localName,
      box,
      bg,
      bw,
      bc,
      display: cs.display,
      position: cs.position,
      float: cs.float !== 'none',
      clip: cs.overflowX !== 'visible' || cs.overflowY !== 'visible',
      visible,
    });
  }
  const html = out[0];
  const body = els.findIndex((e) => e.localName === 'body' && e.parentElement === root);
  const canvasFrom = html !== undefined && html.bg !== null ? 'html' : body >= 0 && out[body]?.bg !== null && out[body]?.bg !== undefined ? 'body' : null;
  const canvas = canvasFrom === 'html' ? (html?.bg as number) : canvasFrom === 'body' ? (out[body]?.bg as number) : 0xffffff;
  return { canvas, canvasFrom, els: out };
}

async function capturePage(browser: Browser, url: string): Promise<{ paint: { refused: string } | PagePaint; pixels: Uint32Array; userAgent: string }> {
  const context = await browser.newContext({ viewport: { ...WPT_VIEWPORT }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const paint = await page.evaluate(collectPaint);
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...WPT_VIEWPORT }, animations: 'disabled', caret: 'hide' });
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return { paint, pixels: decodePng(png).rgb, userAgent };
  } finally {
    await context.close();
  }
}

const differing = (a: Uint32Array, b: Uint32Array): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

/** Captures the test and its reference; the model must reproduce both screenshots, and the two screenshots must be equal. */
export async function captureReftest(browser: Browser, origin: string, path: string, ref: string, commit: string): Promise<ReftestCapture> {
  const test = await capturePage(browser, `${origin}/${path}`);
  const reference = await capturePage(browser, `${origin}/${ref}`);
  const chrome = /Chrome\/([\d.]+)/.exec(test.userAgent)?.[1] ?? 'unknown';
  const done = (result: ReftestCapture['result']): ReftestCapture => ({ source: path, ref, wpt: commit, chrome, result });
  if ('refused' in test.paint) return done({ refused: test.paint.refused });
  if ('refused' in reference.paint) return done({ refused: `${reference.paint.refused}@ref` });
  if (differing(test.pixels, reference.pixels) > 0) return done({ refused: 'reftest-layout:chrome-fails' });
  if (differing(rasterize(test.paint, chromeGeometry(test.paint)), test.pixels) > 0) return done({ refused: 'reftest-layout:model-mismatch' });
  if (differing(rasterize(reference.paint, chromeGeometry(reference.paint)), reference.pixels) > 0) return done({ refused: 'reftest-layout:model-mismatch@ref' });
  return done({ test: test.paint, ref: reference.paint });
}

// ---------------------------------------------------------------------------------------------------------------------------
// The paint model.

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
/** Border box and used border widths [top, right, bottom, left] of an element, or null when it has no box. */
export type Geometry = (i: number) => { readonly box: Rect; readonly bw: readonly [number, number, number, number] } | null;

export const chromeGeometry = (page: PagePaint): Geometry => (i) => {
  const e = page.els[i];
  if (e === undefined || e.box === null) return null;
  return { box: { x: e.box[0], y: e.box[1], w: e.box[2], h: e.box[3] }, bw: e.bw };
};

/** Simplified CSS 2 Appendix E painting order (see the header): element indexes in the order their boxes paint. */
export function paintOrder(els: readonly PaintElement[]): number[] {
  const kids: number[][] = els.map(() => []);
  els.forEach((e, i) => {
    if (e.p >= 0) kids[e.p]?.push(i);
  });
  const out: number[] = [];
  const positioned: number[] = [];
  const paintAtomic = (i: number): void => {
    out.push(i);
    const floats: number[] = [];
    const atomics: number[] = [];
    const blocks = (j: number): void => {
      for (const c of kids[j] ?? []) {
        const e = els[c] as PaintElement;
        if (e.position !== 'static') positioned.push(c);
        else if (e.float) floats.push(c);
        else if (e.display.startsWith('inline-')) atomics.push(c);
        else {
          out.push(c);
          blocks(c);
        }
      }
    };
    blocks(i);
    for (const f of floats) paintAtomic(f);
    for (const a of atomics) paintAtomic(a);
  };
  if (els.length > 0) paintAtomic(0);
  while (positioned.length > 0) {
    positioned.sort((a, b) => a - b);
    paintAtomic(positioned.shift() as number);
  }
  return out;
}

const snap = (r: Rect): [number, number, number, number] => [Math.round(r.x), Math.round(r.y), Math.round(r.x + r.w), Math.round(r.y + r.h)];

/** The page painted by the model at 800x600: colours and order from the paint list, boxes and border widths from geometry. */
export function rasterize(page: PagePaint, geometry: Geometry): Uint32Array {
  const { width: W, height: H } = WPT_VIEWPORT;
  const px = new Uint32Array(W * H).fill(page.canvas);
  const els = page.els;
  const full: [number, number, number, number] = [0, 0, W, H];
  const clipCache = new Map<number, [number, number, number, number]>();
  const meet = (a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  /** The clip an element applies to what its containing block chain passes through: its padding box when it clips. */
  const descendantClip = (i: number): [number, number, number, number] => {
    const hit = clipCache.get(i);
    if (hit !== undefined) return hit;
    const e = els[i] as PaintElement;
    const g = geometry(i);
    let c = ownClip(i);
    if (e.clip && g !== null) {
      const [x0, y0, x1, y1] = snap(g.box);
      c = meet(c, [x0 + Math.round(g.bw[3]), y0 + Math.round(g.bw[0]), x1 - Math.round(g.bw[1]), y1 - Math.round(g.bw[2])]);
    }
    clipCache.set(i, c);
    return c;
  };
  const ownClip = (i: number): [number, number, number, number] => {
    const e = els[i] as PaintElement;
    if (e.p < 0 || e.position === 'fixed') return full;
    if (e.position === 'absolute') {
      for (let a = e.p; a >= 0; a = (els[a] as PaintElement).p) if ((els[a] as PaintElement).position !== 'static') return descendantClip(a);
      return full;
    }
    return descendantClip(e.p);
  };
  const fill = (r: [number, number, number, number], clip: [number, number, number, number], color: number): void => {
    const [x0, y0, x1, y1] = meet(r, meet(clip, full));
    for (let y = y0; y < y1; y++) px.fill(color, y * W + x0, y * W + Math.max(x0, x1));
  };
  for (const i of paintOrder(els)) {
    const e = els[i] as PaintElement;
    const g = geometry(i);
    if (g === null || !e.visible) continue;
    // The root's background (or the body's, when the root has none) is the canvas's; only the background propagates.
    const propagated = (i === 0 && page.canvasFrom === 'html') || (page.canvasFrom === 'body' && e.tag === 'body' && e.p === 0);
    const clip = ownClip(i);
    const [x0, y0, x1, y1] = snap(g.box);
    if (e.bg !== null && !propagated) fill([x0, y0, x1, y1], clip, e.bg);
    if (e.bc !== null) {
      const [t, r, b, l] = g.bw.map((w) => Math.round(w)) as [number, number, number, number];
      fill([x0, y0, x1, y0 + t], clip, e.bc);
      fill([x0, y1 - b, x1, y1], clip, e.bc);
      fill([x0, y0 + t, x0 + l, y1 - b], clip, e.bc);
      fill([x1 - r, y0 + t, x1, y1 - b], clip, e.bc);
    }
  }
  return px;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The verdict.

/** Dragon's geometry of the test page by Chrome element index: its border boxes and its resolved border widths. */
export function dragonGeometry(t: Extract<Translation, { kind: 'fixture' }>, laid: Extract<LaidOut, { kind: 'laid-out' }>): Geometry {
  const abs: ReadonlyMap<string, LayoutRect> = absoluteRects(laid.boxes);
  const styles = new Map<string, Parameters<typeof resolveBorder>[0]>();
  const walk = (b: (typeof laid.input)['root']): void => {
    styles.set(b.id, b.style);
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else if (c.kind === 'replaced') styles.set(c.id, c.style);
    }
  };
  walk(laid.input.root);
  const byIndex = new Map<number, string>();
  for (const [id, e] of t.elements) byIndex.set(e.index, id);
  return (i) => {
    const id = byIndex.get(i);
    const r = id === undefined ? undefined : abs.get(id);
    const s = id === undefined ? undefined : styles.get(id);
    if (r === undefined || s === undefined) return null;
    const b = resolveBorder(s, laid.input.devicePixelRatio);
    return { box: { x: r.x / LU_PER_PX, y: r.y / LU_PER_PX, w: r.width / LU_PER_PX, h: r.height / LU_PER_PX }, bw: [b.top / LU_PER_PX, b.right / LU_PER_PX, b.bottom / LU_PER_PX, b.left / LU_PER_PX] };
  };
}

export function judgeReftest(t: Extract<Translation, { kind: 'fixture' }>, laid: Extract<LaidOut, { kind: 'laid-out' }>, capture: Extract<ReftestCapture['result'], { test: PagePaint }>, ref: string): ReftestEntry {
  return judgeGeometry(dragonGeometry(t, laid), capture, ref);
}

/** The verdict for any geometry of the test page (Dragon's in the lane; a planted one in the tests). */
export function judgeGeometry(dragon: Geometry, capture: Extract<ReftestCapture['result'], { test: PagePaint }>, ref: string): ReftestEntry {
  const mine = rasterize(capture.test, dragon);
  const theirs = rasterize(capture.ref, chromeGeometry(capture.ref));
  const differingPixels = differing(mine, theirs);
  const chrome = chromeGeometry(capture.test);
  let match = 0;
  let total = 0;
  capture.test.els.forEach((_e, i) => {
    const c = chrome(i);
    if (c === null) return;
    total++;
    const d = dragon(i);
    const close = (a: number, b: number): boolean => Math.abs(a - b) < 1 / LU_PER_PX;
    if (d !== null && close(d.box.x, c.box.x) && close(d.box.y, c.box.y) && close(d.box.w, c.box.w) && close(d.box.h, c.box.h)) match++;
  });
  return { status: differingPixels === 0 ? 'pass' : 'fail', ref, differingPixels, geometry: { match, total } };
}

/** The Dragon side of one reftest, before Chrome: excluded, blocked by Dragon, or laid out and waiting for a capture. */
export function reftestDragonSide(path: string, source: string, commit: string, target: Target, readWpt: ReadWpt):
  | { readonly kind: 'excluded'; readonly missing: string }
  | { readonly kind: 'blocked'; readonly missing: string; readonly ref: string }
  | { readonly kind: 'laid-out'; readonly ref: string; readonly translation: Extract<Translation, { kind: 'fixture' }>; readonly laid: Extract<LaidOut, { kind: 'laid-out' }> } {
  const c = reftestCandidate(path, source, commit, readWpt);
  if (c.kind === 'excluded') return c;
  if (c.translation.kind === 'refused') return { kind: 'blocked', missing: c.translation.missing, ref: c.ref };
  const laid = layOutTranslation(c.translation, target);
  if (laid.kind === 'blocked') return { kind: 'blocked', missing: laid.missing, ref: c.ref };
  return { kind: 'laid-out', ref: c.ref, translation: c.translation, laid };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The capture store and the report file.

export const REFTEST_CAPTURE_DIR = packagePath('reftest-captures');
export const RUN_REFTEST_CAPTURE_DIR = packagePath('out/reftest-captures');
const captureFile = (dir: string, path: string): string => join(dir, `${path}.json`);

export function readReftestCapture(dir: string, path: string): ReftestCapture | null {
  const f = captureFile(dir, path);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ReftestCapture) : null;
}

export function writeReftestCapture(dir: string, c: ReftestCapture): void {
  const f = captureFile(dir, c.source);
  mkdirSync(dirname(f), { recursive: true });
  const r = c.result;
  const body = 'refused' in r ? JSON.stringify(r) : `{\n    "ref": ${JSON.stringify(r.ref)},\n    "test": ${JSON.stringify(r.test)}\n  }`;
  writeFileSync(f, `{\n  "source": ${JSON.stringify(c.source)},\n  "ref": ${JSON.stringify(c.ref)},\n  "wpt": ${JSON.stringify(c.wpt)},\n  "chrome": ${JSON.stringify(c.chrome)},\n  "result": ${body}\n}\n`);
}

export function replaceReftestCaptures(from: string, to: string): number {
  rmSync(to, { recursive: true, force: true });
  let n = 0;
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.json')) {
        const path = relative(from, join(d, e.name)).slice(0, -'.json'.length).split('\\').join('/');
        writeReftestCapture(to, readReftestCapture(from, path) as ReftestCapture);
        n++;
      }
    }
  };
  walk(from);
  return n;
}

export const reftestLayoutPath = (target: Target): string => packagePath(`expectations/${target}.${REFTEST_LAYOUT_KIND}.json`);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort(byCodeUnit).map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
};

export function serializeReftestLayout(r: ReftestLayoutReport): string {
  const paths = Object.keys(r.tests).sort(byCodeUnit);
  const lines = paths.map((p, i) => `    ${JSON.stringify(p)}: ${JSON.stringify(sortKeys(r.tests[p]))}${i === paths.length - 1 ? '' : ','}`);
  return `{\n  "excluded": ${JSON.stringify(sortKeys(r.excluded))},\n  "kind": ${JSON.stringify(r.kind)},\n  "profileRevision": ${JSON.stringify(r.profileRevision)},\n  "target": ${JSON.stringify(r.target)},\n  "tests": {\n${lines.join('\n')}\n  },\n  "wpt": ${JSON.stringify(r.wpt)}\n}\n`;
}

/** Report-only differences between a committed reftest-layout report and a recomputed one (never part of wpt:check's gate). */
export function compareReftestLayout(expected: ReftestLayoutReport, actual: ReftestLayoutReport): string[] {
  const out: string[] = [];
  const describe = (e: ReftestEntry | undefined): string => (e === undefined ? 'absent' : e.status === 'not-runnable' ? `not-runnable (${e.missing})` : `${e.status} (${e.differingPixels} px, geometry ${e.geometry.match}/${e.geometry.total})`);
  for (const p of [...new Set([...Object.keys(expected.tests), ...Object.keys(actual.tests)])].sort(byCodeUnit)) {
    const a = describe(expected.tests[p]);
    const b = describe(actual.tests[p]);
    if (a !== b) out.push(`${p}: ${a} -> ${b}`);
  }
  if (JSON.stringify(sortKeys(expected.excluded)) !== JSON.stringify(sortKeys(actual.excluded))) out.push('excluded counts changed');
  return out;
}
