// REPL-0: the images module against the Chrome 145 captures of scripts/capture-image-data.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  buildImageManifest, compareNaturalSizes, decodePng, faultsOfPlant, IMAGE_PLANTS, imageRefusal, manifestDigestInput, NO_IMAGE_FAULTS,
  parseDataUrl, parseJpeg, parsePng, readImageHeader, sniffImage, typeOfPath,
} from '../../src/images/index.ts';
import type { ImagePlant, NaturalCapture } from '../../src/images/index.ts';

const here = (p: string): URL => new URL(p, import.meta.url);
const json = <T>(name: string): T => JSON.parse(readFileSync(here(`./chrome-145/${name}`), 'utf8')) as T;
const corpus = (file: string): Uint8Array => new Uint8Array(readFileSync(here(`./corpus/${file}`)));
const inflate = (d: Uint8Array): Uint8Array => new Uint8Array(inflateSync(d));

const natural = json<NaturalCapture>('natural.json');
type Pixels = { images: { file: string; width: number; height: number; rgba: string }[] };
const pixels = json<Pixels>('pixels.json');
type Offset = ['left' | 'right' | 'top' | 'bottom', number, number];
type Probe = {
  box: { width: number; height: number };
  cases: { dpr: number; ratio: string; natural: [number, number]; fit: string; position: { css: string; x: Offset; y: Offset }; rect: [number, number, number, number]; anchors: string[] }[];
};
const probe = json<Probe>('probe.json');

// Chrome stores a decoded image premultiplied (SkMulDiv255Round) and getImageData unpremultiplies it in Skia's float32 raster
// pipeline: load x float32(1/255), times float32(1 / alpha), clamp to 1, x 255, round half to even. Opaque pixels pass unchanged.
const f = Math.fround;
const INV255 = f(1 / 255);
const halfEven = (v: number): number => {
  const fl = Math.floor(v);
  const d = v - fl;
  return d > 0.5 ? fl + 1 : d < 0.5 ? fl : fl % 2 === 0 ? fl : fl + 1;
};
function throughCanvas(rgba: Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3] as number;
    out[i + 3] = a;
    for (let k = 0; k < 3; k++) {
      const c = rgba[i + k] as number;
      if (a === 255) out[i + k] = c;
      else if (a === 0) out[i + k] = 0;
      else {
        const p = Math.round((c * a) / 255);
        out[i + k] = halfEven(f(Math.min(1, f(f(p * INV255) * f(1 / f(a * INV255)))) * 255));
      }
    }
  }
  return out;
}

describe('natural size (R4)', () => {
  it('the header natural size equals Chrome naturalWidth/naturalHeight for every PNG and JPEG of the corpus', () => {
    const r = compareNaturalSizes(natural, corpus);
    expect(r.mismatches).toEqual([]);
    const readable = natural.images.filter((i) => readImageHeader(corpus(i.file), i.type) !== null);
    expect(r.compared).toBe(readable.length);
    expect(r.compared).toBe(64);
  });
  it.each(Object.keys(IMAGE_PLANTS) as ImagePlant[])('plant %s breaks at least one pair', (plant) => {
    expect(compareNaturalSizes(natural, corpus, faultsOfPlant(plant)).mismatches.length).toBeGreaterThan(0);
  });
  it('pins the measured rules: EXIF orientation swaps 5-8, density correction needs inch and matching pixel dimensions, pHYs is ignored', () => {
    const chrome = (file: string): [number, number] => {
      const i = natural.images.find((x) => x.file === file);
      return [i?.chrome.naturalWidth ?? -1, i?.chrome.naturalHeight ?? -1];
    };
    expect(chrome('orientation-5.jpg')).toEqual([32, 48]);
    expect(chrome('orientation-9-invalid.jpg')).toEqual([48, 32]);
    expect(chrome('res-144dpi.jpg')).toEqual([24, 16]);
    expect(chrome('res-144dpi-orientation-6.jpg')).toEqual([16, 24]);
    expect(chrome('res-144dpi-no-pixel-size.jpg')).toEqual([48, 32]);
    expect(chrome('res-144dpi-centimetre.jpg')).toEqual([48, 32]);
    expect(chrome('res-96dpi.jpg')).toEqual([36, 24]);
    expect(chrome('rgba8-phys-144dpi.png')).toEqual([13, 7]);
    expect(chrome('png-served-as-jpeg.jpg')).toEqual([13, 7]);
  });
});

describe('PNG decode (R3)', () => {
  const accepted = pixels.images.filter((p) => p.file.endsWith('.png') && imageRefusal(corpus(p.file), 'image/png') === null);
  it('covers every accepted corpus PNG', () => {
    const all = natural.images.filter((i) => i.file.endsWith('.png') && imageRefusal(corpus(i.file), i.type) === null).map((i) => i.file);
    expect(accepted.map((p) => p.file)).toEqual(all);
    expect(all.length).toBe(34);
  });
  it.each(accepted.map((p) => [p.file, p] as const))('%s: the TS decode equals Chrome getImageData byte for byte', (_file, p) => {
    const d = decodePng(corpus(p.file), inflate);
    expect([d.width, d.height]).toEqual([p.width, p.height]);
    const chrome = new Uint8Array(Buffer.from(p.rgba, 'base64'));
    expect(Buffer.from(throughCanvas(d.data)).equals(Buffer.from(chrome))).toBe(true);
  });
  it('opaque pixels equal getImageData with no canvas step, over every accepted PNG', () => {
    let opaque = 0;
    for (const p of accepted) {
      const d = decodePng(corpus(p.file), inflate).data;
      const chrome = Buffer.from(p.rgba, 'base64');
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] !== 255) continue;
        opaque += 1;
        expect([d[i], d[i + 1], d[i + 2], d[i + 3]]).toEqual([chrome[i], chrome[i + 1], chrome[i + 2], chrome[i + 3]]);
      }
    }
    expect(opaque).toBeGreaterThan(1000);
  });
});

describe('refusals (R1-R3)', () => {
  it('the refusal list over the corpus is exact', () => {
    const files = readdirSync(here('./corpus')).sort();
    const refused = Object.fromEntries(files.flatMap((file) => {
      const r = imageRefusal(corpus(file), typeOfPath(file));
      return r === null ? [] : [[file, r.package]];
    }));
    const jpegs = files.filter((f) => f.endsWith('.jpg') && f !== 'png-served-as-jpeg.jpg');
    expect(refused).toEqual({
      ...Object.fromEntries(jpegs.map((f) => [f, 'REPL-j'])),
      'canvas.webp': 'REPL-g', 'colours.gif': 'REPL-g', 'colours.bmp': 'REPL-g', 'rgba8-in.ico': 'REPL-g', 'rect.svg': 'REPL-svg',
      'not-an-image.png': null,
      'grey16.png': 'REPL-c', 'rgb16.png': 'REPL-c', 'grey-alpha16.png': 'REPL-c', 'rgba16.png': 'REPL-c',
      'rgb8-gama.png': 'REPL-c', 'rgb8-chrm.png': 'REPL-c', 'rgb8-gama-chrm.png': 'REPL-c', 'rgb8-iccp.png': 'REPL-c', 'rgb8-cicp.png': 'REPL-c',
      'rgba8-apng.png': 'REPL-an',
    });
    expect(jpegs.length).toBe(19);
  });
  it('Chrome decodes every refused corpus image but the non-image, so each refusal is a Dragon limit, not a broken image', () => {
    for (const i of natural.images) expect(i.chrome.decoded, i.file).toBe(i.file !== 'not-an-image.png');
  });
});

describe('sniffing (R2)', () => {
  it('decides by magic bytes, whatever the URL or type says, except SVG which only the type names', () => {
    expect(sniffImage(corpus('png-served-as-jpeg.jpg'), 'image/jpeg')).toBe('png');
    expect(sniffImage(corpus('base.jpg'), 'image/png')).toBe('jpeg');
    expect(sniffImage(corpus('canvas.webp'), null)).toBe('webp');
    expect(sniffImage(corpus('colours.gif'), null)).toBe('gif');
    expect(sniffImage(corpus('colours.bmp'), null)).toBe('bmp');
    expect(sniffImage(corpus('rgba8-in.ico'), null)).toBe('ico');
    expect(sniffImage(corpus('rect.svg'), 'image/svg+xml; charset=utf-8')).toBe('svg');
    expect(sniffImage(corpus('rect.svg'), 'image/png')).toBeNull();
    expect(sniffImage(corpus('rgba8.png'), 'image/svg+xml')).toBe('svg');
    const avif = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypmif1\0\0\0\0mif1avif')]);
    expect(sniffImage(avif, null)).toBe('avif');
    expect(sniffImage(corpus('rgba8.png').subarray(0, 13), 'image/png')).toBeNull();
  });
});

describe('PNG and JPEG headers', () => {
  it('reads the colour chunks, tRNS, interlace and acTL', () => {
    const facts = (file: string) => {
      const p = parsePng(corpus(file));
      if (!p.ok) throw new Error(p.reason);
      return p.facts;
    };
    expect(facts('palette4-trns.png')).toMatchObject({ bitDepth: 4, colourType: 3, hasTrns: true, interlaced: false });
    expect(facts('rgb8-interlaced.png')).toMatchObject({ interlaced: true });
    expect(facts('rgba8-srgb-gama-chrm.png')).toMatchObject({ srgbIntent: 0, gama: 45455, hasChrm: true });
    expect(facts('rgba8-apng.png').animated).toBe(true);
    expect(facts('rgba8-phys-144dpi.png').phys).toEqual({ x: 5669, y: 5669, unit: 1 });
    const bad = corpus('rgba8.png').slice();
    bad[20] = (bad[20] as number) ^ 1;
    expect(parsePng(bad)).toEqual({ ok: false, reason: 'IHDR CRC mismatch' });
  });
  it('reads SOFn, progressive, EXIF in both byte orders and the ICC APP2', () => {
    const j = parseJpeg(corpus('res-144dpi-orientation-8-big-endian.jpg'));
    expect(j).toMatchObject({ ok: true, facts: { width: 48, height: 32, sof: 0xc0, progressive: false, hasIcc: true, exif: { orientation: 8, resolutionUnit: 2, resolution: { x: [144, 1], y: [144, 1] }, pixelSize: { width: 24, height: 16 } } } });
    const sof2 = Uint8Array.from([0xff, 0xd8, 0xff, 0xc2, 0, 11, 8, 0, 3, 0, 5, 1, 1, 0x11, 0, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
    expect(parseJpeg(sof2)).toMatchObject({ ok: true, facts: { width: 5, height: 3, progressive: true, exif: null } });
  });
  it('fails a SOF whose length does not match its components, and a frame with no SOS (Chrome 145 fails both)', () => {
    const soi = [0xff, 0xd8];
    const sof = (length: number, components: number, extra: number[]): number[] => [0xff, 0xc0, 0, length, 8, 0, 3, 0, 5, components, ...extra];
    const sos = [0xff, 0xda, 0, 2, 0xff, 0xd9];
    // Three components declared, none specified (the six-byte header only).
    expect(parseJpeg(Uint8Array.from([...soi, ...sof(8, 3, []), ...sos]))).toMatchObject({ ok: false });
    // One component plus three stray bytes.
    expect(parseJpeg(Uint8Array.from([...soi, ...sof(14, 1, [1, 0x11, 0, 0, 0, 0]), ...sos]))).toMatchObject({ ok: false });
    expect(parseJpeg(Uint8Array.from([...soi, ...sof(11, 1, [1, 0x11, 0]), ...sos]))).toMatchObject({ ok: true });
    // A complete frame then EOF, or EOI, before any SOS.
    expect(parseJpeg(Uint8Array.from([...soi, ...sof(11, 1, [1, 0x11, 0])]))).toEqual({ ok: false, reason: 'no SOS after SOF' });
    expect(parseJpeg(Uint8Array.from([...soi, ...sof(11, 1, [1, 0x11, 0]), 0xff, 0xd9]))).toEqual({ ok: false, reason: 'no SOS after SOF' });
    const truncated = corpus('orientation-1.jpg');
    const sosAt = truncated.findIndex((b, i) => b === 0xff && truncated[i + 1] === 0xda);
    expect(imageRefusal(truncated.subarray(0, sosAt), 'image/jpeg')?.package).toBeNull();
  });
});

describe('the image manifest (R1)', () => {
  const png = corpus('rgba8.png');
  const dataUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
  const read = (path: string): Uint8Array => corpus(path.replace(/^covers\//, ''));
  it('takes data: URLs and mapped files; a remote or unmapped src never yields an entry', () => {
    const ok = buildImageManifest([dataUrl, 'https://i.ytimg.com/vi/x/maxresdefault.jpg'], { 'https://i.ytimg.com/vi/x/maxresdefault.jpg': 'covers/png-served-as-jpeg.jpg' }, read);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.manifest.images.map((e) => [e.source, e.path, e.format, e.naturalSize, e.refusal])).toEqual([
      ['data', null, 'png', { width: 13, height: 7 }, null],
      ['mapped', 'covers/png-served-as-jpeg.jpg', 'png', { width: 13, height: 7 }, null],
    ]);
    expect(ok.manifest.images[0]?.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const bad = buildImageManifest(['https://example.com/a.png', '//cdn.example.com/b.png', 'img/c.png', 'data:image/png;base64,@@'], {}, read);
    expect(bad).toEqual({ ok: false, problems: [
      { kind: 'remote-image', src: '//cdn.example.com/b.png' },
      { kind: 'bad-data-url', src: 'data:image/png;base64,@@' },
      { kind: 'remote-image', src: 'https://example.com/a.png' },
      { kind: 'unmapped-image', src: 'img/c.png' },
    ] });
  });
  it('the digest input is canonical and independent of the src order', () => {
    const a = buildImageManifest([dataUrl, 'x.jpg'], { 'x.jpg': 'orientation-6.jpg' }, corpus);
    const b = buildImageManifest(['x.jpg', dataUrl, 'x.jpg'], { 'x.jpg': 'orientation-6.jpg' }, corpus);
    if (!a.ok || !b.ok) throw new Error('manifest refused');
    expect(JSON.stringify(manifestDigestInput(a.manifest))).toBe(JSON.stringify(manifestDigestInput(b.manifest)));
    expect(a.manifest.images.find((e) => e.src === 'x.jpg')).toMatchObject({ format: 'jpeg', naturalSize: { width: 32, height: 48 }, refusal: { package: 'REPL-j' } });
  });
  it('parses data: URLs as the fetch standard does', () => {
    expect(parseDataUrl('data:,A%20b')).toEqual({ type: null, bytes: Uint8Array.from([0x41, 0x20, 0x62]) });
    expect(parseDataUrl('data:image/svg+xml;charset=utf-8,<svg/>')?.type).toBe('image/svg+xml;charset=utf-8');
    expect(parseDataUrl('data:image/png;base64,iVBO Rw==')?.bytes).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
    expect(parseDataUrl('data:image/png;base64')).toBeNull();
  });
  it('reads a data: URL as Chrome 145 fetches it: fragment dropped, C0 and space stripped at the ends only', () => {
    // Observed with fetch() in Chrome 145: data:,a?b#c is "a?b"; tabs and newlines inside the body stay; a trailing NBSP stays.
    expect(parseDataUrl('data:,a?b#c')?.bytes).toEqual(Uint8Array.from([0x61, 0x3f, 0x62]));
    expect(parseDataUrl('data:,a\tb\nc\rd')?.bytes).toEqual(Uint8Array.from([0x61, 9, 0x62, 10, 0x63, 13, 0x64]));
    expect(parseDataUrl('\u0001 data:,x \u0002')?.bytes).toEqual(Uint8Array.from([0x78]));
    expect(parseDataUrl('data:,x\u00a0')?.bytes).toEqual(Uint8Array.from([0x78, 0xc2, 0xa0]));
    expect(parseDataUrl(`${dataUrl.slice(0, 40)}\n${dataUrl.slice(40)}#frag`)?.bytes).toEqual(png);
    expect(buildImageManifest([`\u0001${dataUrl}#frag`], {}, read)).toMatchObject({ ok: true, manifest: { images: [{ source: 'data', format: 'png' }] } });
  });
  it('decodes a data: URL larger than the engine argument limit', () => {
    const big = new Uint8Array(1_000_000).fill(7);
    const parsed = parseDataUrl(`data:;base64,${Buffer.from(big).toString('base64')}`);
    expect(parsed?.bytes).toEqual(big);
  });
  it('an inherited name is not a mapped asset', () => {
    expect(buildImageManifest(['toString', 'constructor', '__proto__'], {}, read)).toEqual({ ok: false, problems: [
      { kind: 'unmapped-image', src: '__proto__' },
      { kind: 'unmapped-image', src: 'constructor' },
      { kind: 'unmapped-image', src: 'toString' },
    ] });
  });
  it('the planted faults move only the natural size', () => {
    const e = buildImageManifest([dataUrl], {}, corpus, faultsOfPlant('ihdr-swap'));
    expect(e.ok && e.manifest.images[0]?.naturalSize).toEqual({ width: 7, height: 13 });
    expect(NO_IMAGE_FAULTS).toEqual({ ihdrSwap: false, exifIgnored: false, densityIgnored: false });
  });
});

describe('the quadrant probe (R7)', () => {
  const offset = ([edge, fraction, px]: Offset, free: number): number => (edge === 'left' || edge === 'top' ? fraction * free + px : free - (fraction * free + px));
  it('covers fit x position x ratio at DPR 2, 3 and 2.625', () => {
    expect(probe.cases.length).toBe(5 * 9 * 3 * 3);
    expect([...new Set(probe.cases.map((c) => c.dpr))]).toEqual([2, 3, 2.625]);
  });
  it('every captured destination rect is within 1 device px (GATE_DEVICE_PX) of the css-images-3 object-fit rect', () => {
    const { width: W, height: H } = probe.box;
    const off: string[] = [];
    for (const c of probe.cases) {
      const [nw, nh] = c.natural;
      const contain = Math.min(W / nw, H / nh);
      const scale = ({ contain, cover: Math.max(W / nw, H / nh), none: 1, 'scale-down': Math.min(1, contain) } as Record<string, number>)[c.fit];
      const dw = scale === undefined ? W : nw * scale;
      const dh = scale === undefined ? H : nh * scale;
      const want = [offset(c.position.x, W - dw), offset(c.position.y, H - dh), dw, dh].map((v) => v * c.dpr);
      const worst = Math.max(...want.map((v, i) => Math.abs(v - (c.rect[i] as number))));
      if (worst > 1) off.push(`${c.dpr} ${c.ratio} ${c.fit} ${c.position.css}: ${c.rect.join(',')} vs ${want.join(',')}`);
    }
    expect(off).toEqual([]);
  });
});

describe('base64Encode (the PNG bytes the native image paint embeds)', () => {
  it('equals RFC 4648 base64 with padding on every length remainder, every byte value and every corpus image', async () => {
    const { base64Encode } = await import('../../src/images/compile.ts');
    const cases: Uint8Array[] = [new Uint8Array(0), Uint8Array.of(0), Uint8Array.of(255, 254), Uint8Array.of(1, 2, 3), Uint8Array.from({ length: 256 }, (_, i) => i)];
    let seed = 7;
    for (let n = 0; n < 64; n++) cases.push(Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24));
    const dir = new URL('./corpus/', import.meta.url);
    for (const f of readdirSync(dir)) if (f.endsWith('.png')) cases.push(new Uint8Array(readFileSync(new URL(f, dir))));
    expect(cases.length).toBeGreaterThan(69);
    for (const b of cases) expect(base64Encode(b), `${b.length} bytes`).toBe(Buffer.from(b).toString('base64'));
  });
});

describe('zlibInflate and the PNG decode refusal (Macroscope 4169579864: CRC-valid PNGs whose image data does not decode)', () => {
  it('inflates exactly as node:zlib on every corpus PNG and on seeded data at every level and strategy', async () => {
    const { deflateSync, constants } = await import('node:zlib');
    const { zlibInflate } = await import('../../src/images/inflate.ts');
    const { parsePng } = await import('../../src/images/png.ts');
    let checked = 0;
    for (const f of readdirSync(here('./corpus/'))) {
      if (!f.endsWith('.png')) continue;
      const p = parsePng(corpus(f));
      if (!p.ok) continue;
      expect(Buffer.from(zlibInflate(p.idat)).equals(inflateSync(p.idat)), f).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(30);
    let seed = 11;
    const rand = (): number => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    for (const n of [0, 1, 7, 300, 5000, 70000]) {
      // Runs and noise, so every block type and long back-references occur.
      const data = Uint8Array.from({ length: n }, (_, i) => ((i >> 6) % 3 === 0 ? rand() : (i >> 4) & 0xff));
      for (const level of [0, 1, 6, 9]) {
        for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FIXED, constants.Z_HUFFMAN_ONLY, constants.Z_RLE]) {
          const z = deflateSync(data, { level, strategy });
          expect(Buffer.from(zlibInflate(z)).equals(Buffer.from(data)), `${n} bytes, level ${level}, strategy ${strategy}`).toBe(true);
        }
      }
    }
  });

  it('throws on a bad header, a preset dictionary, a truncated stream, a corrupt block and a checksum mismatch', async () => {
    const { deflateSync } = await import('node:zlib');
    const { zlibInflate } = await import('../../src/images/inflate.ts');
    const good = new Uint8Array(deflateSync(Uint8Array.from({ length: 4000 }, (_, i) => (i * 7) & 0xff)));
    const flip = (at: number, mask: number): Uint8Array => {
      const b = good.slice();
      b[at] = (b[at] as number) ^ mask;
      return b;
    };
    expect(() => zlibInflate(flip(0, 0x01))).toThrow(/compression method|header check/);
    expect(() => zlibInflate(Uint8Array.of(0x78, 0xbb, 0, 0, 0, 0, 0, 0))).toThrow(/preset dictionary/);
    for (const cut of [2, 5, good.length - 5, good.length - 1]) expect(() => zlibInflate(good.subarray(0, cut)), `cut at ${cut}`).toThrow(/zlib stream is invalid/);
    expect(() => zlibInflate(flip(good.length - 1, 0x01))).toThrow(/Adler-32/);
    // A stored block whose length does not match its complement, and block type 3.
    expect(() => zlibInflate(Uint8Array.of(0x78, 0x01, 0x01, 0x05, 0x00, 0x00, 0x00, 0, 0, 0, 0))).toThrow(/complement/);
    expect(() => zlibInflate(Uint8Array.of(0x78, 0x01, 0x07, 0, 0, 0, 0, 0))).toThrow(/block type 3/);
    // pngRawSize equals the inflated IDAT size of every corpus PNG, interlaced or not.
    const { pngRawSize } = await import('../../src/images/png.ts');
    let sized = 0;
    for (const f of readdirSync(here('./corpus/'))) {
      if (!f.endsWith('.png')) continue;
      const p = parsePng(corpus(f));
      if (!p.ok) continue;
      expect(pngRawSize(p.facts), f).toBe(inflateSync(p.idat).length);
      sized++;
    }
    expect(sized).toBeGreaterThan(30);
    // The limit: exactly the output size passes, one byte less throws.
    expect(zlibInflate(good, 4000).length).toBe(4000);
    expect(() => zlibInflate(good, 3999)).toThrow(/inflates past 3999 bytes/);
    // Every single-bit flip in the deflate data either throws or changes nothing the checksum would miss.
    for (let at = 2; at < good.length - 4; at += 13) {
      let out: Uint8Array | null = null;
      try {
        out = zlibInflate(flip(at, 0x10));
      } catch {
        continue;
      }
      expect(Buffer.from(out).equals(inflateSync(good)), `flip at ${at}`).toBe(true);
    }
  });

  it('rejects an incomplete Huffman code as zlib inflate_table does, except a single one-bit literal/length or distance code', async () => {
    const { zlibInflate } = await import('../../src/images/inflate.ts');
    // A one-block dynamic-Huffman zlib stream, written bit by bit (RFC 1951 §3.2.7). The code-length code is complete: symbols
    // 0, 1, 2 and 18 at two bits each. lit and dist give each symbol's code length; body lists the literal/length symbols to emit.
    const stream = (lit: ReadonlyMap<number, number>, dist: readonly number[], body: readonly number[], out: readonly number[]): Uint8Array => {
      const bytes: number[] = [0x78, 0x01];
      let acc = 0;
      let n = 0;
      const put = (v: number, bits: number): void => {
        for (let i = 0; i < bits; i++) {
          acc |= ((v >>> i) & 1) << n++;
          if (n === 8) { bytes.push(acc); acc = 0; n = 0; }
        }
      };
      const code = (c: number, len: number): void => { for (let i = len - 1; i >= 0; i--) put((c >>> i) & 1, 1); };
      const canonical = (lens: readonly number[]): number[] => {
        const codes: number[] = [];
        let next = 0;
        for (let len = 1; len < 16; len++) {
          for (let s2 = 0; s2 < lens.length; s2++) if (lens[s2] === len) codes[s2] = next++;
          next <<= 1;
        }
        return codes;
      };
      put(1, 1); put(2, 2); put(0, 5); put(dist.length - 1, 5); put(14, 4);
      const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1];
      const clen = (sym: number): number => ([0, 1, 2, 18].includes(sym) ? 2 : 0);
      for (const sym of order) put(clen(sym), 3);
      const clCodes = canonical(Array.from({ length: 19 }, (_, i) => clen(i)));
      const litLens = Array.from({ length: 257 }, (_, i) => lit.get(i) ?? 0);
      const all = [...litLens, ...dist];
      for (let i = 0; i < all.length;) {
        let run = 0;
        while (all[i + run] === 0 && run < 138 && i + run < all.length) run++;
        if (run >= 11) { code(clCodes[18] as number, 2); put(run - 11, 7); i += run; continue; }
        code(clCodes[all[i] as number] as number, 2);
        i++;
      }
      const litCodes = canonical(litLens);
      for (const sym of body) code(litCodes[sym] as number, litLens[sym] as number);
      if (n > 0) bytes.push(acc);
      let a = 1;
      let b = 0;
      for (const x of out) { a = (a + x) % 65521; b = (b + a) % 65521; }
      return Uint8Array.from([...bytes, (b >>> 8) & 0xff, b & 0xff, (a >>> 8) & 0xff, a & 0xff]);
    };
    // Literal 0 and end-of-block at two bits each: two of four two-bit codes, so the code is incomplete. zlib: "invalid literal/lengths set".
    expect(() => zlibInflate(stream(new Map([[0, 2], [256, 2]]), [1], [0, 256], [0]))).toThrow(/incomplete literal\/length code/);
    // The same with a complete literal/length code (0, 1 and 256 at 1, 2 and 2 bits) inflates.
    expect([...zlibInflate(stream(new Map([[0, 1], [1, 2], [256, 2]]), [1], [0, 1, 256], [0, 1]))]).toEqual([0, 1]);
    // A single one-bit literal/length code (end-of-block only) and a single one-bit distance code are allowed, as in zlib.
    expect([...zlibInflate(stream(new Map([[256, 1]]), [1], [256], []))]).toEqual([]);
    // An incomplete distance code with a longest code over one bit is not. zlib: "invalid distances set".
    expect(() => zlibInflate(stream(new Map([[0, 1], [1, 2], [256, 2]]), [2, 2], [0, 1, 256], [0, 1]))).toThrow(/incomplete distance code/);
    // An incomplete code-length code (only symbol 0, at one bit) is never allowed. zlib: "invalid code lengths set".
    const clIncomplete = Uint8Array.from([0x78, 0x01, 0b00000101, 0b10000000, 0b00000000, 0b00000001, 0, 0, 0, 0, 0, 0]);
    expect(() => zlibInflate(clIncomplete)).toThrow(/incomplete code length code/);
    // node:zlib agrees on every case above.
    expect(() => inflateSync(stream(new Map([[0, 2], [256, 2]]), [1], [0, 256], [0]))).toThrow(/invalid literal\/lengths set/);
    expect(() => inflateSync(stream(new Map([[0, 1], [1, 2], [256, 2]]), [2, 2], [0, 1, 256], [0, 1]))).toThrow(/invalid distances set/);
    expect(() => inflateSync(clIncomplete)).toThrow(/invalid code lengths set/);
    expect([...inflateSync(stream(new Map([[0, 1], [1, 2], [256, 2]]), [1], [0, 1, 256], [0, 1]))]).toEqual([0, 1]);
    expect([...inflateSync(stream(new Map([[256, 1]]), [1], [256], []))]).toEqual([]);
  });

  it('refuses a PNG whose chunks and CRCs are valid but whose image data does not decode, and accepts the corpus PNGs it accepted', async () => {
    const { crc32, parsePng } = await import('../../src/images/png.ts');
    const { deflateSync } = await import('node:zlib');
    const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const chunk = (type: string, data: Uint8Array): number[] => {
      const body = Uint8Array.from([...type].map((c) => c.charCodeAt(0)).concat([...data]));
      return [...u32(data.length), ...body, ...u32(crc32(body))];
    };
    // A 2 x 2 8-bit RGB PNG: IHDR, one IDAT, IEND, with every CRC correct.
    const png = (idat: Uint8Array): Uint8Array => Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk('IHDR', Uint8Array.from([...u32(2), ...u32(2), 8, 2, 0, 0, 0])),
      ...chunk('IDAT', idat),
      ...chunk('IEND', new Uint8Array(0)),
    ]);
    const rows = Uint8Array.of(0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255);
    const ok = png(new Uint8Array(deflateSync(rows)));
    expect(parsePng(ok).ok).toBe(true);
    expect(imageRefusal(ok, 'image/png')).toBeNull();
    const cases: [string, Uint8Array, RegExp][] = [
      ['not a zlib stream', Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8), /does not decode: the zlib stream is invalid/],
      ['truncated image data', new Uint8Array(deflateSync(rows.subarray(0, 7))), /does not decode: PNG image data is truncated/],
      ['an unknown row filter', new Uint8Array(deflateSync(Uint8Array.of(9, ...rows.subarray(1)))), /does not decode: unknown PNG filter 9/],
    ];
    for (const [what, idat, why] of cases) {
      const bytes = png(idat);
      expect(parsePng(bytes).ok, what).toBe(true);
      const r = imageRefusal(bytes, 'image/png');
      expect(r?.package, what).toBeNull();
      expect(r?.reason, what).toMatch(why);
    }
    // An expansion bomb (Macroscope 4170043800): 64 MiB of zeros in a few KB of IDAT stops at the 14 bytes IHDR declares.
    const bomb = new Uint8Array(deflateSync(new Uint8Array(64 * 1024 * 1024), { level: 9 }));
    expect(bomb.length).toBeLessThan(100_000);
    expect(imageRefusal(png(bomb), 'image/png')?.reason).toMatch(/does not decode: the zlib stream is invalid: it inflates past 14 bytes/);
    // A bitmap Android cannot draw (over 100 MiB) is refused from IHDR alone, before any image buffer is allocated.
    const huge = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...chunk('IHDR', Uint8Array.from([...u32(6000), ...u32(5000), 8, 2, 0, 0, 0])),
      ...chunk('IDAT', bomb),
      ...chunk('IEND', new Uint8Array(0)),
    ]);
    expect(imageRefusal(huge, 'image/png')?.reason).toBe('its 6000 x 5000 bitmap is 120000000 bytes, over the 104857600 bytes Android draws');
    // The decode check refuses nothing the corpus accepted before it: every corpus PNG it accepts decodes with node:zlib too.
    for (const f of readdirSync(here('./corpus/'))) {
      if (!f.endsWith('.png') || imageRefusal(corpus(f), 'image/png') !== null) continue;
      expect(() => decodePng(corpus(f), (d) => new Uint8Array(inflateSync(d))), f).not.toThrow();
    }
  });
});
