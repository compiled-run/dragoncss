// node --conditions=dragon-internal scripts/capture-skia-oracle.ts [--check]
// Captures Chrome 145's CPU-rastered box-shadow blur and linear-gradient pixels (T109 SKIA-0) at DPR 2, 3 and 2.625 into
// docs/research/skia-oracle (PNG crops plus manifest.json). Each launch first proves the software raster path
// (SystemInfo featureStatus) and the zoom guard. Without --check it writes the crops and prints how many pixels the TS
// references (packages/layout/src/paint-blur.ts, paint-dither.ts) match. With --check it captures afresh, requires every
// crop to equal the stored one pixel for pixel and every exact pixel to equal the reference, prints the derived counts,
// and exits 1 on any difference.
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_VERSION, chromeArgsAt, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { zoomGuard } from '../packages/parity/src/dpr.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { BoxShadowSpec, IRect } from '../packages/layout/src/paint-blur.ts';
import { boxShadowOverWhite, NO_BLUR_FAULTS } from '../packages/layout/src/paint-blur.ts';
import type { GradientStop, LinearGradientSpec, Rgba8 } from '../packages/layout/src/paint-dither.ts';
import { ccTileSize, gradientPixel, linearGradientShader, NO_DITHER_FAULTS } from '../packages/layout/src/paint-dither.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;

const OUT_DIR = repoPath('docs/research/skia-oracle');
const SKIA_REVISION = '2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23';
const DPRS = [2, 3, 2.625] as const;
const SHADOW_VIEWPORT = { width: 480, height: 480 };
const GRADIENT_VIEWPORT = { width: 800, height: 400 };
const WHITE: Rgba8 = { r: 255, g: 255, b: 255, a: 255 };
/** The capture host is macOS, so cc tiles are 512 px at every oracle DPR (all >= 2); each page is at least 512 px both ways. */
const TILE_SIZE = (dpr: number): number => ccTileSize(process.platform === 'darwin', dpr);

// ---------------------------------------------------------------------------------------------------------------------
// PNG (8-bit, non-interlaced; gray, RGB or RGBA in, gray or RGB out).

const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE.push(c >>> 0);
}
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w: number, h: number, channels: 1 | 3, px: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : 2;
  const raw = Buffer.alloc(h * (w * channels + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.subarray(y * w * channels, (y + 1) * w * channels)).copy(raw, y * (w * channels + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export type Image = { readonly w: number; readonly h: number; readonly channels: number; readonly px: Uint8Array };
export function decodePng(buf: Buffer): Image {
  let p = 8;
  let w = 0;
  let h = 0;
  let ct = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const n = buf.readUInt32BE(p);
    const t = buf.toString('ascii', p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      if (d[8] !== 8 || d[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs');
      ct = d[9] as number;
    } else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + n;
  }
  const bpp = ct === 0 ? 1 : ct === 2 ? 3 : ct === 6 ? 4 : 0;
  if (bpp === 0) throw new Error(`PNG color type ${ct}`);
  const s = w * bpp;
  const r = inflateSync(Buffer.concat(idat));
  const o = new Uint8Array(h * s);
  for (let y = 0; y < h; y++) {
    const f = r[y * (s + 1)] as number;
    for (let x = 0; x < s; x++) {
      const a = x >= bpp ? (o[y * s + x - bpp] as number) : 0;
      const b = y > 0 ? (o[(y - 1) * s + x] as number) : 0;
      const c = x >= bpp && y > 0 ? (o[(y - 1) * s + x - bpp] as number) : 0;
      const v = r[y * (s + 1) + 1 + x] as number;
      let q = 0;
      if (f === 1) q = a;
      else if (f === 2) q = b;
      else if (f === 3) q = (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a);
        const pb = Math.abs(pp - b);
        const pc = Math.abs(pp - c);
        q = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      o[y * s + x] = (v + q) & 255;
    }
  }
  return { w, h, channels: bpp, px: o };
}

// ---------------------------------------------------------------------------------------------------------------------
// Cases. CSS geometry snaps as Blink snaps a border box: each edge rounds to a device pixel (LayoutUnit is 1/64 px).

export type ShadowCss = { readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly radius: number; readonly blur: number; readonly spread: number; readonly offsetX: number; readonly offsetY: number };
export type GradientCss = { readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly axis: 'x' | 'y'; readonly stops: readonly GradientStop[] };
export type OracleCase =
  | { readonly id: string; readonly family: 'shadow'; readonly dpr: number; readonly css: ShadowCss; readonly device: BoxShadowSpec; readonly crop: IRect; readonly file: string; readonly channels: 1 | 3 }
  | { readonly id: string; readonly family: 'gradient'; readonly dpr: number; readonly css: GradientCss; readonly device: LinearGradientSpec; readonly crop: IRect; readonly file: string; readonly channels: 1 | 3 };
export type Manifest = { readonly chrome: string; readonly skia: string; readonly flags: Record<string, readonly string[]>; readonly featureStatus: Record<string, Record<string, string>>; readonly cases: readonly OracleCase[] };

function snapEdge(cssPx: number, dpr: number): number {
  const lu = cssPx * dpr * 64;
  if (lu !== Math.round(lu)) throw new Error(`${cssPx}px at DPR ${dpr} is not a whole LayoutUnit`);
  const v = cssPx * dpr;
  if (v - Math.floor(v) === 0.5) throw new Error(`${cssPx}px at DPR ${dpr} snaps on a tie`);
  return Math.round(v);
}

/** A zoomed length as Blink stores it (float), required exact so the reference sees the same value. */
function zoomed(cssPx: number, dpr: number): number {
  const v = cssPx * dpr;
  if (Math.fround(v) !== v) throw new Error(`${cssPx}px at DPR ${dpr} is not a float`);
  return v;
}

const SHADOWS: readonly (readonly [string, Omit<ShadowCss, 'left' | 'top'>])[] = [
  // Nine-patch rects (analytic BlurRect): small to large sigma, spread, fractional offsets.
  ['np-b1', { width: 64, height: 48, radius: 0, blur: 1, spread: 0, offsetX: 0, offsetY: 0 }],
  ['np-b4', { width: 64, height: 48, radius: 0, blur: 4, spread: 0, offsetX: 0, offsetY: 0 }],
  ['np-b16', { width: 96, height: 64, radius: 0, blur: 16, spread: 0, offsetX: 0, offsetY: 0 }],
  ['np-b40', { width: 160, height: 160, radius: 0, blur: 40, spread: 0, offsetX: 0, offsetY: 0 }],
  ['np-spread', { width: 64, height: 48, radius: 0, blur: 8, spread: 4, offsetX: 0, offsetY: 0 }],
  ['np-offset', { width: 64, height: 48, radius: 0, blur: 8, spread: 0, offsetX: 6, offsetY: -3 }],
  ['np-inset-spread', { width: 80, height: 64, radius: 0, blur: 6, spread: -8, offsetX: 0, offsetY: 0 }],
  ['np-odd', { width: 37, height: 29, radius: 0, blur: 3, spread: 1, offsetX: 2, offsetY: 5 }],
  // Too small for the nine-patch: the rect mask through SkMaskBlurFilter (triple box, sigma >= 2).
  ['tb-b16', { width: 32, height: 32, radius: 0, blur: 16, spread: 0, offsetX: 0, offsetY: 0 }],
  ['tb-thin', { width: 8, height: 64, radius: 0, blur: 8, spread: 0, offsetX: 0, offsetY: 0 }],
  ['tb-spread', { width: 16, height: 16, radius: 0, blur: 12, spread: 8, offsetX: 8, offsetY: 8 }],
  ['tb-b40', { width: 48, height: 40, radius: 0, blur: 40, spread: 0, offsetX: 0, offsetY: 0 }],
  // A border past kMaxMargin (128): each cc tile blurs a source trimmed to its clip, so pixels near tile edges differ.
  ['tb-b40-wide', { width: 160, height: 120, radius: 0, blur: 40, spread: 0, offsetX: 0, offsetY: 0 }],
  // small_blur (sigma < 2) on a rect mask.
  ['sb-b1', { width: 2, height: 2, radius: 0, blur: 1, spread: 0, offsetX: 0, offsetY: 0 }],
  ['sb-b05', { width: 2, height: 6, radius: 0, blur: 0.5, spread: 0, offsetX: 0, offsetY: 0 }],
  ['sb-thin', { width: 2, height: 40, radius: 0, blur: 1, spread: 0, offsetX: 0, offsetY: 0 }],
  ['sb-b125', { width: 2, height: 24, radius: 0, blur: 1.25, spread: 0, offsetX: 0, offsetY: 3 }],
  // Rounded rects: only pixels that do not depend on anti-aliased arc pixels are compared.
  ['rr-np', { width: 64, height: 64, radius: 8, blur: 4, spread: 0, offsetX: 0, offsetY: 0 }],
  ['rr-tb', { width: 32, height: 32, radius: 6, blur: 16, spread: 0, offsetX: 0, offsetY: 0 }],
  ['rr-sb', { width: 48, height: 48, radius: 8, blur: 1, spread: 0, offsetX: 0, offsetY: 0 }],
  ['rr-offset', { width: 64, height: 48, radius: 12, blur: 6, spread: 0, offsetX: 8, offsetY: 8 }],
];

const rgb = (r: number, g: number, b: number, a = 255): Rgba8 => ({ r, g, b, a });
const GRADIENTS: readonly (readonly [string, Omit<GradientCss, 'left' | 'top'>])[] = [
  ['dark-x', { width: 512, height: 32, axis: 'x', stops: [{ offset: 0, color: rgb(0, 0, 0) }, { offset: 1, color: rgb(16, 16, 16) }] }],
  ['dark-y', { width: 24, height: 256, axis: 'y', stops: [{ offset: 0, color: rgb(0, 0, 0) }, { offset: 1, color: rgb(0, 8, 24) }] }],
  ['colour-3', { width: 400, height: 24, axis: 'x', stops: [{ offset: 0, color: rgb(40, 80, 160) }, { offset: 0.5, color: rgb(200, 120, 30) }, { offset: 1, color: rgb(20, 200, 90) }] }],
  ['uneven', { width: 400, height: 24, axis: 'x', stops: [{ offset: 0, color: rgb(16, 32, 48) }, { offset: 0.3, color: rgb(64, 80, 96) }, { offset: 1, color: rgb(32, 48, 64) }] }],
  ['hard-stop', { width: 128, height: 16, axis: 'x', stops: [{ offset: 0, color: rgb(51, 102, 153) }, { offset: 0.5, color: rgb(51, 102, 153) }, { offset: 0.5, color: rgb(153, 102, 51) }, { offset: 1, color: rgb(153, 102, 51) }] }],
  ['red-transparent', { width: 200, height: 24, axis: 'x', stops: [{ offset: 0, color: rgb(255, 0, 0) }, { offset: 1, color: rgb(0, 0, 0, 0) }] }],
  ['half-alpha-y', { width: 64, height: 128, axis: 'y', stops: [{ offset: 0, color: rgb(0, 0, 255, 128) }, { offset: 1, color: rgb(255, 0, 0, 0) }] }],
];

function hex(c: Rgba8): string {
  return `#${[c.r, c.g, c.b, c.a].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function shadowCase(id: string, base: Omit<ShadowCss, 'left' | 'top'>, dpr: number): OracleCase {
  const extentCss = 1.5 * base.blur + Math.abs(base.spread) + Math.max(Math.abs(base.offsetX), Math.abs(base.offsetY));
  const at = 8 * Math.ceil((extentCss + 8) / 8);
  const css: ShadowCss = { ...base, left: at, top: at };
  const box: IRect = { left: snapEdge(css.left, dpr), top: snapEdge(css.top, dpr), right: snapEdge(css.left + css.width, dpr), bottom: snapEdge(css.top + css.height, dpr) };
  const device: BoxShadowSpec = { box, radius: zoomed(css.radius, dpr), blur: zoomed(css.blur, dpr), spread: zoomed(css.spread, dpr), offsetX: zoomed(css.offsetX, dpr), offsetY: zoomed(css.offsetY, dpr), tileSize: TILE_SIZE(dpr) };
  const ext = Math.ceil(dpr * extentCss) + 3;
  const crop: IRect = { left: Math.max(0, box.left - ext), top: Math.max(0, box.top - ext), right: box.right + ext, bottom: box.bottom + ext };
  if (crop.right > SHADOW_VIEWPORT.width * dpr || crop.bottom > SHADOW_VIEWPORT.height * dpr) throw new Error(`${id}: crop leaves the viewport`);
  return { id, family: 'shadow', dpr, css, device, crop, file: `shadow-${id}-dpr${dpr}.png`, channels: 1 };
}

function gradientCase(id: string, base: Omit<GradientCss, 'left' | 'top'>, dpr: number): OracleCase {
  const css: GradientCss = { ...base, left: 104, top: 40 };
  const left = snapEdge(css.left, dpr);
  const top = snapEdge(css.top, dpr);
  const device: LinearGradientSpec = { destLeft: left, destTop: top, width: snapEdge(css.left + css.width, dpr) - left, height: snapEdge(css.top + css.height, dpr) - top, axis: css.axis, stops: css.stops, tileSize: TILE_SIZE(dpr) };
  const crop: IRect = { left, top, right: left + device.width, bottom: top + device.height };
  if (crop.right > GRADIENT_VIEWPORT.width * dpr || crop.bottom > GRADIENT_VIEWPORT.height * dpr) throw new Error(`${id}: crop leaves the viewport`);
  return { id, family: 'gradient', dpr, css, device, crop, file: `gradient-${id}-dpr${dpr}.png`, channels: 3 };
}

export function oracleCases(): OracleCase[] {
  const out: OracleCase[] = [];
  for (const dpr of DPRS) {
    for (const [id, base] of SHADOWS) out.push(shadowCase(id, base, dpr));
    for (const [id, base] of GRADIENTS) out.push(gradientCase(id, base, dpr));
  }
  return out;
}

function caseHtml(c: OracleCase): string {
  const head = '<!doctype html><html><head><style>html,body{margin:0;background:#fff}div{position:absolute;box-sizing:content-box}</style></head><body>';
  if (c.family === 'shadow') {
    const s = c.css;
    const radius = s.radius > 0 ? `border-radius:${s.radius}px;` : '';
    return `${head}<div style="left:${s.left}px;top:${s.top}px;width:${s.width}px;height:${s.height}px;${radius}box-shadow:${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.spread}px #000"></div></body></html>`;
  }
  const g = c.css;
  const stops = g.stops.map((s) => `${hex(s.color)} ${s.offset * 100}%`).join(',');
  return `${head}<div style="left:${g.left}px;top:${g.top}px;width:${g.width}px;height:${g.height}px;background:linear-gradient(${g.axis === 'x' ? 'to right' : 'to bottom'},${stops})"></div></body></html>`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Capture.

async function softwareRaster(browser: Browser): Promise<Record<string, string>> {
  const cdp = await browser.newBrowserCDPSession();
  const info = (await cdp.send('SystemInfo.getInfo')) as { gpu: { featureStatus: Record<string, string> } };
  await cdp.detach();
  const fs = info.gpu.featureStatus;
  const want: Record<string, string> = { rasterization: 'disabled_software', gpu_compositing: 'disabled_software', skia_graphite: 'disabled_off' };
  for (const [k, v] of Object.entries(want)) if (fs[k] !== v) throw new Error(`precondition: SystemInfo featureStatus.${k} is ${fs[k]}, not ${v} (Chrome is not rastering on the CPU with Skia)`);
  return { rasterization: fs.rasterization as string, gpu_compositing: fs.gpu_compositing as string, skia_graphite: fs.skia_graphite as string };
}

/** The crop's pixels: one gray byte per pixel when every pixel has R = G = B, otherwise RGB. */
function cropPixels(img: Image, crop: IRect, channels: 1 | 3): Uint8Array {
  const w = crop.right - crop.left;
  const h = crop.bottom - crop.top;
  const out = new Uint8Array(w * h * channels);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((crop.top + y) * img.w + crop.left + x) * img.channels;
      const r = img.px[i] as number;
      const g = img.px[i + 1] as number;
      const b = img.px[i + 2] as number;
      if (channels === 1) {
        if (r !== g || g !== b) throw new Error(`gray crop has a colored pixel (${r},${g},${b})`);
        out[y * w + x] = r;
      } else {
        out.set([r, g, b], (y * w + x) * 3);
      }
    }
  }
  return out;
}

async function captureAll(cases: readonly OracleCase[]): Promise<{ readonly crops: Map<string, Uint8Array>; readonly featureStatus: Record<string, Record<string, string>> }> {
  const crops = new Map<string, Uint8Array>();
  const featureStatus: Record<string, Record<string, string>> = {};
  for (const dpr of DPRS) {
    const browser = await launchChrome(dpr);
    try {
      featureStatus[`dpr-${dpr}`] = await softwareRaster(browser);
      const guard = await zoomGuard(browser, dpr);
      let n = 0;
      for (const c of cases) {
        if (c.dpr !== dpr) continue;
        const viewport = c.family === 'shadow' ? SHADOW_VIEWPORT : GRADIENT_VIEWPORT;
        const page = await openPage(browser, caseHtml(c), { viewport, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ua-default' });
        try {
          const img = decodePng(await page.screenshot({ type: 'png' }));
          if (img.w !== Math.round(viewport.width * dpr) || img.h !== Math.round(viewport.height * dpr)) throw new Error(`${c.file}: screenshot ${img.w}x${img.h} is not the device viewport`);
          crops.set(c.file, cropPixels(img, c.crop, c.channels));
          n++;
        } finally {
          await page.context().close();
        }
      }
      await zoomGuard(browser, dpr);
      console.log(`DPR ${dpr}: software raster ${JSON.stringify(featureStatus[`dpr-${dpr}`])}; zoom guard ${guard}; ${n} crops`);
    } finally {
      await browser.close();
    }
  }
  return { crops, featureStatus };
}

// ---------------------------------------------------------------------------------------------------------------------
// Comparison with the TS references.

export type CaseResult = { readonly file: string; readonly pixels: number; readonly exact: number; readonly equal: number; readonly first: string | null };

export function compareCase(c: OracleCase, px: Uint8Array): CaseResult {
  const w = c.crop.right - c.crop.left;
  const h = c.crop.bottom - c.crop.top;
  let exact = 0;
  let equal = 0;
  let first: string | null = null;
  if (c.family === 'shadow') {
    const ref = boxShadowOverWhite(c.device, c.crop, NO_BLUR_FAULTS);
    for (let i = 0; i < w * h; i++) {
      if (!(ref.exact[i] as boolean)) continue;
      exact++;
      if (px[i] === ref.values[i]) equal++;
      else if (first === null) first = `(${c.crop.left + (i % w)},${c.crop.top + Math.floor(i / w)}) chrome ${px[i]} ref ${ref.values[i]} [${ref.path}]`;
    }
  } else {
    const shader = linearGradientShader(c.device, NO_DITHER_FAULTS);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        exact++;
        const p = gradientPixel(shader, c.crop.left + x, c.crop.top + y, WHITE, NO_DITHER_FAULTS);
        const i = (y * w + x) * 3;
        if (px[i] === p.r && px[i + 1] === p.g && px[i + 2] === p.b) equal++;
        else if (first === null) first = `(${c.crop.left + x},${c.crop.top + y}) chrome ${px[i]},${px[i + 1]},${px[i + 2]} ref ${p.r},${p.g},${p.b}`;
      }
    }
  }
  return { file: c.file, pixels: w * h, exact, equal, first };
}

function report(results: readonly CaseResult[]): number {
  let bad = 0;
  const fam = new Map<string, { exact: number; equal: number; pixels: number }>();
  for (const r of results) {
    const k = r.file.split('-')[0] as string;
    const f = fam.get(k) ?? { exact: 0, equal: 0, pixels: 0 };
    f.exact += r.exact;
    f.equal += r.equal;
    f.pixels += r.pixels;
    fam.set(k, f);
    if (r.equal !== r.exact) {
      bad++;
      console.log(`MISMATCH ${r.file}: ${r.exact - r.equal} of ${r.exact} exact pixels differ; first ${r.first}`);
    }
  }
  for (const [k, f] of fam) console.log(`${k}: ${f.equal}/${f.exact} exact pixels equal at channel delta 0 (${f.pixels} captured)`);
  return bad;
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const cases = oracleCases();
  const { crops, featureStatus } = await captureAll(cases);
  const results = cases.map((c) => compareCase(c, crops.get(c.file) as Uint8Array));
  const bad = report(results);
  if (!check) {
    mkdirSync(OUT_DIR, { recursive: true });
    for (const c of cases) writeFileSync(join(OUT_DIR, c.file), encodePng(c.crop.right - c.crop.left, c.crop.bottom - c.crop.top, c.channels, crops.get(c.file) as Uint8Array));
    const flags: Record<string, readonly string[]> = {};
    for (const dpr of DPRS) flags[`dpr-${dpr}`] = chromeArgsAt(dpr);
    const manifest: Manifest = { chrome: CHROME_VERSION, skia: SKIA_REVISION, flags, featureStatus, cases };
    writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`skia-oracle: wrote ${cases.length} crops and manifest.json to docs/research/skia-oracle`);
    return;
  }
  const stored = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf8')) as Manifest;
  let stale = 0;
  if (JSON.stringify(stored.cases) !== JSON.stringify(cases)) {
    stale++;
    console.log('STALE manifest.json: the case list differs from the script');
  }
  for (const c of cases) {
    const img = decodePng(readFileSync(join(OUT_DIR, c.file)));
    const fresh = crops.get(c.file) as Uint8Array;
    if (img.px.length !== fresh.length || img.px.some((v, i) => v !== fresh[i])) {
      stale++;
      console.log(`STALE ${c.file}: the fresh capture differs from the stored crop`);
    }
  }
  console.log(`skia-oracle --check: ${cases.length} crops, ${bad} with reference mismatches, ${stale} stale`);
  if (bad > 0 || stale > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('capture-skia-oracle.ts')) await main();
