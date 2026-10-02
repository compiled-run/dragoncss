// Chrome reference of the north-star device lane: every case of the lane manifest (tools/lane-manifest.ts) at every platform
// viewport and DPR, in the pinned Chrome (Playwright 1.58.2, chromium-1208) launched with the parity lane's flags at
// --force-device-scale-factor=N and checked by the lane's zoom guard. Per capture it writes chrome/<platform>/dpr-<d>/<case>.png
// (the viewport, CDP Page.captureScreenshot) and <case>.json (boxes, computed values, text lines with their start/end offsets,
// platform fonts, animation clocks), on a virtual clock: timeline rate 0 and every currentTime set explicitly. Also writes
// covers/*.png, lane/manifest.json and chrome/pixel-manifest.json.
// Network is closed: styles.css is served from disk, the four YouTube covers by the committed PNG stand-ins, and the YouTube
// embed by an empty HTML document (snapshot.ts EMBED_STAND_IN). Any other request fails the capture.
// Fonts are the stated reference of the north star's font map (tools/font-map.ts; notes/T033 §1.3): the pinned faces injected as
// @font-face rules from the vendored bytes, and every unquoted pinned generic replaced by its family in Chrome's own CSSOM.
//   node --conditions=dragon-internal examples/music-player/tools/capture-chrome.ts
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CHROME_VERSION, chromeArgsAt, launchChrome, PLAYWRIGHT_VERSION } from '../../../packages/parity/src/chrome.ts';
import { zoomGuard } from '../../../packages/parity/src/dpr.ts';
import { applyFontReference, fontDataUrl, pinnedFaceCss, pinnedGenerics, VENDOR_FONTS, vendorFontBytes } from '../../../packages/parity/src/font-reference.ts';
import type { Visit } from '../../../packages/parity/src/font-reference.ts';
import { COVER_HEIGHT, COVER_IDS, COVER_WIDTH, coverFile, coverPng } from './cover-png.ts';
import { inventory, usedProperties } from './css-inventory.ts';
import { FONTS, pinnedFaceSrcs } from './font-map.ts';
import {
  captureDir,
  DUMP_SCHEMA,
  fontKey,
  LANE_DPRS,
  LANE_MANIFEST_FILE,
  LANE_PLATFORMS,
  laneCaptures,
  laneJson,
  laneManifest,
  PIXEL_MANIFEST_FILE,
  PIXEL_SCHEMA,
  pngSize,
  RASTER_RULE,
  rasterSize,
  sha256,
} from './lane-manifest.ts';
import type { LaneCapture, PlatformFont } from './lane-manifest.ts';
import { stateDomOps } from './lane-states.ts';
import { EMBED_STAND_IN, examplePath, freeStateHtml, readSnapshot, VIDEO_EMBED_SRC, withVideoIframe } from './snapshot.ts';
import type { FreeStateId } from './snapshot.ts';

// Playwright's types come through the parity package's launcher; the example has no node_modules of its own.
type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;
type Cdp = Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>;

const ORIGIN = 'https://north-star.dragon.test';
const CONTEXT = { isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'no-preference' } as const;

/** A pinned face src (a repository path under vendor/fonts) as the bytes the compiled output bundles. */
const faceBytes = (src: string): Buffer => {
  if (!src.startsWith(VENDOR_FONTS)) throw new Error(`font map face ${src} is not under ${VENDOR_FONTS}`);
  return vendorFontBytes(src.slice(VENDOR_FONTS.length));
};
const FACE_CSS = pinnedFaceCss(FONTS, (src) => fontDataUrl(faceBytes(src)));
const PINNED_GENERICS = pinnedGenerics(FONTS);

const twoFrames = (page: Page): Promise<void> => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

async function openCase(browser: Browser, cap: LaneCapture, html: string, css: string, covers: ReadonlyMap<string, Uint8Array>): Promise<{ page: Page; cdp: Cdp; visits: Visit[]; refused: readonly string[] }> {
  const context = await browser.newContext({ viewport: cap.platform.viewport, deviceScaleFactor: cap.dpr, ...CONTEXT });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  // The document timeline never advances (a running animation that was ever composited rasterizes differently run to run).
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 0 });
  const refused: string[] = [];
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/`) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (url === `${ORIGIN}/styles.css`) return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    if (url === VIDEO_EMBED_SRC) return route.fulfill({ status: 200, contentType: EMBED_STAND_IN.contentType, body: EMBED_STAND_IN.body });
    const cover = /^https:\/\/i\.ytimg\.com\/vi\/([^/]+)\/maxresdefault\.jpg$/.exec(url);
    const png = cover === null ? undefined : covers.get(cover[1] as string);
    if (png !== undefined) return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png) });
    refused.push(url);
    return route.abort();
  });
  await page.goto(`${ORIGIN}/`);
  // The slot's document is cross-origin to the page, so it is read through its Playwright frame.
  const embedded = await Promise.all(page.frames().filter((f) => f !== page.mainFrame()).map(async (f) => [f.url(), await f.content()]));
  if (JSON.stringify(embedded) !== JSON.stringify([[VIDEO_EMBED_SRC, `<!DOCTYPE html><html><head><meta name="color-scheme" content="${EMBED_STAND_IN.colorScheme}"></head><body></body></html>`]])) throw new Error(`${cap.png}: the video slot did not load the embed stand-in: ${JSON.stringify(embedded)}`);
  const slotScheme = await page.evaluate(() => [...document.querySelectorAll('iframe')].map((f) => getComputedStyle(f).colorScheme));
  if (JSON.stringify(slotScheme) !== JSON.stringify([EMBED_STAND_IN.colorScheme])) throw new Error(`${cap.png}: the video slot's color-scheme is ${JSON.stringify(slotScheme)}, the stand-in declares ${EMBED_STAND_IN.colorScheme}`);
  const visits = await applyFontReference(page, FACE_CSS, PINNED_GENERICS);
  if (!visits.some((v) => v.before !== v.after)) throw new Error(`${cap.png}: the font reference rewrote no font-family`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode()));
    // The virtual clock starts at 0: every animation is held at its start frame and only moved by setting currentTime.
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 0;
    }
  });
  await twoFrames(page);
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  if (dpr !== cap.dpr) throw new Error(`${cap.png}: devicePixelRatio ${dpr}`);
  if (refused.length > 0) throw new Error(`${cap.png}: requests outside the closed network: ${refused.join(', ')}`);
  return { page, cdp, visits, refused };
}

/** Moves the virtual clock: running CSS animations (by their computed play state) and every transition advance by ms. */
async function advance(page: Page, ms: number): Promise<void> {
  if (ms === 0) return;
  await page.evaluate((delta) => {
    for (const a of document.getAnimations()) {
      if (a instanceof CSSAnimation) {
        const target = (a.effect as KeyframeEffect).target as Element;
        if ((getComputedStyle(target).animationPlayState.split(',')[0] ?? '').trim() !== 'running') continue;
      }
      a.currentTime = Number(a.currentTime ?? 0) + delta;
    }
  }, ms);
}

/** Applies a state change as DOM class/text edits; the transitions it starts are held at their start frame. */
async function changeState(page: Page, html: string, from: FreeStateId, to: FreeStateId): Promise<void> {
  const ops = stateDomOps(freeStateHtml(html, from), freeStateHtml(html, to));
  await page.evaluate((list) => {
    for (const op of list) {
      const el = document.querySelector(`[data-dragon-id="${op.id}"]`);
      if (el === null) throw new Error(`no element ${op.id}`);
      if (op.className !== null) el.setAttribute('class', op.className);
      if (op.text !== null) {
        const t = el.firstChild;
        if (t === null || t.nodeType !== Node.TEXT_NODE) throw new Error(`${op.id} has no leading text node`);
        (t as Text).data = op.text;
      }
    }
    for (const a of document.getAnimations()) {
      if (a.playState === 'paused') continue;
      a.pause();
      a.currentTime = 0;
    }
  }, ops);
}

const finishTransitions = (page: Page): Promise<void> =>
  page.evaluate(() => {
    for (const a of document.getAnimations()) if (a instanceof CSSTransition) a.finish();
  });

/**
 * Forces the pseudo-class on the first subject match whose declared properties change under it (else the first match), with
 * the transitions it starts finished. Returns the target's data-dragon-id and whether the forced state changed it.
 */
async function force(page: Page, cdp: Cdp, root: number, cap: LaneCapture, declared: readonly string[]): Promise<{ target: string; changed: boolean }> {
  const f = cap.case.forced;
  if (f === null) throw new Error('not a forced case');
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root, selector: f.subject });
  if (nodeIds.length === 0) throw new Error(`${cap.case.id}: ${f.subject} matches nothing`);
  const read = (i: number): Promise<string> =>
    page.evaluate(([sel, idx, props]) => {
      const el = document.querySelectorAll(sel as string)[idx as number] as Element;
      const cs = getComputedStyle(el);
      return JSON.stringify((props as string[]).map((p) => cs.getPropertyValue(p)));
    }, [f.subject, i, declared] as const);
  const set = async (nodeId: number, on: boolean): Promise<void> => {
    await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: on ? [f.pseudo] : [] });
    await finishTransitions(page);
  };
  let chosen = -1;
  for (let i = 0; i < nodeIds.length && chosen < 0; i++) {
    const before = await read(i);
    await set(nodeIds[i] as number, true);
    if ((await read(i)) !== before) chosen = i;
    else await set(nodeIds[i] as number, false);
  }
  const changed = chosen >= 0;
  if (!changed) {
    chosen = 0;
    await set(nodeIds[0] as number, true);
  }
  const target = await page.evaluate(([sel, idx]) => (document.querySelectorAll(sel as string)[idx as number] as Element).getAttribute('data-dragon-id'), [f.subject, chosen] as const);
  if (target === null) throw new Error(`${cap.case.id}: the forced element has no data-dragon-id`);
  return { target, changed };
}

type Rect = readonly [number, number, number, number];

/** Boxes, computed values, text nodes with line rects and per-line start/end offsets (single-code-unit Range rects grouped by line). */
function dumpPage(props: readonly string[]) {
  const r = (b: DOMRect): [number, number, number, number] => [b.x, b.y, b.width, b.height];
  const blank = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';
  const elements: { id: string; tag: string; className: string; hasBox: boolean; rect: Rect; values: string[] }[] = [];
  const texts: { id: string; data: string; rects: Rect[]; lines: { start: number; end: number; rect: Rect }[] }[] = [];
  for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
    const id = el.getAttribute('data-dragon-id') as string;
    const cs = getComputedStyle(el);
    elements.push({ id, tag: el.localName, className: el.getAttribute('class') ?? '', hasBox: el.getClientRects().length > 0, rect: r(el.getBoundingClientRect()), values: props.map((p) => cs.getPropertyValue(p)) });
    let k = 0;
    let spaces = 0;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const node = child as Text;
      const whole = document.createRange();
      whole.selectNodeContents(node);
      const rects = Array.from(whole.getClientRects()).map(r);
      const isBlank = blank(node.data);
      const textId = isBlank ? `${id}:space${spaces++}` : `${id}:text${k++}`;
      if (isBlank && rects.length === 0) continue;
      const lines: { start: number; end: number; top: number; bottom: number; left: number; right: number }[] = [];
      const unit = document.createRange();
      for (let i = 0; i < node.data.length; i++) {
        unit.setStart(node, i);
        unit.setEnd(node, i + 1);
        const b = Array.from(unit.getClientRects()).find((q) => q.width > 0 || q.height > 0);
        const cur = lines[lines.length - 1];
        if (b === undefined) {
          if (cur !== undefined) cur.end = i + 1;
          continue;
        }
        if (cur === undefined || b.y + b.height / 2 > cur.bottom) {
          if (cur !== undefined) cur.end = i;
          lines.push({ start: cur === undefined ? 0 : i, end: i + 1, top: b.y, bottom: b.y + b.height, left: b.x, right: b.x + b.width });
        } else {
          cur.end = i + 1;
          cur.top = Math.min(cur.top, b.y);
          cur.bottom = Math.max(cur.bottom, b.y + b.height);
          cur.left = Math.min(cur.left, b.x);
          cur.right = Math.max(cur.right, b.x + b.width);
        }
      }
      const last = lines[lines.length - 1];
      if (last !== undefined) last.end = node.data.length;
      texts.push({ id: textId, data: node.data, rects, lines: lines.map((l) => ({ start: l.start, end: l.end, rect: [l.left, l.top, l.right - l.left, l.bottom - l.top] as Rect })) });
    }
  }
  const rootStyle = getComputedStyle(document.documentElement);
  const root: Record<string, string> = {};
  for (const name of [...rootStyle].filter((n) => n.startsWith('--')).sort()) root[name] = rootStyle.getPropertyValue(name).trim();
  const animations = document.getAnimations().map((a) => {
    const target = (a.effect as KeyframeEffect | null)?.target ?? null;
    return {
      target: target === null ? null : (target.closest('[data-dragon-id]')?.getAttribute('data-dragon-id') ?? null),
      kind: a instanceof CSSAnimation ? 'animation' : a instanceof CSSTransition ? 'transition' : 'other',
      name: a instanceof CSSAnimation ? a.animationName : a instanceof CSSTransition ? a.transitionProperty : '',
      currentTime: a.currentTime === null ? null : Number(a.currentTime),
    };
  });
  const se = document.scrollingElement as Element;
  return { scrollY: window.scrollY, scrollHeight: se.scrollHeight, root, animations, elements, texts };
}

async function platformFonts(cdp: Cdp, root: number): Promise<Record<string, (PlatformFont & { glyphCount: number })[]>> {
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root, selector: '[data-dragon-id]' });
  const out: Record<string, (PlatformFont & { glyphCount: number })[]> = {};
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send('DOM.getAttributes', { nodeId });
    const id = attributes[attributes.indexOf('data-dragon-id') + 1] as string;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    if (fonts.length === 0) continue;
    out[id] = fonts.map((f) => ({ familyName: f.familyName, postScriptName: f.postScriptName, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount }));
  }
  return out;
}

type PixelFile = { file: string; platform: string; dpr: number; case: string; kind: 'png' | 'dump'; sha256: string; bytes: number; width?: number; height?: number };

async function captureCase(browser: Browser, cap: LaneCapture, html: string, css: string, covers: ReadonlyMap<string, Uint8Array>, properties: readonly string[], declared: ReadonlyMap<string, readonly string[]>) {
  const c = cap.case;
  const { page, cdp, visits, refused } = await openCase(browser, cap, withVideoIframe(freeStateHtml(html, c.start)), css, covers);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    let now = 0;
    let state = c.start;
    for (const step of c.steps) {
      await advance(page, step.atMs - now);
      now = step.atMs;
      await changeState(page, html, state, step.to);
      state = step.to;
    }
    await advance(page, c.tMs - now);
    const forced = c.forced === null ? null : { ...c.forced, ...(await force(page, cdp, root.nodeId, cap, declared.get(c.forced.selector) ?? [])) };
    if (c.scroll === 'end') await page.evaluate(() => window.scrollTo(0, (document.scrollingElement as Element).scrollHeight));
    await twoFrames(page);
    const dump = await page.evaluate(dumpPage, properties);
    const fonts = await platformFonts(cdp, root.nodeId);
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const png = new Uint8Array(Buffer.from(shot.data, 'base64'));
    const size = pngSize(png);
    const want = { width: rasterSize(cap.platform.viewport.width, cap.dpr), height: rasterSize(cap.platform.viewport.height, cap.dpr) };
    if (size.width !== want.width || size.height !== want.height) throw new Error(`${cap.png}: PNG ${size.width}x${size.height}, the raster rule says ${want.width}x${want.height}`);
    const file = {
      schema: DUMP_SCHEMA,
      chrome: CHROME_VERSION,
      platform: cap.platform.id,
      viewport: cap.platform.viewport,
      dpr: cap.dpr,
      case: c.id,
      state,
      forced,
      tMs: c.tMs,
      properties,
      fonts,
      ...dump,
    };
    const json = laneJson(file);
    mkdirSync(dirname(examplePath(cap.png)), { recursive: true });
    writeFileSync(examplePath(cap.png), png);
    writeFileSync(examplePath(cap.dump), json);
    const base = { platform: cap.platform.id, dpr: cap.dpr, case: c.id };
    const files: PixelFile[] = [
      { file: cap.png, ...base, kind: 'png', sha256: sha256(png), bytes: png.length, ...size },
      { file: cap.dump, ...base, kind: 'dump', sha256: sha256(json), bytes: Buffer.byteLength(json) },
    ];
    if (refused.length > 0) throw new Error(`${cap.png}: requests outside the closed network: ${refused.join(', ')}`);
    return { files, visits, fonts: Object.values(fonts).flat(), elements: dump.elements.length, texts: dump.texts.length, lines: dump.texts.reduce((n, t) => n + t.lines.length, 0) };
  } finally {
    await page.context().close();
  }
}

async function main(): Promise<void> {
  const { html, css } = readSnapshot();
  const properties = usedProperties(css);
  const declared = new Map<string, string[]>();
  for (const d of inventory(css).declarations) {
    for (const part of d.selector.split(',').map((s) => s.trim())) declared.set(part, [...(declared.get(part) ?? []), d.property]);
  }
  const covers = new Map<string, Uint8Array>();
  const coverRows: Record<string, unknown>[] = [];
  mkdirSync(examplePath('covers'), { recursive: true });
  for (const id of COVER_IDS) {
    const png = coverPng(id);
    writeFileSync(examplePath(coverFile(id)), png);
    covers.set(id, png);
    coverRows.push({ videoId: id, file: coverFile(id), sha256: sha256(png), bytes: png.length, width: COVER_WIDTH, height: COVER_HEIGHT });
  }
  mkdirSync(dirname(examplePath(LANE_MANIFEST_FILE)), { recursive: true });
  writeFileSync(examplePath(LANE_MANIFEST_FILE), laneJson(laneManifest(css)));
  rmSync(examplePath('chrome'), { recursive: true, force: true });

  const captures = laneCaptures(css);
  const files: PixelFile[] = [];
  let visits: string | null = null;
  const fonts: PlatformFont[] = [];
  const flags: Record<string, readonly string[]> = {};
  const guards: Record<string, string> = {};
  const counts = new Map<string, { cases: number; elements: number; texts: number; lines: number }>();
  for (const dpr of LANE_DPRS) {
    const browser = await launchChrome(dpr);
    try {
      guards[String(dpr)] = await zoomGuard(browser, dpr);
      flags[String(dpr)] = chromeArgsAt(dpr);
      for (const cap of captures.filter((x) => x.dpr === dpr)) {
        const out = await captureCase(browser, cap, html, css, covers, properties, declared);
        files.push(...out.files);
        const v = JSON.stringify(out.visits);
        if (visits !== null && v !== visits) throw new Error(`${cap.png}: the font reference rewrite differs from the first capture's`);
        visits = v;
        fonts.push(...out.fonts.map((f) => ({ familyName: f.familyName, postScriptName: f.postScriptName, isCustomFont: f.isCustomFont })));
        const key = captureDir(cap.platform, dpr);
        const n = counts.get(key) ?? { cases: 0, elements: 0, texts: 0, lines: 0 };
        counts.set(key, { cases: n.cases + 1, elements: n.elements + out.elements, texts: n.texts + out.texts, lines: n.lines + out.lines });
      }
    } finally {
      await browser.close();
    }
  }
  const distinctFonts = [...new Map(fonts.map((f) => [`${f.familyName}\t${f.postScriptName}\t${f.isCustomFont}`, f])).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, f]) => f);
  const manifest = {
    schema: PIXEL_SCHEMA,
    chrome: CHROME_VERSION,
    playwright: PLAYWRIGHT_VERSION,
    host: `${process.platform}-${process.arch}`,
    flags,
    zoomGuard: guards,
    context: CONTEXT,
    screenshot: 'CDP Page.captureScreenshot, format png, viewport only (captureBeyondViewport false)',
    rasterRule: { ...RASTER_RULE, sizes: LANE_PLATFORMS.flatMap((p) => p.dprs.map((d) => ({ platform: p.id, dpr: d, css: p.viewport, device: { width: p.viewport.width * d, height: p.viewport.height * d }, png: { width: rasterSize(p.viewport.width, d), height: rasterSize(p.viewport.height, d) } }))) },
    fontReference: {
      method: 'notes/T033 §1.3: the pinned faces injected as @font-face rules (data: URLs of the vendored bytes), and every unquoted pinned generic replaced by its family in Chrome\'s CSSOM (packages/parity/src/font-reference.ts applyFontReference)',
      map: FONTS,
      faces: pinnedFaceSrcs(FONTS).map((src) => {
        const bytes = faceBytes(src);
        return { src, sha256: sha256(bytes), bytes: bytes.length };
      }),
      rewrites: JSON.parse(visits ?? '[]') as Visit[],
    },
    fontKey: fontKey(distinctFonts),
    fonts: distinctFonts,
    covers: coverRows,
    embeds: [{ src: VIDEO_EMBED_SRC, standIn: EMBED_STAND_IN.label, contentType: EMBED_STAND_IN.contentType, sha256: sha256(EMBED_STAND_IN.body), bytes: Buffer.byteLength(EMBED_STAND_IN.body) }],
    counts: Object.fromEntries([...counts].map(([k, v]) => [k, v.cases])),
    files,
  };
  writeFileSync(examplePath(PIXEL_MANIFEST_FILE), laneJson(manifest));
  let bytes = 0;
  for (const [key, n] of counts) {
    const b = files.filter((f) => f.file.startsWith(`${key}/`)).reduce((s, f) => s + f.bytes, 0);
    bytes += b;
    console.log(`${key}: ${n.cases} cases, ${n.elements} element boxes, ${n.texts} text nodes, ${n.lines} lines, ${(b / 1e6).toFixed(2)} MB`);
  }
  console.log(`total: ${captures.length} captures, ${(bytes / 1e6).toFixed(2)} MB; font key ${manifest.fontKey} (${distinctFonts.map((f) => f.postScriptName).join(', ')})`);
}

await main();
