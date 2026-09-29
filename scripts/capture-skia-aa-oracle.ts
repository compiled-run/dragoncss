// node --conditions=dragon-internal scripts/capture-skia-aa-oracle.ts [--check]
// Captures Chrome 145's CPU-rastered rounded-rect fills and border-radius borders (T086 SKIA-AA) at DPR 2, 3 and 2.625
// into docs/research/skia-aa-oracle (PNG crops plus manifest.json). Each launch first proves the software raster path
// (SystemInfo featureStatus) and the zoom guard. Without --check it writes the crops and prints how many pixels the TS
// reference (packages/layout/src/paint-aa.ts) matches. With --check it captures afresh, requires every crop to equal the
// stored one pixel for pixel and every pixel to equal the reference, prints the derived counts, and exits 1 on any
// difference. Every box sits inside cc raster tile 0 (512 px tiles on macOS at DSF >= 2), so tile clips never apply.
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROME_VERSION, chromeArgsAt, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { zoomGuard } from '../packages/parity/src/dpr.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import type { AaFaults, BorderWidths, CornerRadii, IRect, RoundedBoxSpec } from '../packages/layout/src/paint-aa.ts';
import { borderRoundedRect, devicePixels, NO_AA_FAULTS, paintRoundedBackground, paintRoundedBorder, toSkRRect, whiteDevice } from '../packages/layout/src/paint-aa.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;

const OUT_DIR = repoPath('docs/research/skia-aa-oracle');
const SKIA_REVISION = '2ab8add5be2c46eb6238f4c217f6d6dbc9bccd23';
const DPRS = [2, 3, 2.625] as const;
const VIEWPORT = { width: 200, height: 200 };
/** cc tile size on macOS at DSF >= 2 (layer_tree_settings.cc; T109): every crop stays below device px 500, inside tile 0. */
const TILE_SIZE = 512;
const TILE_LIMIT = 500;

// ---------------------------------------------------------------------------------------------------------------------
// PNG (8-bit, non-interlaced; gray, RGB or RGBA in, gray out).

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
export function encodeGrayPng(w: number, h: number, px: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.subarray(y * w, (y + 1) * w)).copy(raw, y * (w + 1) + 1);
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

/** A corner radius in CSS px: [horizontal, vertical]. */
export type CssRadius = readonly [number, number];
export type BoxCss = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** top-left, top-right, bottom-right, bottom-left */
  readonly radii: readonly [CssRadius, CssRadius, CssRadius, CssRadius];
  /** Border widths in CSS px (top, right, bottom, left), or null for a black background fill. */
  readonly border: readonly [number, number, number, number] | null;
};
export type OracleCase = {
  readonly id: string;
  readonly family: 'fill' | 'border';
  readonly dpr: number;
  readonly css: BoxCss;
  readonly device: RoundedBoxSpec;
  readonly widths: BorderWidths | null;
  readonly crop: IRect;
  readonly file: string;
};
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

/** Border widths snap to whole device px: floor(width * dpr), at least 1 (T069 §0). */
function borderWidth(cssPx: number, dpr: number): number {
  return Math.max(1, Math.floor(cssPx * dpr));
}

const r = (h: number, v: number = h): CssRadius => [h, v];
const all = (x: CssRadius): readonly [CssRadius, CssRadius, CssRadius, CssRadius] => [x, x, x, x];

type CaseDef = Omit<BoxCss, 'left' | 'top'> & { readonly left?: number; readonly top?: number };
const FILLS: readonly (readonly [string, CaseDef])[] = [
  ['uniform-8', { width: 64, height: 48, radii: all(r(8)), border: null }],
  ['uniform-3.5', { width: 40, height: 30, radii: all(r(3.5)), border: null }],
  ['uniform-24', { width: 120, height: 90, radii: all(r(24)), border: null }],
  ['per-corner', { width: 72, height: 56, radii: [r(10), r(4), r(16), r(0)], border: null }],
  ['elliptical', { width: 80, height: 50, radii: all(r(20, 8)), border: null }],
  ['elliptical-mixed', { width: 90, height: 64, radii: [r(24, 10), r(6, 14), r(12.5, 3), r(9, 9)], border: null }],
  ['over-half', { width: 60, height: 40, radii: all(r(30)), border: null }],
  ['huge', { width: 100, height: 60, radii: [r(999), r(999), r(20), r(40)], border: null }],
  ['circle', { width: 40, height: 40, radii: all(r(20)), border: null }],
  ['pill', { width: 80, height: 24, radii: all(r(12)), border: null }],
  ['ellipse', { width: 70, height: 30, radii: all(r(35, 15)), border: null }],
  ['zero', { width: 40, height: 24, radii: all(r(0)), border: null }],
  ['frac-pos', { left: 10.125, top: 7.875, width: 45.25, height: 33.5, radii: [r(9.5), r(5.25), r(11), r(7.75)], border: null }],
  ['small-mask', { width: 12, height: 12, radii: all(r(4)), border: null }],
  ['small-mask-10', { width: 10, height: 10, radii: [r(3), r(5), r(2), r(4)], border: null }],
  ['tiny-circle', { width: 6, height: 6, radii: all(r(3)), border: null }],
  ['thin-strip', { width: 90, height: 5, radii: all(r(2.5)), border: null }],
];
const BORDERS: readonly (readonly [string, CaseDef])[] = [
  ['nonuniform', { width: 64, height: 48, radii: all(r(12)), border: [2, 4, 6, 8] }],
  ['elliptical', { width: 80, height: 56, radii: all(r(16, 8)), border: [3, 3, 3, 3] }],
  ['radius-under-width', { width: 60, height: 44, radii: all(r(4)), border: [6, 6, 6, 6] }],
  ['per-corner-nonuniform', { width: 72, height: 60, radii: [r(18), r(0), r(10), r(24, 12)], border: [1, 2, 3, 2] }],
  ['thick-over-half', { width: 60, height: 40, radii: all(r(30)), border: [10, 6, 10, 6] }],
  ['frac-pos', { left: 12.375, top: 9.625, width: 50.25, height: 41.5, radii: [r(13.5), r(8.25), r(6), r(10.75)], border: [2, 1, 3, 1] }],
  // Small enough for MaskAdditiveBlitter at DPR 2 and 2.625 (aaa_walk_edges into the mask).
  ['small-mask', { width: 12, height: 12, radii: all(r(5)), border: [1, 2, 1, 2] }],
];

function boxCase(id: string, family: 'fill' | 'border', def: CaseDef, dpr: number): OracleCase {
  const css: BoxCss = { left: def.left ?? 17, top: def.top ?? 17, width: def.width, height: def.height, radii: def.radii, border: def.border };
  const box: IRect = { left: snapEdge(css.left, dpr), top: snapEdge(css.top, dpr), right: snapEdge(css.left + css.width, dpr), bottom: snapEdge(css.top + css.height, dpr) };
  const rad = (x: CssRadius) => ({ x: zoomed(x[0], dpr), y: zoomed(x[1], dpr) });
  const radii: CornerRadii = { topLeft: rad(css.radii[0]), topRight: rad(css.radii[1]), bottomRight: rad(css.radii[2]), bottomLeft: rad(css.radii[3]) };
  const widths: BorderWidths | null = css.border === null ? null : { top: borderWidth(css.border[0], dpr), right: borderWidth(css.border[1], dpr), bottom: borderWidth(css.border[2], dpr), left: borderWidth(css.border[3], dpr) };
  const crop: IRect = { left: box.left - 2, top: box.top - 2, right: box.right + 2, bottom: box.bottom + 2 };
  if (crop.right > TILE_LIMIT || crop.bottom > TILE_LIMIT) throw new Error(`${id}: crop leaves cc tile 0`);
  return { id, family, dpr, css, device: { box, radii, tileSize: TILE_SIZE }, widths, crop, file: `${family}-${id}-dpr${dpr}.png` };
}

export function oracleCases(): OracleCase[] {
  const out: OracleCase[] = [];
  for (const dpr of DPRS) {
    for (const [id, def] of FILLS) out.push(boxCase(id, 'fill', def, dpr));
    for (const [id, def] of BORDERS) out.push(boxCase(id, 'border', def, dpr));
  }
  return out;
}

function caseHtml(c: OracleCase): string {
  const s = c.css;
  const radius = `border-radius:${s.radii.map((x) => `${x[0]}px`).join(' ')} / ${s.radii.map((x) => `${x[1]}px`).join(' ')};`;
  const paint = s.border === null ? 'background:#000;' : `border-style:solid;border-color:#000;border-width:${s.border.map((w) => `${w}px`).join(' ')};`;
  return `<!doctype html><html><head><style>html,body{margin:0;background:#fff}div{position:absolute;box-sizing:border-box}</style></head><body><div style="left:${s.left}px;top:${s.top}px;width:${s.width}px;height:${s.height}px;${radius}${paint}"></div></body></html>`;
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

function cropGray(img: Image, crop: IRect): Uint8Array {
  const w = crop.right - crop.left;
  const h = crop.bottom - crop.top;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((crop.top + y) * img.w + crop.left + x) * img.channels;
      const rr = img.px[i] as number;
      const g = img.px[i + 1] as number;
      const b = img.px[i + 2] as number;
      if (rr !== g || g !== b) throw new Error(`gray crop has a colored pixel (${rr},${g},${b})`);
      out[y * w + x] = rr;
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
        const page = await openPage(browser, caseHtml(c), { viewport: VIEWPORT, devicePixelRatio: dpr, direction: 'ltr', rootFont: 'ua-default' });
        try {
          const img = decodePng(await page.screenshot({ type: 'png' }));
          if (img.w !== Math.round(VIEWPORT.width * dpr) || img.h !== Math.round(VIEWPORT.height * dpr)) throw new Error(`${c.file}: screenshot ${img.w}x${img.h} is not the device viewport`);
          crops.set(c.file, cropGray(img, c.crop));
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
// Comparison with the TS reference.

/** The reference crop for a case under the given faults. */
export function referenceCrop(c: OracleCase, faults: AaFaults): number[] {
  const dev = whiteDevice(c.crop);
  if (c.widths === null) paintRoundedBackground(dev, c.device, faults);
  else paintRoundedBorder(dev, c.device, c.widths, faults);
  return devicePixels(dev);
}

/** Pixels within one device px of a rounded corner's radius box (the constrained SkRRect's radii). */
export function arcPixels(c: OracleCase): boolean[] {
  const rr = toSkRRect(borderRoundedRect(c.device, NO_AA_FAULTS), NO_AA_FAULTS);
  const b = c.device.box;
  const w = c.crop.right - c.crop.left;
  const h = c.crop.bottom - c.crop.top;
  const out: boolean[] = [];
  const corners = [
    { x0: b.left, y0: b.top, sx: 1, sy: 1 },
    { x0: b.right, y0: b.top, sx: -1, sy: 1 },
    { x0: b.right, y0: b.bottom, sx: -1, sy: -1 },
    { x0: b.left, y0: b.bottom, sx: 1, sy: -1 },
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = c.crop.left + x + 0.5;
      const py = c.crop.top + y + 0.5;
      let arc = false;
      corners.forEach((k, i) => {
        const rad = rr.radii[i] as { x: number; y: number };
        if (rad.x === 0 || rad.y === 0) return;
        const dx = (px - k.x0) * k.sx;
        const dy = (py - k.y0) * k.sy;
        if (dx > -1 && dy > -1 && dx < rad.x + 1 && dy < rad.y + 1) arc = true;
      });
      out.push(arc);
    }
  }
  return out;
}

export type CaseResult = { readonly file: string; readonly family: string; readonly dpr: number; readonly pixels: number; readonly equal: number; readonly arc: number; readonly arcEqual: number; readonly first: string | null };

export function compareCase(c: OracleCase, px: Uint8Array, faults: AaFaults = NO_AA_FAULTS): CaseResult {
  const w = c.crop.right - c.crop.left;
  let ref: number[];
  try {
    ref = referenceCrop(c, faults);
  } catch (e) {
    return { file: c.file, family: c.family, dpr: c.dpr, pixels: px.length, equal: 0, arc: 0, arcEqual: 0, first: `reference threw: ${(e as Error).message}` };
  }
  const arcs = arcPixels(c);
  let equal = 0;
  let arc = 0;
  let arcEqual = 0;
  let first: string | null = null;
  for (let i = 0; i < px.length; i++) {
    const same = px[i] === ref[i];
    if (same) equal++;
    if (arcs[i] === true) {
      arc++;
      if (same) arcEqual++;
    }
    if (!same && first === null) first = `(${c.crop.left + (i % w)},${c.crop.top + Math.floor(i / w)}) chrome ${px[i]} ref ${ref[i]}`;
  }
  return { file: c.file, family: c.family, dpr: c.dpr, pixels: px.length, equal, arc, arcEqual, first };
}

function report(results: readonly CaseResult[]): number {
  let bad = 0;
  const fam = new Map<string, { pixels: number; equal: number; arc: number; arcEqual: number }>();
  for (const r of results) {
    const k = `${r.family} dpr ${r.dpr}`;
    const f = fam.get(k) ?? { pixels: 0, equal: 0, arc: 0, arcEqual: 0 };
    f.pixels += r.pixels;
    f.equal += r.equal;
    f.arc += r.arc;
    f.arcEqual += r.arcEqual;
    fam.set(k, f);
    if (r.equal !== r.pixels) {
      bad++;
      console.log(`MISMATCH ${r.file}: ${r.pixels - r.equal} of ${r.pixels} pixels differ; first ${r.first}`);
    }
  }
  for (const [k, f] of fam) console.log(`${k}: ${f.equal}/${f.pixels} pixels equal at channel delta 0; arc pixels ${f.arcEqual}/${f.arc}`);
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
    for (const c of cases) writeFileSync(join(OUT_DIR, c.file), encodeGrayPng(c.crop.right - c.crop.left, c.crop.bottom - c.crop.top, crops.get(c.file) as Uint8Array));
    const flags: Record<string, readonly string[]> = {};
    for (const dpr of DPRS) flags[`dpr-${dpr}`] = chromeArgsAt(dpr);
    const manifest: Manifest = { chrome: CHROME_VERSION, skia: SKIA_REVISION, flags, featureStatus, cases };
    writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
    console.log(`skia-aa-oracle: wrote ${cases.length} crops and manifest.json to docs/research/skia-aa-oracle`);
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
  console.log(`skia-aa-oracle --check: ${cases.length} crops, ${bad} with reference mismatches, ${stale} stale`);
  if (bad > 0 || stale > 0) process.exitCode = 1;
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('capture-skia-aa-oracle.ts')) await main();
