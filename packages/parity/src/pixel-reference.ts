// The Chrome pixel reference and the points protocol (notes/T015-p4-review-p5-plan.md section 4 item 5): PNG reading and the raster
// size rule, the committed Chrome screenshots and their manifest, the sample points of a case at a DPR generated from the snapped
// engine geometry and the program's paint facts (samples.ts, the glyph rule from engine advances and the font's glyph boxes), the
// run file the device reads, and check (c) of a dump against the committed PNG.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import type { LayoutBox, LayoutRect } from '@dragon/layout';
import { AHEM_FONT_DATA, coveredIndex, platformFontSize, snapEdges, zoomFontSize } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { borderDevicePx, programInput } from 'dragon';
import { chromeArgsAt, CHROME_VERSION } from './chrome.ts';
import { dprLabel } from './dpr.ts';
import { engineTextLines } from './line-breaks.ts';
import type { CheckResult, RgbaImage } from './native-compare.ts';
import { checkPixels } from './native-compare.ts';
import type { DumpSample } from './native-dump.ts';
import { expectedEngine, referenceMeasurer } from './native-host.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import type { GlyphBox, GlyphLine, ImageSize, SampleBox, SamplePoint, SampleResult } from './samples.ts';
import { SAMPLE_INSET_DEVICE_PX, sampleBoxes, sampleGlyphs } from './samples.ts';

// ---------------------------------------------------------------- PNG

/** Decodes a non-interlaced 8-bit greyscale, RGB or RGBA PNG (Chrome, simctl io and screencap write these) into RGBA8. */
export function decodePng(buf: Uint8Array): RgbaImage {
  const b = Buffer.from(buf);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (at < b.length) {
    const len = b.readUInt32BE(at);
    const type = b.toString('ascii', at + 4, at + 8);
    const data = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8] as number;
      colour = data[9] as number;
      interlace = data[12] as number;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const channels = colour === 0 ? 1 : colour === 2 ? 3 : colour === 4 ? 2 : colour === 6 ? 4 : 0;
  if (depth !== 8 || channels === 0 || interlace !== 0) throw new Error(`unsupported PNG: bit depth ${depth}, colour type ${colour}, interlace ${interlace}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)] as number;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] as number;
      const a = x >= channels ? (px[y * stride + x - channels] as number) : 0;
      const up = y > 0 ? (px[(y - 1) * stride + x] as number) : 0;
      const ul = y > 0 && x >= channels ? (px[(y - 1) * stride + x - channels] as number) : 0;
      let p: number;
      if (f === 0) p = v;
      else if (f === 1) p = v + a;
      else if (f === 2) p = v + up;
      else if (f === 3) p = v + ((a + up) >> 1);
      else if (f === 4) {
        const q = a + up - ul;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - up);
        const pc = Math.abs(q - ul);
        p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul);
      } else throw new Error(`bad PNG filter ${f}`);
      px[y * stride + x] = p & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    const g = px[s] as number;
    data[i * 4] = g;
    data[i * 4 + 1] = channels >= 3 ? (px[s + 1] as number) : g;
    data[i * 4 + 2] = channels >= 3 ? (px[s + 2] as number) : g;
    data[i * 4 + 3] = channels === 4 ? (px[s + 3] as number) : channels === 2 ? (px[s + 1] as number) : 255;
  }
  return { width, height, data };
}

/**
 * The raster size of a case (O4): ceil(viewport css px x DPR) in each dimension. A 400x300 viewport at 2.625 is 1050x787.5 device
 * px; Chrome's screenshot of it is 1050x788 and the Android root's snapped frame is 1050x788. Chrome, iOS and Android captures
 * must all be this size.
 */
export function rasterSize(viewport: { readonly width: number; readonly height: number }, dpr: number): ImageSize {
  return { width: Math.ceil(viewport.width * dpr), height: Math.ceil(viewport.height * dpr) };
}
export const RASTER_RULE = 'ceil(viewport css px x DPR) in each dimension; 400x300 at 2.625 is 1050x788';

// ---------------------------------------------------------------- committed Chrome pixels

export const expectedPixelsDir = (dpr: number, platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-pixels/${platform}/${dprLabel(dpr)}`);
export const expectedPixelsPath = (caseId: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${expectedPixelsDir(dpr, platform)}/${caseId}.png`;
export const PIXEL_MANIFEST = (platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-pixels/${platform}/manifest.json`);

export type PixelManifest = {
  readonly chrome: string;
  readonly capture: string;
  readonly rasterRule: string;
  readonly sets: readonly { readonly dpr: number; readonly flags: readonly string[]; readonly cases: readonly { readonly case: string; readonly width: number; readonly height: number; readonly sha256: string }[] }[];
};

export const PIXEL_CAPTURE = 'CDP Page.captureScreenshot {format: png}, the viewport at the forced device scale factor';

export function pixelManifest(sets: readonly { dpr: number; cases: { case: string; png: Uint8Array }[] }[]): PixelManifest {
  return {
    chrome: CHROME_VERSION,
    capture: PIXEL_CAPTURE,
    rasterRule: RASTER_RULE,
    sets: sets.map((s) => ({
      dpr: s.dpr,
      flags: chromeArgsAt(s.dpr),
      cases: s.cases.map((c) => {
        const img = decodePng(c.png);
        return { case: c.case, width: img.width, height: img.height, sha256: createHash('sha256').update(c.png).digest('hex') };
      }),
    })),
  };
}

export function manifestText(m: PixelManifest): string {
  const sets = m.sets.map((s) => `    {\n      "dpr": ${JSON.stringify(s.dpr)},\n      "flags": ${JSON.stringify(s.flags)},\n      "cases": [\n${s.cases.map((c) => `        ${JSON.stringify(c)}`).join(',\n')}\n      ]\n    }`).join(',\n');
  return `{\n  "chrome": ${JSON.stringify(m.chrome)},\n  "capture": ${JSON.stringify(m.capture)},\n  "rasterRule": ${JSON.stringify(m.rasterRule)},\n  "sets": [\n${sets}\n  ]\n}\n`;
}

const pngCache = new Map<string, RgbaImage>();
/** A committed Chrome PNG, decoded; null when it is absent. */
export function committedPixels(caseId: string, dpr: number): RgbaImage | null {
  const p = expectedPixelsPath(caseId, dpr);
  const hit = pngCache.get(p);
  if (hit !== undefined) return hit;
  if (!existsSync(p)) return null;
  const img = decodePng(readFileSync(p));
  pngCache.set(p, img);
  return img;
}

// ---------------------------------------------------------------- the font's glyph boxes

/** A glyph's ink box in font units (glyf xMin, yMin, xMax, yMax), or null for a glyph without contours. */
export type FontBox = { readonly xMin: number; readonly yMin: number; readonly xMax: number; readonly yMax: number };

let ahemBoxes: Map<number, FontBox | null> | null = null;

/** Ahem's glyph boxes by code point, read from vendor/fonts/Ahem.ttf (cmap format 4, loca, glyf); covered code points only. */
export function ahemGlyphBoxes(): ReadonlyMap<number, FontBox | null> {
  if (ahemBoxes !== null) return ahemBoxes;
  const f = readFileSync(repoPath('vendor/fonts/Ahem.ttf'));
  const tables = new Map<string, number>();
  const n = f.readUInt16BE(4);
  for (let i = 0; i < n; i++) tables.set(f.toString('ascii', 12 + 16 * i, 16 + 16 * i), f.readUInt32BE(20 + 16 * i));
  const at = (tag: string): number => {
    const o = tables.get(tag);
    if (o === undefined) throw new Error(`Ahem.ttf has no ${tag} table`);
    return o;
  };
  const head = at('head');
  const longLoca = f.readInt16BE(head + 50) === 1;
  const loca = at('loca');
  const glyf = at('glyf');
  const cmap = at('cmap');
  let f4 = -1;
  for (let i = 0; i < f.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + f.readUInt32BE(cmap + 4 + 8 * i + 4);
    if (f.readUInt16BE(sub) === 4) f4 = sub;
  }
  if (f4 < 0) throw new Error('Ahem.ttf has no cmap format 4');
  const segX2 = f.readUInt16BE(f4 + 6);
  const glyphOf = (cp: number): number => {
    for (let k = 0; k < segX2 / 2; k++) {
      const end = f.readUInt16BE(f4 + 14 + 2 * k);
      const start = f.readUInt16BE(f4 + 16 + segX2 + 2 * k);
      if (cp < start || cp > end) continue;
      const delta = f.readInt16BE(f4 + 16 + 2 * segX2 + 2 * k);
      const rangeAt = f4 + 16 + 3 * segX2 + 2 * k;
      const range = f.readUInt16BE(rangeAt);
      if (range === 0) return (cp + delta) & 0xffff;
      const g = f.readUInt16BE(rangeAt + range + 2 * (cp - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  const offset = (g: number): number => (longLoca ? f.readUInt32BE(loca + 4 * g) : 2 * f.readUInt16BE(loca + 2 * g));
  const out = new Map<number, FontBox | null>();
  for (let cp = 0; cp <= 0x200b; cp++) {
    if (coveredIndex(cp) < 0) continue;
    const g = glyphOf(cp);
    const o = offset(g);
    const len = offset(g + 1) - o;
    if (len === 0 || f.readInt16BE(glyf + o) === 0) {
      out.set(cp, null);
      continue;
    }
    const b = glyf + o;
    out.set(cp, { xMin: f.readInt16BE(b + 2), yMin: f.readInt16BE(b + 4), xMax: f.readInt16BE(b + 6), yMax: f.readInt16BE(b + 8) });
  }
  ahemBoxes = out;
  return out;
}

// ---------------------------------------------------------------- the points of a case

const isLine = (r: LayoutRect): boolean => r.parent !== null && r.id.startsWith(`${r.parent}:line`);

function cssFontSizes(root: LayoutBox): Map<string, { family: string; size: number }> {
  const out = new Map<string, { family: string; size: number }>();
  const walk = (b: LayoutBox): void => {
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else out.set(c.id, { family: c.font.family, size: c.font.size });
    }
  };
  walk(root);
  return out;
}

/**
 * The glyph lines of a program at a DPR, as the device places them: the pen starts at the line's absolute x and advances by
 * float32(size x advance / unitsPerEm) with size = platformFontSize(zoomFontSize(css size, DPR)); the baseline is the snapped line
 * top plus the engine's ascent. Each glyph's box is its font box scaled by size / unitsPerEm. Only Ahem is accepted.
 */
export function glyphLines(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): GlyphLine[] {
  const input = programInput(p, viewport, dpr);
  const m = referenceMeasurer();
  const texts = engineTextLines(input, m);
  const sizes = cssFontSizes(input.root);
  const boxes = ahemGlyphBoxes();
  const upem = AHEM_FONT_DATA.unitsPerEm;
  const out: GlyphLine[] = [];
  for (const t of texts) {
    const css = sizes.get(t.id);
    if (css === undefined) throw new Error(`no text leaf ${t.id}`);
    if (css.family !== 'Ahem') throw new Error(`${t.id}: the glyph rule refuses the font family ${css.family}; glyph boxes are known for Ahem only`);
    const size = platformFontSize(zoomFontSize(css.size, dpr));
    const metrics = m.metrics(t.font);
    for (const [j, line] of t.lines.entries()) {
      const baseline = line.snapped.top + metrics.ascent / 64;
      let pen = 0;
      const glyphs: GlyphBox[] = [];
      for (const cp of line.cps) {
        const k = coveredIndex(cp);
        const adv = k < 0 ? undefined : AHEM_FONT_DATA.advances[k];
        if (adv === undefined) throw new Error(`${t.id}: U+${cp.toString(16)} is not covered by Ahem`);
        const b = boxes.get(cp);
        const x = line.rect.x / 64 + pen;
        if (b !== null && b !== undefined) glyphs.push({ left: x + (b.xMin * size) / upem, right: x + (b.xMax * size) / upem, top: baseline - (b.yMax * size) / upem, bottom: baseline - (b.yMin * size) / upem });
        pen = Math.fround(pen + Math.fround((size * adv) / upem));
      }
      out.push({ id: `${t.id}:line${j}`, glyphs });
    }
  }
  return out;
}

/**
 * The sample points of a program at a DPR: generateSamples over every element and anonymous box (snapped edges, the engine's
 * border widths in device px, no radius, the program's clip), then the glyph rule over every text line. Every point stays
 * SAMPLE_INSET_DEVICE_PX clear of every glyph box edge (T093 ruling A); the glyph boxes come from engine data only.
 */
export function casePoints(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): SamplePoint[] {
  return caseSamples(p, viewport, dpr).points;
}

/**
 * casePoints with the rules whose point no along-position could keep clear of the glyph boxes. clearance false gives the P5 points,
 * before the glyph clearance and the vertical glyph-edge scanlines, to read failure lists of runs from before them.
 */
export function caseSamples(p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, clearance = true): SampleResult {
  const input = programInput(p, viewport, dpr);
  const engine = expectedEngine();
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${dpr}`);
  const snapped = snapEdges(out.boxes);
  const borders = borderDevicePx(engine, input);
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const boxes: SampleBox[] = [];
  out.boxes.forEach((r, i) => {
    if (isLine(r)) return;
    const n = nodes.get(r.id);
    if (n === undefined || n.kind === 'text') return;
    const s = snapped[i] as { left: number; top: number; right: number; bottom: number };
    const b = borders.get(r.id) ?? [0, 0, 0, 0];
    boxes.push({ id: r.id, left: s.left, top: s.top, right: s.right, bottom: s.bottom, border: { top: b[0], right: b[1], bottom: b[2], left: b[3] }, radius: 0, clips: n.clips });
  });
  const size = rasterSize(viewport, dpr);
  const lines = glyphLines(p, viewport, dpr);
  const box = sampleBoxes(boxes, size, clearance ? lines.flatMap((l) => l.glyphs) : []);
  const glyph = sampleGlyphs(lines, size, SAMPLE_INSET_DEVICE_PX, clearance);
  return { points: [...box.points, ...glyph.points], dropped: [...box.dropped, ...glyph.dropped] };
}

/** The run file the device app reads (native-support.ts dragonReadRun): the cases in order, their points, and the hold flag. */
export function runFileText(cases: readonly { readonly id: string; readonly points: readonly SamplePoint[] }[], hold: boolean): string {
  const lines: string[] = [];
  for (const c of cases) {
    if (/[\t\n]/.test(c.id)) throw new Error(`case id ${JSON.stringify(c.id)} holds a tab or newline`);
    lines.push(`case\t${c.id}`);
    for (const p of c.points) lines.push(`point\t${c.id}\t${p.x}\t${p.y}\t${p.rule}`);
  }
  if (hold) lines.push('hold\t1');
  return `${lines.join('\n')}\n`;
}

/** Check (c) of a dump's samples against the committed Chrome PNG at the dump's DPR, with the size rule checked first. */
export function checkCasePixels(samples: readonly DumpSample[], points: readonly SamplePoint[], chrome: RgbaImage, want: ImageSize, native: ImageSize): CheckResult {
  const problems: string[] = [];
  if (chrome.width !== want.width || chrome.height !== want.height) problems.push(`the Chrome PNG is ${chrome.width}x${chrome.height}, the raster rule ${want.width}x${want.height}`);
  if (native.width !== want.width || native.height !== want.height) problems.push(`the native capture is ${native.width}x${native.height}, the raster rule ${want.width}x${want.height}`);
  if (problems.length > 0) return { pass: false, compared: 0, problems };
  return checkPixels(samples, points, chrome);
}
