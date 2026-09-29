// REPL-0 (docs/goals/milestone-2-proof/notes/T045-repl-form-spec.md §3 P1): builds the image corpus and captures Chrome 145's
// view of it. PNGs of every colour type and bit depth (interlaced and not, tRNS, colour chunks, APNG) are encoded here; the
// JPEGs and the WebP are encoded by Chrome's canvas.toBlob (which must be byte-stable), and the JPEGs get EXIF orientations
// 1-8 and resolutions inserted here. For every corpus image Chrome reports naturalWidth/naturalHeight; for the PNGs and the
// base JPEG it reports the full getImageData. The quadrant probe (R7) reads the object-fit destination rect off DPR 2, 3 and
// 2.625 screenshots of an 8x8-cell image for every fit x position x natural ratio.
// Writes packages/dragon/test/images/corpus/ and packages/dragon/test/images/chrome-145/.
// Run with: node --conditions=dragon-internal scripts/capture-image-data.ts [--check [--plant ihdr-swap|exif-ignored|density-ignored]]
// --check captures again into a temporary directory, requires every committed file to be byte-identical, and requires the
// header natural size of every corpus image to equal Chrome's (a plant must break that).
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, chromeArgsAt, launchChrome, openPage } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { hostPlatform } from '../packages/parity/src/platform.ts';
import { compareNaturalSizes, crc32, decodePng, faultsOfPlant, IMAGE_PLANTS, NO_IMAGE_FAULTS, typeOfPath } from '../packages/dragon/src/images/index.ts';
import type { ImagePlant, NaturalCapture } from '../packages/dragon/src/images/index.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<typeof openPage>>;

const CORPUS_DIR = 'packages/dragon/test/images/corpus';
const CAPTURE_DIR = 'packages/dragon/test/images/chrome-145';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;

const args = process.argv.slice(2);
const check = args.includes('--check');
const plantAt = args.indexOf('--plant');
const plantArg = plantAt >= 0 ? args[plantAt + 1] : undefined;
if (plantAt >= 0 && (plantArg === undefined || !(plantArg in IMAGE_PLANTS))) throw new Error(`--plant expects one of ${Object.keys(IMAGE_PLANTS).join(', ')}`);
if (plantArg !== undefined && !check) throw new Error('--plant runs only with --check; a planted capture is never written');
const plant = plantArg as ImagePlant | undefined;

const header = (dprs: readonly number[]) => ({
  chrome: CHROME_VERSION,
  playwright: PLAYWRIGHT_VERSION,
  platform: hostPlatform(),
  launches: dprs.map((dpr) => ({ dpr, flags: chromeArgsAt(dpr) })),
});
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------------------------------------------------ PNG encoder
const chunk = (type: string, data: Uint8Array): Buffer => {
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0);
  b.write(type, 4, 'latin1');
  Buffer.from(data).copy(b, 8);
  b.writeUInt32BE(crc32(b, 4, 8 + data.length), 8 + data.length);
  return b;
};
const u32be = (...v: number[]): Buffer => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => b.writeUInt32BE(x, i * 4));
  return b;
};
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;

type PngSpec = {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly type: 0 | 2 | 3 | 4 | 6;
  readonly interlace?: boolean;
  /** Samples of pixel (x, y) at the bit depth: 1, 3, 1 (palette index), 2 or 4 values. */
  readonly sample: (x: number, y: number) => number[];
  readonly palette?: readonly (readonly [number, number, number])[];
  readonly trns?: readonly number[];
  /** Chunks placed before IDAT (after PLTE/tRNS order is handled by the caller's order). */
  readonly before?: readonly Buffer[];
  readonly beforePalette?: readonly Buffer[];
};

/** Filters row y with filter y mod 5, so every filter type is exercised. */
function filterRow(row: Buffer, prev: Buffer | null, bpp: number, filter: number): Buffer {
  const out = Buffer.alloc(row.length + 1);
  out[0] = filter;
  for (let i = 0; i < row.length; i++) {
    const x = row[i] as number;
    const a = i >= bpp ? (row[i - bpp] as number) : 0;
    const b = prev !== null ? (prev[i] as number) : 0;
    const c = prev !== null && i >= bpp ? (prev[i - bpp] as number) : 0;
    let p = 0;
    if (filter === 1) p = a;
    else if (filter === 2) p = b;
    else if (filter === 3) p = (a + b) >> 1;
    else if (filter === 4) {
      const q = a + b - c;
      const pa = Math.abs(q - a);
      const pb = Math.abs(q - b);
      const pc = Math.abs(q - c);
      p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    out[i + 1] = (x - p) & 0xff;
  }
  return out;
}

function encodePng(s: PngSpec): Buffer {
  const ch = CHANNELS[s.type] as number;
  const bits = ch * s.depth;
  const bpp = Math.max(1, bits >> 3);
  const parts: Buffer[] = [];
  const passes = s.interlace === true ? ADAM7 : ([[0, 0, 1, 1]] as const);
  for (const [x0, y0, dx, dy] of passes) {
    const pw = s.width > x0 ? Math.ceil((s.width - x0) / dx) : 0;
    const ph = s.height > y0 ? Math.ceil((s.height - y0) / dy) : 0;
    if (pw === 0 || ph === 0) continue;
    let prev: Buffer | null = null;
    for (let py = 0; py < ph; py++) {
      const row = Buffer.alloc(Math.ceil((pw * bits) / 8));
      for (let px = 0; px < pw; px++) {
        const v = s.sample(x0 + px * dx, y0 + py * dy);
        for (let k = 0; k < ch; k++) {
          const val = v[k] as number;
          if (s.depth === 16) row.writeUInt16BE(val, (px * ch + k) * 2);
          else if (s.depth === 8) row[px * ch + k] = val;
          else {
            const bit = (px * ch + k) * s.depth;
            row[bit >> 3] = (row[bit >> 3] as number) | (val << (8 - s.depth - (bit & 7)));
          }
        }
      }
      parts.push(filterRow(row, prev, bpp, py % 5));
      prev = row;
    }
  }
  const ihdr = Buffer.concat([u32be(s.width, s.height), Buffer.from([s.depth, s.type, 0, 0, s.interlace === true ? 1 : 0])]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(s.beforePalette ?? []),
    ...(s.palette !== undefined ? [chunk('PLTE', Buffer.from(s.palette.flat()))] : []),
    ...(s.trns !== undefined ? [chunk('tRNS', Buffer.from(s.trns))] : []),
    ...(s.before ?? []),
    chunk('IDAT', deflateSync(Buffer.concat(parts), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const W = 13;
const H = 7;
const max = (d: number): number => (1 << d) - 1;
const grey = (d: number) => (x: number, y: number): number[] => [(x * 5 + y * 3) % (max(d) + 1)];
const rgb = (d: number) => (x: number, y: number): number[] => [(x * 37 + y * 11) % (max(d) + 1), (x * 13 + y * 59 + 7) % (max(d) + 1), (x * 101 + y * 3 + 91) % (max(d) + 1)];
const ga = (d: number) => (x: number, y: number): number[] => [(x * 19 + y * 7) % (max(d) + 1), (x * 23 + y * 41 + 3) % (max(d) + 1)];
const rgba = (d: number) => (x: number, y: number): number[] => [...rgb(d)(x, y), (x * 29 + y * 53 + 1) % (max(d) + 1)];
const PALETTE = Array.from({ length: 256 }, (_, i) => [(i * 67) & 255, (i * 151 + 13) & 255, (i * 29 + 200) & 255] as const);
const pal = (d: number) => (x: number, y: number): number[] => [(x * 3 + y * 5) % (1 << d)];
const palette = (d: number) => PALETTE.slice(0, 1 << d);
const sixteen = (v: number): number => v * 257;

/** The ICC profile Chrome embeds in its toBlob JPEGs, reused as the iCCP payload. */
function iccOf(jpeg: Buffer): Buffer {
  const at = jpeg.indexOf(Buffer.from('ICC_PROFILE\0', 'latin1'));
  if (at < 0) throw new Error('Chrome JPEG has no ICC profile');
  const len = jpeg.readUInt16BE(at - 2);
  return jpeg.subarray(at + 14, at - 2 + len);
}

function pngCorpus(icc: Buffer): [string, Buffer][] {
  const iccp = chunk('iCCP', Buffer.concat([Buffer.from('sRGB\0\0', 'latin1'), deflateSync(icc)]));
  const srgb = chunk('sRGB', Buffer.from([0]));
  const gama = chunk('gAMA', u32be(45455));
  const chrm = chunk('cHRM', u32be(31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000));
  const cicp = chunk('cICP', Buffer.from([1, 13, 0, 1]));
  const phys144 = chunk('pHYs', Buffer.concat([u32be(5669, 5669), Buffer.from([1])]));
  const actl = chunk('acTL', u32be(1, 0));
  const fctl = chunk('fcTL', Buffer.concat([u32be(0, W, H, 0, 0), Buffer.from([0, 1, 0, 1, 0, 0])]));
  const out: [string, PngSpec][] = [];
  for (const d of [1, 2, 4, 8]) for (const i of [false, true]) out.push([`grey${d}${i ? '-interlaced' : ''}`, { width: W, height: H, depth: d, type: 0, interlace: i, sample: grey(d) }]);
  out.push(['grey2-trns', { width: W, height: H, depth: 2, type: 0, sample: grey(2), trns: [0, 1] }]);
  out.push(['grey8-trns', { width: W, height: H, depth: 8, type: 0, sample: grey(8), trns: [0, 15] }]);
  for (const i of [false, true]) out.push([`rgb8${i ? '-interlaced' : ''}`, { width: W, height: H, depth: 8, type: 2, interlace: i, sample: rgb(8) }]);
  const rgbAt = rgb(8)(4, 3);
  out.push(['rgb8-trns', { width: W, height: H, depth: 8, type: 2, sample: rgb(8), trns: rgbAt.flatMap((v) => [0, v]) }]);
  for (const d of [1, 2, 4, 8]) for (const i of [false, true]) out.push([`palette${d}${i ? '-interlaced' : ''}`, { width: W, height: H, depth: d, type: 3, interlace: i, sample: pal(d), palette: palette(d) }]);
  out.push(['palette4-trns', { width: W, height: H, depth: 4, type: 3, sample: pal(4), palette: palette(4), trns: [0, 64, 128, 255, 1, 254] }]);
  out.push(['palette8-trns', { width: W, height: H, depth: 8, type: 3, sample: (x, y) => [(x * 11 + y * 17) % 256], palette: palette(8), trns: Array.from({ length: 200 }, (_, k) => (k * 37) & 255) }]);
  for (const i of [false, true]) out.push([`grey-alpha8${i ? '-interlaced' : ''}`, { width: W, height: H, depth: 8, type: 4, interlace: i, sample: ga(8) }]);
  for (const i of [false, true]) out.push([`rgba8${i ? '-interlaced' : ''}`, { width: W, height: H, depth: 8, type: 6, interlace: i, sample: rgba(8) }]);
  out.push(['rgba8-alpha-sweep', { width: 256, height: 3, depth: 8, type: 6, sample: (x, y) => [(x * 7 + y * 85) & 255, 255 - x, (x * 3 + 40) & 255, y === 2 ? 255 - x : x] }]);
  out.push(['rgba8-1x1', { width: 1, height: 1, depth: 8, type: 6, sample: () => [10, 20, 30, 40] }]);
  out.push(['rgb8-wide', { width: 301, height: 2, depth: 8, type: 2, sample: rgb(8) }]);
  out.push(['rgb8-tall', { width: 2, height: 173, depth: 8, type: 2, sample: rgb(8) }]);
  out.push(['rgba8-srgb', { width: W, height: H, depth: 8, type: 6, sample: rgba(8), beforePalette: [srgb] }]);
  out.push(['rgba8-srgb-gama-chrm', { width: W, height: H, depth: 8, type: 6, sample: rgba(8), beforePalette: [srgb, gama, chrm] }]);
  out.push(['rgba8-phys-144dpi', { width: W, height: H, depth: 8, type: 6, sample: rgba(8), beforePalette: [phys144] }]);
  out.push(['rgb8-gama', { width: W, height: H, depth: 8, type: 2, sample: rgb(8), beforePalette: [gama] }]);
  out.push(['rgb8-chrm', { width: W, height: H, depth: 8, type: 2, sample: rgb(8), beforePalette: [chrm] }]);
  out.push(['rgb8-gama-chrm', { width: W, height: H, depth: 8, type: 2, sample: rgb(8), beforePalette: [gama, chrm] }]);
  out.push(['rgb8-iccp', { width: W, height: H, depth: 8, type: 2, sample: rgb(8), beforePalette: [iccp] }]);
  out.push(['rgb8-cicp', { width: W, height: H, depth: 8, type: 2, sample: rgb(8), beforePalette: [cicp] }]);
  out.push(['rgba8-apng', { width: W, height: H, depth: 8, type: 6, sample: rgba(8), beforePalette: [actl], before: [fctl] }]);
  out.push(['grey16', { width: W, height: H, depth: 16, type: 0, sample: (x, y) => grey(8)(x, y).map(sixteen) }]);
  out.push(['rgb16', { width: W, height: H, depth: 16, type: 2, sample: (x, y) => rgb(8)(x, y).map(sixteen) }]);
  out.push(['grey-alpha16', { width: W, height: H, depth: 16, type: 4, sample: (x, y) => ga(8)(x, y).map(sixteen) }]);
  out.push(['rgba16', { width: W, height: H, depth: 16, type: 6, sample: (x, y) => rgba(8)(x, y).map(sixteen) }]);
  return out.map(([name, s]) => [`${name}.png`, encodePng(s)]);
}

// ------------------------------------------------------------------------------------------------------------ EXIF
type Exif = { readonly orientation?: number; readonly res?: number; readonly unit?: number; readonly pixels?: readonly [number, number]; readonly big?: boolean };

function exifSegment(e: Exif): Buffer {
  const le = e.big !== true;
  const w16 = (b: Buffer, v: number, at: number): void => void (le ? b.writeUInt16LE(v, at) : b.writeUInt16BE(v, at));
  const w32 = (b: Buffer, v: number, at: number): void => void (le ? b.writeUInt32LE(v, at) : b.writeUInt32BE(v, at));
  type Entry = { tag: number; type: number; value: number | [number, number] };
  const ifd0: Entry[] = [];
  if (e.orientation !== undefined) ifd0.push({ tag: 0x0112, type: 3, value: e.orientation });
  if (e.res !== undefined) ifd0.push({ tag: 0x011a, type: 5, value: [e.res, 1] }, { tag: 0x011b, type: 5, value: [e.res, 1] });
  if (e.unit !== undefined) ifd0.push({ tag: 0x0128, type: 3, value: e.unit });
  const exifIfd: Entry[] = e.pixels !== undefined ? [{ tag: 0xa002, type: 4, value: e.pixels[0] }, { tag: 0xa003, type: 4, value: e.pixels[1] }] : [];
  if (exifIfd.length > 0) ifd0.push({ tag: 0x8769, type: 4, value: 0 });
  const ifdSize = (n: number): number => 2 + n * 12 + 4;
  const ifd0At = 8;
  const dataAt = ifd0At + ifdSize(ifd0.length);
  const rationals = ifd0.filter((x) => x.type === 5).length;
  const exifAt = dataAt + rationals * 8;
  const tiff = Buffer.alloc(exifAt + (exifIfd.length > 0 ? ifdSize(exifIfd.length) : 0));
  tiff.write(le ? 'II' : 'MM', 0, 'latin1');
  w16(tiff, 42, 2);
  w32(tiff, ifd0At, 4);
  const writeIfd = (at: number, entries: Entry[]): void => {
    w16(tiff, entries.length, at);
    let data = dataAt;
    entries.forEach((x, i) => {
      const o = at + 2 + i * 12;
      w16(tiff, x.tag, o);
      w16(tiff, x.type, o + 2);
      w32(tiff, 1, o + 4);
      if (x.type === 3) w16(tiff, x.value as number, o + 8);
      else if (x.type === 4) w32(tiff, x.tag === 0x8769 ? exifAt : (x.value as number), o + 8);
      else {
        const [n, d] = x.value as [number, number];
        w32(tiff, data, o + 8);
        w32(tiff, n, data);
        w32(tiff, d, data + 4);
        data += 8;
      }
    });
    w32(tiff, 0, at + 2 + entries.length * 12);
  };
  writeIfd(ifd0At, ifd0);
  if (exifIfd.length > 0) writeIfd(exifAt, exifIfd);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const seg = Buffer.alloc(4);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([seg, body]);
}

/** Inserts the APP1 EXIF segment after SOI and a leading APP0. */
function withExif(jpeg: Buffer, e: Exif): Buffer {
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + jpeg.readUInt16BE(4);
  return Buffer.concat([jpeg.subarray(0, at), exifSegment(e), jpeg.subarray(at)]);
}

function jpegCorpus(base: Buffer): [string, Buffer][] {
  const out: [string, Buffer][] = [['base.jpg', base]];
  for (let o = 1; o <= 8; o++) out.push([`orientation-${o}.jpg`, withExif(base, { orientation: o })]);
  out.push(['orientation-6-big-endian.jpg', withExif(base, { orientation: 6, big: true })]);
  out.push(['orientation-9-invalid.jpg', withExif(base, { orientation: 9 })]);
  out.push(['res-72dpi.jpg', withExif(base, { res: 72, unit: 2, pixels: [48, 32] })]);
  out.push(['res-144dpi.jpg', withExif(base, { res: 144, unit: 2, pixels: [24, 16] })]);
  out.push(['res-144dpi-orientation-6.jpg', withExif(base, { orientation: 6, res: 144, unit: 2, pixels: [24, 16] })]);
  out.push(['res-144dpi-orientation-8-big-endian.jpg', withExif(base, { orientation: 8, res: 144, unit: 2, pixels: [24, 16], big: true })]);
  out.push(['res-144dpi-no-pixel-size.jpg', withExif(base, { res: 144, unit: 2 })]);
  out.push(['res-144dpi-physical-pixel-size.jpg', withExif(base, { res: 144, unit: 2, pixels: [48, 32] })]);
  out.push(['res-144dpi-centimetre.jpg', withExif(base, { res: 144, unit: 3, pixels: [24, 16] })]);
  out.push(['res-96dpi.jpg', withExif(base, { res: 96, unit: 2, pixels: [36, 24] })]);
  return out;
}

// ------------------------------------------------------------------------------------------------------------ other formats
function bmp(): Buffer {
  const w = 5;
  const h = 3;
  const stride = Math.ceil((w * 3) / 4) * 4;
  const b = Buffer.alloc(54 + stride * h);
  b.write('BM', 0, 'latin1');
  b.writeUInt32LE(b.length, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18);
  b.writeInt32LE(h, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set([x * 50, y * 100, 200], 54 + y * stride + x * 3);
  return b;
}
/** A 1x1 GIF89a: a 2-colour global table (black, white) and one LZW-coded pixel of colour 0. */
const GIF = Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex');
function ico(png: Buffer): Buffer {
  const b = Buffer.alloc(22);
  b.writeUInt16LE(0, 0);
  b.writeUInt16LE(1, 2);
  b.writeUInt16LE(1, 4);
  b[6] = 13;
  b[7] = 7;
  b.writeUInt16LE(1, 10);
  b.writeUInt16LE(32, 12);
  b.writeUInt32LE(png.length, 14);
  b.writeUInt32LE(22, 18);
  return Buffer.concat([b, png]);
}
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#08f"/></svg>\n', 'utf8');
const NOT_AN_IMAGE = Buffer.from('this text is not an image of any format\n', 'utf8');

// ------------------------------------------------------------------------------------------------------------ Chrome
async function chromeEncodings(browser: Browser): Promise<{ jpeg: Buffer; webp: Buffer }> {
  const page = await openPage(browser, '<!DOCTYPE html><html><head></head><body></body></html>', ENV);
  const hex = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 32;
    const x = c.getContext('2d') as CanvasRenderingContext2D;
    for (let i = 0; i < 48; i++) for (let j = 0; j < 32; j++) {
      x.fillStyle = `rgb(${i * 5},${j * 8},${(i * j) % 256})`;
      x.fillRect(i, j, 1, 1);
    }
    x.fillStyle = 'rgb(250,20,20)';
    x.fillRect(0, 0, 12, 8);
    const enc = (t: string, q: number): Promise<string> => new Promise((res, rej) => c.toBlob(async (b) => {
      if (b === null) return rej(new Error(`toBlob ${t} failed`));
      res(Array.from(new Uint8Array(await b.arrayBuffer())).map((v) => v.toString(16).padStart(2, '0')).join(''));
    }, t, q));
    return [await enc('image/jpeg', 0.92), await enc('image/jpeg', 0.92), await enc('image/webp', 1), await enc('image/webp', 1)];
  });
  await page.context().close();
  const [j1, j2, w1, w2] = hex as [string, string, string, string];
  if (j1 !== j2 || w1 !== w2) throw new Error('canvas.toBlob is not byte-stable within one run');
  return { jpeg: Buffer.from(j1, 'hex'), webp: Buffer.from(w1, 'hex') };
}

type Loaded = { naturalWidth: number; naturalHeight: number; decoded: boolean; rgba: string | null };

async function loadAll(browser: Browser, files: readonly [string, Buffer][], pixelsOf: (f: string) => boolean): Promise<Loaded[]> {
  const page = await openPage(browser, '<!DOCTYPE html><html><head></head><body></body></html>', ENV);
  const out: Loaded[] = [];
  for (const [file, bytes] of files) {
    const url = `data:${typeOfPath(file)};base64,${bytes.toString('base64')}`;
    out.push(await page.evaluate(async ({ url, pixels }) => {
      const img = new Image();
      img.src = url;
      let decoded = true;
      try {
        await img.decode();
      } catch {
        decoded = false;
      }
      let rgba: string | null = null;
      if (pixels && decoded) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d') as CanvasRenderingContext2D;
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let s = '';
        for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
        rgba = btoa(s);
      }
      return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, decoded, rgba };
    }, { url, pixels: pixelsOf(file) }));
  }
  await page.context().close();
  return out;
}

// ------------------------------------------------------------------------------------------------------------ quadrant probe
/** The img box in CSS px; every value times 2.625 is a whole device pixel. */
const PROBE_BOX = { left: 16, top: 16, width: 120, height: 88 } as const;
const PROBE_DPRS = [2, 3, 2.625] as const;
/** The probe image is 8x8 flat cells: red encodes the column, green the row, blue is 0; the img background is pure blue. */
const PROBE_CELLS = { red: [10, 40, 70, 100, 130, 160, 190, 220], green: [10, 40, 70, 100, 130, 160, 190, 220] } as const;
/** Natural sizes per ratio: wide scales down under contain, tall and square stay natural under scale-down. */
const PROBE_IMAGES: Record<string, readonly [number, number]> = { wide: [160, 80], tall: [40, 80], square: [64, 64] };
const PROBE_FITS = ['fill', 'contain', 'cover', 'none', 'scale-down'] as const;
/** Each axis offset is fraction x (free space) + px, measured from the named edge. */
type Offset = readonly ['left' | 'right' | 'top' | 'bottom', number, number];
const PROBE_POSITIONS: readonly { readonly css: string; readonly x: Offset; readonly y: Offset }[] = [
  { css: '50% 50%', x: ['left', 0.5, 0], y: ['top', 0.5, 0] },
  { css: 'left top', x: ['left', 0, 0], y: ['top', 0, 0] },
  { css: 'right bottom', x: ['left', 1, 0], y: ['top', 1, 0] },
  { css: 'center top', x: ['left', 0.5, 0], y: ['top', 0, 0] },
  { css: '25% 75%', x: ['left', 0.25, 0], y: ['top', 0.75, 0] },
  { css: '100% 0%', x: ['left', 1, 0], y: ['top', 0, 0] },
  { css: '10px 20px', x: ['left', 0, 10], y: ['top', 0, 20] },
  { css: '-15px 5px', x: ['left', 0, -15], y: ['top', 0, 5] },
  { css: 'right 10px bottom 5px', x: ['right', 0, 10], y: ['bottom', 0, 5] },
];
type ProbeCase = {
  readonly dpr: number;
  readonly ratio: string;
  readonly natural: readonly [number, number];
  readonly fit: string;
  readonly position: { readonly css: string; readonly x: Offset; readonly y: Offset };
  readonly device: readonly [number, number];
  readonly lines: { readonly x: readonly Line[]; readonly y: readonly Line[] };
  /** The destination rect in device px from the box origin: x, y, width, height. */
  readonly rect: readonly [number, number, number, number];
  /** How each axis start was read: a visible image edge, or the interior boundaries (which carry the resampling offset). */
  readonly anchors: readonly ['edge' | 'lines', 'edge' | 'lines'];
};

function probePng(w: number, h: number): Buffer {
  return encodePng({
    width: w, height: h, depth: 8, type: 2,
    sample: (x, y) => [PROBE_CELLS.red[(x * PROBE_CELLS.red.length / w) | 0] as number, PROBE_CELLS.green[(y * PROBE_CELLS.green.length / h) | 0] as number, 0],
  });
}

type Line = { readonly fraction: number; readonly at: number };
const r3 = (v: number): number => Number(v.toFixed(3));

/** 50% crossings along a profile, between pixel centres, of the threshold between a and b in either direction. */
function crossings(profile: readonly number[], threshold: number, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(0, from); i + 1 < Math.min(profile.length, to); i++) {
    const a = profile[i] as number;
    const b = profile[i + 1] as number;
    if ((a - threshold) * (b - threshold) < 0 || (a === threshold && b !== threshold)) out.push(i + 0.5 + (a - threshold) / (a - b));
  }
  return out;
}

/** Visible image edges (blue channel) and cell boundaries (red or green channel) along one axis. */
function axisLines(blue: number[], cell: number[], levels: readonly number[]): Line[] {
  const n = blue.length;
  const lines: Line[] = [];
  const inside = blue.map((b) => b < 128);
  const first = inside.indexOf(true);
  const last = inside.lastIndexOf(true);
  if (first < 0) throw new Error('probe: no image pixel on the scan line');
  const edges = crossings(blue, 127.5, 0, n);
  if (first > 0) lines.push({ fraction: 0, at: edges[0] as number });
  if (last < n - 1) lines.push({ fraction: 1, at: edges[edges.length - 1] as number });
  for (let k = 0; k + 1 < levels.length; k++) {
    const t = ((levels[k] as number) + (levels[k + 1] as number)) / 2;
    const xs = crossings(cell, t, first + 2, last - 1).filter((x) => {
      const i = Math.floor(x);
      const lo = Math.min(cell[i] as number, cell[i + 1] as number);
      const hi = Math.max(cell[i] as number, cell[i + 1] as number);
      return lo < (levels[k + 1] as number) && hi > (levels[k] as number) && lo >= (levels[k] as number) - 1 && hi <= (levels[k + 1] as number) + 1;
    });
    if (xs.length === 1) lines.push({ fraction: (k + 1) / levels.length, at: xs[0] as number });
    else if (xs.length > 1) throw new Error(`probe: ${xs.length} crossings of level ${t}`);
  }
  return lines.sort((a, b) => a.fraction - b.fraction);
}

/** Least-squares line at = start + fraction x size through the interior cell boundaries. */
function fit(inner: readonly Line[]): { start: number; size: number } {
  const n = inner.length;
  const mf = inner.reduce((t, l) => t + l.fraction, 0) / n;
  const ma = inner.reduce((t, l) => t + l.at, 0) / n;
  const sff = inner.reduce((t, l) => t + (l.fraction - mf) ** 2, 0);
  const size = inner.reduce((t, l) => t + (l.fraction - mf) * (l.at - ma), 0) / sff;
  return { start: ma - mf * size, size };
}

/**
 * The size along an axis with the device-px baseline it was measured over: both visible image edges when there are, else the
 * least-squares fit of two or more interior cell boundaries (Chrome's resampling moves each boundary by a sub-pixel phase; the
 * fit averages it); null when neither holds.
 */
function axisSize(lines: readonly Line[]): { size: number; baseline: number } | null {
  const e0 = lines.find((l) => l.fraction === 0);
  const e1 = lines.find((l) => l.fraction === 1);
  if (e0 !== undefined && e1 !== undefined) return { size: e1.at - e0.at, baseline: e1.at - e0.at };
  const inner = lines.filter((l) => l.fraction > 0 && l.fraction < 1);
  if (inner.length < 2) return null;
  return { size: fit(inner).size, baseline: (inner[inner.length - 1] as Line).at - (inner[0] as Line).at };
}

/** The start along an axis: a visible image edge (unaffected by resampling), else the fit's intercept at the given size. */
function axisStart(lines: readonly Line[], size: number): { start: number; anchor: 'edge' | 'lines' } {
  const e0 = lines.find((l) => l.fraction === 0);
  if (e0 !== undefined) return { start: e0.at, anchor: 'edge' };
  const e1 = lines.find((l) => l.fraction === 1);
  if (e1 !== undefined) return { start: e1.at - size, anchor: 'edge' };
  const inner = lines.filter((l) => l.fraction > 0 && l.fraction < 1);
  if (inner.length === 0) throw new Error('probe: no line on an axis');
  return { start: inner.reduce((t, l) => t + l.at - l.fraction * size, 0) / inner.length, anchor: 'lines' };
}

async function probeAt(dpr: number): Promise<ProbeCase[]> {
  const browser = await launchChrome(dpr);
  const out: ProbeCase[] = [];
  try {
    const box = PROBE_BOX;
    const html = `<!DOCTYPE html><html><head><style>html,body{margin:0;background:#fff}img{position:absolute;left:${box.left}px;top:${box.top}px;display:block;width:${box.width}px;height:${box.height}px;background:rgb(0,0,255)}</style></head><body><img id="p"></body></html>`;
    const page: Page = await openPage(browser, html, { ...ENV, devicePixelRatio: dpr });
    for (const [ratio, [nw, nh]] of Object.entries(PROBE_IMAGES)) {
      const url = `data:image/png;base64,${probePng(nw, nh).toString('base64')}`;
      for (const fit of PROBE_FITS) for (const position of PROBE_POSITIONS) {
        await page.evaluate(async ({ url, fit, position }) => {
          const img = document.getElementById('p') as HTMLImageElement;
          img.style.objectFit = fit;
          img.style.objectPosition = position;
          if (img.getAttribute('src') !== url) img.src = url;
          await img.decode();
          await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
        }, { url, fit, position: position.css });
        const shot = await page.screenshot({ clip: { x: box.left, y: box.top, width: box.width, height: box.height }, scale: 'device', type: 'png' });
        const px = decodePng(new Uint8Array(shot), inflateSync);
        const at = (x: number, y: number, c: number): number => px.data[(y * px.width + x) * 4 + c] as number;
        const cols = Array.from({ length: px.width }, (_, x) => x);
        const rows = Array.from({ length: px.height }, (_, y) => y);
        const imageRows = rows.filter((y) => cols.some((x) => at(x, y, 2) < 128));
        const imageCols = cols.filter((x) => rows.some((y) => at(x, y, 2) < 128));
        const midRow = imageRows[imageRows.length >> 1] as number;
        const midCol = imageCols[imageCols.length >> 1] as number;
        const xLines = axisLines(cols.map((x) => at(x, midRow, 2)), cols.map((x) => at(x, midRow, 0)), PROBE_CELLS.red);
        const yLines = axisLines(rows.map((y) => at(midCol, y, 2)), rows.map((y) => at(midCol, y, 1)), PROBE_CELLS.green);
        // Every fit but fill scales uniformly, so the axis measured over the longer baseline sets both sizes.
        const mx = axisSize(xLines);
        const my = axisSize(yLines);
        let w: number;
        let h: number;
        if (fit === 'fill') {
          if (mx === null || my === null) throw new Error(`probe ${ratio} fill ${position.css} at DPR ${dpr}: too few visible lines`);
          w = mx.size;
          h = my.size;
        } else if (mx !== null && (my === null || mx.baseline >= my.baseline)) {
          w = mx.size;
          h = (w / nw) * nh;
        } else if (my !== null) {
          h = my.size;
          w = (h / nh) * nw;
        } else throw new Error(`probe ${ratio} ${fit} ${position.css} at DPR ${dpr}: too few visible lines`);
        const xs = axisStart(xLines, w);
        const ys = axisStart(yLines, h);
        out.push({
          dpr, ratio, natural: [nw, nh], fit, position,
          device: [px.width, px.height],
          lines: { x: xLines.map((l) => ({ fraction: l.fraction, at: r3(l.at) })), y: yLines.map((l) => ({ fraction: l.fraction, at: r3(l.at) })) },
          rect: [r3(xs.start), r3(ys.start), r3(w), r3(h)],
          anchors: [xs.anchor, ys.anchor],
        });
      }
    }
    await page.context().close();
  } finally {
    await browser.close();
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ main
async function captureAll(dir: string): Promise<void> {
  const corpusDir = join(dir, 'corpus');
  const captureDir = join(dir, 'chrome-145');
  mkdirSync(corpusDir, { recursive: true });
  mkdirSync(captureDir, { recursive: true });
  const browser = await launchChrome(1);
  let natural: NaturalCapture;
  let pixels: unknown;
  try {
    const { jpeg, webp } = await chromeEncodings(browser);
    const pngs = pngCorpus(iccOf(jpeg));
    const rgba8 = (pngs.find(([f]) => f === 'rgba8.png') as [string, Buffer])[1];
    const files: [string, Buffer][] = [
      ...pngs,
      ...jpegCorpus(jpeg),
      ['png-served-as-jpeg.jpg', rgba8],
      ['canvas.webp', webp],
      ['colours.gif', GIF],
      ['colours.bmp', bmp()],
      ['rgba8-in.ico', ico(rgba8)],
      ['rect.svg', SVG],
      ['not-an-image.png', NOT_AN_IMAGE],
    ];
    const withPixels = (f: string): boolean => (f.endsWith('.png') && f !== 'not-an-image.png') || f === 'base.jpg';
    const loaded = await loadAll(browser, files, withPixels);
    for (const [f, b] of files) writeFileSync(join(corpusDir, f), b);
    natural = {
      ...header([1]),
      images: files.map(([file, bytes], i) => {
        const l = loaded[i] as Loaded;
        return { file, type: typeOfPath(file), sha256: sha(bytes), chrome: { naturalWidth: l.naturalWidth, naturalHeight: l.naturalHeight, decoded: l.decoded } };
      }),
    };
    pixels = {
      ...header([1]),
      note: 'getImageData after drawImage at the natural size: Chrome stores the decode premultiplied, so a translucent pixel is the decode through Skia premultiply and unpremultiply',
      images: files.flatMap(([file], i) => {
        const l = loaded[i] as Loaded;
        return l.rgba === null ? [] : [{ file, width: l.naturalWidth, height: l.naturalHeight, rgba: l.rgba }];
      }),
    };
  } finally {
    await browser.close();
  }
  const cases: ProbeCase[] = [];
  for (const dpr of PROBE_DPRS) cases.push(...(await probeAt(dpr)));
  const probe = { ...header(PROBE_DPRS), box: PROBE_BOX, cells: PROBE_CELLS, images: PROBE_IMAGES, cases };
  const write = (name: string, v: unknown): void => writeFileSync(join(captureDir, name), `${JSON.stringify(v, null, 1)}\n`);
  write('natural.json', natural);
  write('pixels.json', pixels);
  write('probe.json', probe);
}

const listed = (d: string): string[] => readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(d.length + 1)).sort();

if (!check) {
  await captureAll(repoPath('packages/dragon/test/images'));
  console.log(`image corpus written to ${CORPUS_DIR}, captures to ${CAPTURE_DIR}`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'dragon-image-captures-'));
  const faults: string[] = [];
  try {
    await captureAll(tmp);
    for (const sub of ['corpus', 'chrome-145']) {
      const committedDir = repoPath(`packages/dragon/test/images/${sub}`);
      let committed: string[] = [];
      try {
        committed = listed(committedDir);
      } catch {
        committed = [];
      }
      const fresh = listed(join(tmp, sub));
      for (const f of fresh) if (!committed.includes(f) || !readFileSync(join(tmp, sub, f)).equals(readFileSync(join(committedDir, f)))) faults.push(`${sub}/${f} differs from a fresh capture`);
      for (const f of committed) if (!fresh.includes(f)) faults.push(`${sub}/${f} is not produced by a fresh capture`);
    }
    const natural = JSON.parse(readFileSync(join(tmp, 'chrome-145', 'natural.json'), 'utf8')) as NaturalCapture;
    const bytesOf = (file: string): Uint8Array => new Uint8Array(readFileSync(join(tmp, 'corpus', file)));
    const r = compareNaturalSizes(natural, bytesOf, plant === undefined ? NO_IMAGE_FAULTS : faultsOfPlant(plant));
    for (const m of r.mismatches) faults.push(`natural size of ${m.file}: header ${JSON.stringify(m.dragon)}, Chrome ${JSON.stringify(m.chrome)}`);
    if (plant !== undefined) console.log(`plant ${plant} applied`);
    for (const f of faults) console.error(`FAULT ${f}`);
    if (faults.length > 0) process.exitCode = 1;
    else console.log(`check: corpus and captures byte-identical to a fresh capture; header natural size equals Chrome on ${r.compared}/${r.compared} images`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
