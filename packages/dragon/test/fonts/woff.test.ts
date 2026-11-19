// WOFF and WOFF2 decoded at build time; the fixtures in ./woff are vendored Lato encoded by fontTools (./woff/README.md).
// The decoded tables must mean what the .ttf's do: every glyph's outline, instructions and bounds, every advance and side bearing,
// and every other table byte for byte. Byte equality of the whole file is not expected (WOFF2 §5.1).
import { readFileSync } from 'node:fs';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CssNode } from 'css-tree';
import { decodeFontFile, parseFontFace, readSfnt } from '../../src/fonts/index.ts';
import type { BrotliDecompress, SfntFont } from '../../src/fonts/index.ts';
import { atRules, vendorBytes } from './compare.ts';

/** The host's decoder, as the parity layer passes it to the compile. */
const brotli: BrotliDecompress = (data, limit) => new Uint8Array(brotliDecompressSync(data, { maxOutputLength: Math.max(1, limit) }));

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`./woff/${name}`, import.meta.url)));

const decode = (bytes: Uint8Array): Uint8Array => {
  const r = decodeFontFile(bytes, brotli);
  if (!r.ok) throw new Error(JSON.stringify(r.refusal));
  return r.sfnt;
};

const font = (bytes: Uint8Array): SfntFont => {
  const r = readSfnt(bytes);
  if (!r.ok) throw new Error(JSON.stringify(r.refusal));
  return r.font;
};

const tableBytes = (bytes: Uint8Array, f: SfntFont, tag: string): Uint8Array => {
  const t = f.tables.get(tag);
  if (t === undefined) throw new Error(`no ${tag}`);
  return bytes.subarray(t.offset, t.offset + t.length);
};

type Glyph =
  | { readonly kind: 'empty' }
  | { readonly kind: 'simple'; readonly bbox: number[]; readonly endPts: number[]; readonly instructions: number[]; readonly points: [number, number, boolean][]; readonly overlap: boolean }
  | { readonly kind: 'composite'; readonly bbox: number[]; readonly components: number[]; readonly instructions: number[] };

/** One glyph's record, read to its meaning: absolute points with their on-curve bit, so two encodings of one outline compare equal. */
function glyph(bytes: Uint8Array, f: SfntFont, g: number): Glyph {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const loca = f.tables.get('loca')!.offset;
  const glyf = f.tables.get('glyf')!.offset;
  const [a, z] = f.head.indexToLocFormat === 0 ? [d.getUint16(loca + g * 2) * 2, d.getUint16(loca + g * 2 + 2) * 2] : [d.getUint32(loca + g * 4), d.getUint32(loca + g * 4 + 4)];
  if (z <= a) return { kind: 'empty' };
  let p = glyf + a;
  const contours = d.getInt16(p);
  const bbox = [d.getInt16(p + 2), d.getInt16(p + 4), d.getInt16(p + 6), d.getInt16(p + 8)];
  p += 10;
  if (contours < 0) {
    const components: number[] = [];
    let more = true;
    let instructed = false;
    // Each component by meaning: flags without ARG_1_AND_2_ARE_WORDS (an encoder may narrow word arguments), glyph, arguments, scale.
    while (more) {
      const flags = d.getUint16(p);
      const xy = (flags & 2) !== 0;
      const words = (flags & 1) !== 0;
      components.push(flags & ~1, d.getUint16(p + 2));
      p += 4;
      if (words) components.push(xy ? d.getInt16(p) : d.getUint16(p), xy ? d.getInt16(p + 2) : d.getUint16(p + 2));
      else components.push(xy ? d.getInt8(p) : d.getUint8(p), xy ? d.getInt8(p + 1) : d.getUint8(p + 1));
      p += words ? 4 : 2;
      const scales = flags & 8 ? 1 : flags & 0x40 ? 2 : flags & 0x80 ? 4 : 0;
      for (let k = 0; k < scales; k++) components.push(d.getInt16(p + k * 2));
      p += scales * 2;
      more = (flags & 0x20) !== 0;
      instructed ||= (flags & 0x100) !== 0;
    }
    const instructions = instructed ? [...bytes.subarray(p + 2, p + 2 + d.getUint16(p))] : [];
    return { kind: 'composite', bbox, components, instructions };
  }
  const endPts = Array.from({ length: contours }, (_, k) => d.getUint16(p + k * 2));
  p += contours * 2;
  const n = contours === 0 ? 0 : (endPts[contours - 1] as number) + 1;
  const instructions = [...bytes.subarray(p + 2, p + 2 + d.getUint16(p))];
  p += 2 + instructions.length;
  const flags: number[] = [];
  while (flags.length < n) {
    const f0 = d.getUint8(p++);
    flags.push(f0);
    if (f0 & 8) for (let r = d.getUint8(p++); r > 0; r--) flags.push(f0);
  }
  const axis = (short: number, same: number): number[] => {
    let v = 0;
    return flags.map((fl) => {
      if (fl & short) v += fl & same ? d.getUint8(p++) : -d.getUint8(p++);
      else if (!(fl & same)) {
        v += d.getInt16(p);
        p += 2;
      }
      return v;
    });
  };
  const xs = axis(2, 0x10);
  const ys = axis(4, 0x20);
  return { kind: 'simple', bbox, endPts, instructions, points: flags.map((fl, k) => [xs[k] as number, ys[k] as number, (fl & 1) === 1]), overlap: ((flags[0] ?? 0) & 0x40) !== 0 };
}

/** Every table but glyf, loca and head is the same bytes; head differs only in checkSumAdjustment, modified (fontTools sets it) and flags bit 11 (WOFF2 §5). */
function expectSameFont(ttf: Uint8Array, decoded: Uint8Array): void {
  const a = font(ttf);
  const b = font(decoded);
  expect(b.numGlyphs).toBe(a.numGlyphs);
  expect([...b.tables.keys()].sort()).toEqual([...a.tables.keys()].sort());
  for (const tag of a.tables.keys()) {
    if (tag === 'glyf' || tag === 'loca' || tag === 'head') continue;
    expect(Buffer.compare(tableBytes(ttf, a, tag), tableBytes(decoded, b, tag)), tag).toBe(0);
  }
  const head = (bytes: Uint8Array, f: SfntFont): number[] => {
    const h = [...tableBytes(bytes, f, 'head')];
    h.fill(0, 8, 12);
    h.fill(0, 28, 36);
    h[16] = (h[16] as number) & ~0x08;
    return h;
  };
  expect(head(decoded, b)).toEqual(head(ttf, a));
  let compared = 0;
  for (let g = 0; g < a.numGlyphs; g++) {
    expect(glyph(decoded, b, g), `glyph ${g}`).toEqual(glyph(ttf, a, g));
    expect(b.advance(g), `advance ${g}`).toBe(a.advance(g));
    expect(b.glyphBounds(g), `bounds ${g}`).toEqual(a.glyphBounds(g));
    compared++;
  }
  expect(compared).toBe(a.numGlyphs);
}

/** The sfnt checksums: each table record's, and head's checkSumAdjustment making the whole file sum to 0xB1B0AFBA. */
function expectChecksums(bytes: Uint8Array): void {
  const sum = (b: Uint8Array): number => {
    const padded = new Uint8Array((b.length + 3) & ~3);
    padded.set(b);
    const v = new DataView(padded.buffer);
    let s = 0;
    for (let i = 0; i < padded.length; i += 4) s = (s + v.getUint32(i)) >>> 0;
    return s;
  };
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tags: string[] = [];
  for (let i = 0; i < d.getUint16(4); i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(...bytes.subarray(r, r + 4));
    const table = bytes.slice(d.getUint32(r + 8), d.getUint32(r + 8) + d.getUint32(r + 12));
    if (tag === 'head') new DataView(table.buffer).setUint32(8, 0);
    expect(d.getUint32(r + 4), tag).toBe(sum(table));
    tags.push(tag);
  }
  expect(tags).toContain('head');
  expect(sum(bytes)).toBe(0xb1b0afba);
}

describe('WOFF2 (W3C WOFF2 §4-5)', () => {
  for (const [file, ttf] of [['Lato-Regular.woff2', 'Lato/Lato-Regular.ttf'], ['Lato-Bold.woff2', 'Lato/Lato-Bold.ttf']] as const) {
    it(`${file} (glyf and loca transformed, §5.1-5.3) decodes to Lato's outlines, instructions, bounds and metrics`, () => {
      const decoded = decode(fixture(file));
      expectSameFont(vendorBytes(ttf), decoded);
      expectChecksums(decoded);
    });
  }

  it('Lato-Regular.hmtx.woff2 (hmtx transformed too, §5.4) rebuilds every side bearing from the glyph xMin', () => {
    const decoded = decode(fixture('Lato-Regular.hmtx.woff2'));
    expectSameFont(vendorBytes('Lato/Lato-Regular.ttf'), decoded);
  });

  it('a subset with the null transform (version 3) for glyf and loca, composite Aring included, decodes to the subset .ttf', () => {
    const ttf = fixture('Lato-Regular.subset.ttf');
    const decoded = decode(fixture('Lato-Regular.subset.untransformed.woff2'));
    expectSameFont(ttf, decoded);
    expect(Array.from({ length: font(ttf).numGlyphs }, (_, g) => glyph(ttf, font(ttf), g).kind)).toContain('composite');
  });

  it('decodes the same bytes every time, so the id the hosts load by is stable', () => {
    expect(Buffer.compare(decode(fixture('Lato-Bold.woff2')), decode(fixture('Lato-Bold.woff2')))).toBe(0);
  });
});

describe('WOFF 1.0', () => {
  it('Lato-Regular.woff inflates to the .ttf tables, byte for byte', () => {
    const ttf = vendorBytes('Lato/Lato-Regular.ttf');
    const decoded = decode(fixture('Lato-Regular.woff'));
    const a = font(ttf);
    const b = font(decoded);
    for (const tag of a.tables.keys()) {
      if (tag === 'head') continue;
      expect(Buffer.compare(tableBytes(ttf, a, tag), tableBytes(decoded, b, tag)), tag).toBe(0);
    }
    expectChecksums(decoded);
  });

  it('refuses a malformed WOFF by name: a table past the end of the file, and a table that does not inflate', () => {
    const woff = fixture('Lato-Regular.woff');
    const d = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
    const past = woff.slice();
    new DataView(past.buffer).setUint32(44 + 4, woff.length);
    expect(decodeFontFile(past, brotli)).toEqual({ ok: false, refusal: { kind: 'malformed-container', container: 'woff', reason: `table ${String.fromCharCode(...woff.subarray(44, 48))} runs past the end of the file` } });
    const entry = Array.from({ length: d.getUint16(12) }, (_, i) => 44 + i * 20).find((e) => d.getUint32(e + 8) < d.getUint32(e + 12)) as number;
    const corrupt = woff.slice();
    corrupt.fill(0xff, d.getUint32(entry + 4), d.getUint32(entry + 4) + 8);
    const r = decodeFontFile(corrupt, brotli);
    expect(r.ok ? null : r.refusal).toMatchObject({ kind: 'malformed-container', container: 'woff', reason: expect.stringMatching(new RegExp(`^table ${String.fromCharCode(...woff.subarray(entry, entry + 4))}: the zlib stream is invalid`)) });
  });
});

/** A WOFF2 file of the given tables, all untransformed except as flagged, with the header's lengths filled in. */
function woff2Of(tables: readonly { tag: string; data: Uint8Array; flags?: number; transformLength?: number; origLength?: number }[], flavor = 0x00010000): Uint8Array {
  const base128 = (v: number): number[] => {
    const out = [v & 0x7f];
    for (v = Math.floor(v / 128); v > 0; v = Math.floor(v / 128)) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  const dir: number[] = [];
  for (const t of tables) {
    dir.push(t.flags ?? 0x3f);
    if (((t.flags ?? 0x3f) & 0x3f) === 0x3f) dir.push(...[...t.tag].map((c) => c.charCodeAt(0)));
    dir.push(...base128(t.origLength ?? t.data.length));
    if (t.transformLength !== undefined) dir.push(...base128(t.transformLength));
  }
  const stream = new Uint8Array(brotliCompressSync(Buffer.concat(tables.map((t) => t.data))));
  const length = (48 + dir.length + stream.length + 3) & ~3;
  const out = new Uint8Array(length);
  const d = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x32]);
  d.setUint32(4, flavor);
  d.setUint32(8, length);
  d.setUint16(12, tables.length);
  d.setUint32(16, Math.max(length, tables.reduce((n, t) => n + (((t.origLength ?? t.data.length) + 3) & ~3), 12 + 16 * tables.length)));
  d.setUint32(20, stream.length);
  out.set(dir, 48);
  out.set(stream, 48 + dir.length);
  return out;
}

/** The directory entries and stream bytes of a WOFF2 file, in directory order, as woff2Of takes them. */
function woff2Tables(file: Uint8Array): { tag: string; data: Uint8Array; flags: number; origLength: number; transformLength?: number }[] {
  const d = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (;;) {
      const x = file[p++] as number;
      v = v * 128 + (x & 0x7f);
      if ((x & 0x80) === 0) return v;
    }
  };
  const known = [
    'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
    'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
    'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
    'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
  ];
  const entries = Array.from({ length: d.getUint16(12) }, () => {
    const flags = file[p++] as number;
    const explicit = (flags & 0x3f) === 0x3f;
    const tag = explicit ? String.fromCharCode(...file.subarray(p, p + 4)) : (known[flags & 0x3f] as string);
    if (explicit) p += 4;
    const origLength = base128();
    const version = flags >> 6;
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    return { tag, flags, origLength, ...(transformed ? { transformLength: base128() } : {}) };
  });
  const stream = new Uint8Array(brotliDecompressSync(file.subarray(p, p + d.getUint32(20))));
  let at = 0;
  return entries.map((e) => {
    const n = e.transformLength ?? e.origLength;
    at += n;
    return { ...e, data: stream.subarray(at - n, at) };
  });
}

describe('malformed or unsupported WOFF2 is refused by name', () => {
  const lato = fixture('Lato-Regular.woff2');
  const refusal = (bytes: Uint8Array) => {
    const r = decodeFontFile(bytes, brotli);
    return r.ok ? null : r.refusal;
  };

  it('a truncated file, a wrong header length and trailing data', () => {
    expect(refusal(lato.subarray(0, 40))).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'shorter than a WOFF2 header' });
    expect(refusal(lato.subarray(0, 4000))).toEqual({ kind: 'malformed-container', container: 'woff2', reason: `the header length ${lato.length} is not the file length 4000` });
    const longer = new Uint8Array(lato.length + 8);
    longer.set(lato);
    new DataView(longer.buffer).setUint32(8, longer.length);
    expect(refusal(longer)).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'the file has data after its last block' });
  });

  it('a corrupt Brotli stream', () => {
    const corrupt = lato.slice();
    corrupt.fill(0xff, 200, 260);
    expect(refusal(corrupt)).toMatchObject({ kind: 'malformed-container', container: 'woff2' });
  });

  it('a stream shorter or longer than the table directory lists', () => {
    const file = woff2Of([{ tag: 'abcd', data: new Uint8Array(8) }]);
    expect(refusal(file.map((x, i) => (i === 53 ? 12 : x)))).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'the font data decompresses to 8 bytes, not the 12 the table directory lists' });
    expect(refusal(file.map((x, i) => (i === 53 ? 4 : x)))).toMatchObject({ kind: 'malformed-container', container: 'woff2', reason: expect.stringMatching(/^the Brotli stream does not decode: /) });
  });

  it('an unknown transform version, a UIntBase128 with a leading zero, and a table listed twice', () => {
    expect(refusal(woff2Of([{ tag: 'name', data: new Uint8Array(4), flags: 5 | 0x40 }]))).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'table name has the unknown transform version 1' });
    const zero = woff2Of([{ tag: 'name', data: new Uint8Array(4), flags: 5 }]);
    const bumped = new Uint8Array(zero.length + 4);
    bumped.set(zero.subarray(0, 49));
    bumped[49] = 0x80;
    bumped.set(zero.subarray(49), 50);
    new DataView(bumped.buffer).setUint32(8, bumped.length);
    new DataView(bumped.buffer).setUint32(16, bumped.length);
    expect(refusal(bumped)).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'a UIntBase128 has a leading zero' });
    expect(refusal(woff2Of([{ tag: 'name', data: new Uint8Array(4), flags: 5 }, { tag: 'name', data: new Uint8Array(4) }]))).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'table name is listed twice' });
  });

  it('glyf transformed without loca, hmtx transformed without glyf, and a transformed hmtx with invalid flags', () => {
    expect(refusal(woff2Of([{ tag: 'glyf', data: new Uint8Array(4), flags: 10, transformLength: 4 }]))).toMatchObject({ kind: 'malformed-container', container: 'woff2', reason: 'the font has only one of glyf and loca' });
    const ttf = vendorBytes('Lato/Lato-Regular.ttf');
    const f = font(ttf);
    const tables = ['head', 'hhea', 'maxp', 'glyf', 'loca'].map((tag) => ({ tag, data: tableBytes(ttf, f, tag), ...(tag === 'glyf' || tag === 'loca' ? { flags: 0x3f | 0xc0 } : {}) }));
    const untransformedGlyf = woff2Of([...tables, { tag: 'hmtx', data: new Uint8Array([0x03]), flags: 3 | 0x40, transformLength: 1 }]);
    expect(refusal(untransformedGlyf)).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'hmtx is transformed but glyf is not' });
    const transformed = woff2Tables(fixture('Lato-Regular.hmtx.woff2')).map((t) => (t.tag === 'hmtx' ? { ...t, data: t.data.map((x, i) => (i === 0 ? 0x04 : x)) } : t));
    expect(refusal(woff2Of(transformed))).toEqual({ kind: 'malformed-container', container: 'woff2', reason: 'the hmtx transform flags 4 are invalid' });
  });

  it('a collection is unsupported-container collection; without Brotli a WOFF2 is no-brotli', () => {
    expect(refusal(woff2Of([{ tag: 'name', data: new Uint8Array(4) }], 0x74746366))).toEqual({ kind: 'unsupported-container', container: 'collection' });
    expect(decodeFontFile(lato, null)).toEqual({ ok: false, refusal: { kind: 'no-brotli' } });
  });

  it('an @font-face whose WOFF2 src is malformed has no face and an unreadable-font issue naming woff2', () => {
    const r = parseFontFace(atRules('@font-face{font-family:A;src:url(a.woff2) format("woff2")}')[0] as CssNode, 0, () => ({ id: 'a', bytes: lato.subarray(0, 4000) }), undefined, brotli);
    expect(r.face?.source).toBeNull();
    expect(r.issues).toEqual([{ kind: 'unreadable-font', url: 'a.woff2', refusal: { kind: 'malformed-container', container: 'woff2', reason: `the header length ${lato.length} is not the file length 4000` } }]);
  });

  it('an @font-face whose src is a WOFF2 measures from the decoded sfnt and keeps the file as authored', () => {
    const r = parseFontFace(atRules('@font-face{font-family:A;src:url(a.woff2) format("woff2")}')[0] as CssNode, 0, () => ({ id: 'a', bytes: lato }), undefined, brotli);
    expect(r.issues).toEqual([]);
    expect(r.face?.source?.container).toBe('woff2');
    expect(r.face?.source?.file).toBe(lato);
    expect(Buffer.compare(r.face!.source!.bytes, decode(lato))).toBe(0);
    expect(r.face?.source?.font.names.postScriptName).toBe('Lato-Regular');
  });
});
