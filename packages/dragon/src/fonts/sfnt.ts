// A read-only TrueType and OpenType table reader: the facts the font manifest, matching and metrics need, and typed refusals for
// what Dragon cannot measure yet (WOFF containers, CFF glyph bounds, variable-font metrics).

/** Why a font file, or one quantity of it, cannot be used. The manifest still hashes the bytes of every refused file. */
export type SfntRefusal =
  | { readonly kind: 'unsupported-container'; readonly container: 'woff' | 'woff2' | 'collection' | 'unknown' }
  | { readonly kind: 'cff-bounds'; readonly glyph: number }
  | { readonly kind: 'variable-font' }
  | { readonly kind: 'malformed'; readonly reason: string };

export type Head = {
  readonly unitsPerEm: number;
  readonly xMin: number;
  readonly yMin: number;
  readonly xMax: number;
  readonly yMax: number;
  readonly macStyle: number;
  readonly indexToLocFormat: number;
};

export type Hhea = { readonly ascender: number; readonly descender: number; readonly lineGap: number; readonly numberOfHMetrics: number };

/** OS/2 fields by version: sxHeight and sCapHeight exist from version 2. */
export type Os2 = {
  readonly version: number;
  readonly usWeightClass: number;
  readonly usWidthClass: number;
  readonly fsSelection: number;
  readonly sTypoAscender: number;
  readonly sTypoDescender: number;
  readonly sTypoLineGap: number;
  readonly usWinAscent: number;
  readonly usWinDescent: number;
  readonly sxHeight: number | null;
  readonly sCapHeight: number | null;
};

export type Post = { readonly italicAngle: number; readonly underlinePosition: number; readonly underlineThickness: number; readonly isFixedPitch: boolean };

export type Names = { readonly postScriptName: string | null; readonly family: string | null; readonly subfamily: string | null };

export type GlyphBounds = { readonly xMin: number; readonly yMin: number; readonly xMax: number; readonly yMax: number };

/** The table facts the manifest records for one face. */
export type TableFacts = {
  readonly outlines: 'truetype' | 'cff' | 'cff2';
  readonly variable: boolean;
  readonly unitsPerEm: number;
  readonly numGlyphs: number;
  readonly tables: readonly string[];
};

export type SfntFont = {
  readonly tables: ReadonlyMap<string, { readonly offset: number; readonly length: number }>;
  readonly head: Head;
  readonly hhea: Hhea;
  readonly os2: Os2 | null;
  readonly numGlyphs: number;
  readonly post: Post | null;
  readonly names: Names;
  readonly outlines: 'truetype' | 'cff' | 'cff2';
  /** An fvar table is present. */
  readonly variable: boolean;
  /** The glyph a code point maps to through cmap (format 12 preferred, then 4); 0 when it has none. */
  glyphForCodePoint(codePoint: number): number;
  /** The advance width of a glyph in font units (hmtx). */
  advance(glyph: number): number;
  /** The bounds of a glyph's outline points in font units, null for an empty glyph; CFF outlines are refused. */
  glyphBounds(glyph: number): GlyphBounds | null | SfntRefusal;
  facts(): TableFacts;
};

export type SfntResult = { readonly ok: true; readonly font: SfntFont } | { readonly ok: false; readonly refusal: SfntRefusal };

const tag = (d: DataView, at: number): string => String.fromCharCode(d.getUint8(at), d.getUint8(at + 1), d.getUint8(at + 2), d.getUint8(at + 3));

class Malformed extends Error {}

/** Reads an sfnt file. WOFF, WOFF2 and collections are refused with unsupported-container. */
export function readSfnt(bytes: Uint8Array): SfntResult {
  if (bytes.length < 12) return { ok: false, refusal: { kind: 'malformed', reason: 'shorter than an sfnt header' } };
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = tag(d, 0);
  if (version === 'wOFF') return { ok: false, refusal: { kind: 'unsupported-container', container: 'woff' } };
  if (version === 'wOF2') return { ok: false, refusal: { kind: 'unsupported-container', container: 'woff2' } };
  if (version === 'ttcf') return { ok: false, refusal: { kind: 'unsupported-container', container: 'collection' } };
  if (version !== '\u0000\u0001\u0000\u0000' && version !== 'OTTO' && version !== 'true') {
    return { ok: false, refusal: { kind: 'unsupported-container', container: 'unknown' } };
  }
  try {
    return { ok: true, font: parse(d) };
  } catch (e) {
    if (e instanceof Malformed || e instanceof RangeError) return { ok: false, refusal: { kind: 'malformed', reason: e.message } };
    throw e;
  }
}

function parse(d: DataView): SfntFont {
  const numTables = d.getUint16(4);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const offset = d.getUint32(rec + 8);
    const length = d.getUint32(rec + 12);
    if (offset + length > d.byteLength) throw new Malformed(`table ${tag(d, rec)} runs past the end of the file`);
    tables.set(tag(d, rec), { offset, length });
  }
  const need = (name: string): number => {
    const t = tables.get(name);
    if (t === undefined) throw new Malformed(`no ${name} table`);
    return t.offset;
  };
  const h = need('head');
  const head: Head = {
    unitsPerEm: d.getUint16(h + 18),
    xMin: d.getInt16(h + 36),
    yMin: d.getInt16(h + 38),
    xMax: d.getInt16(h + 40),
    yMax: d.getInt16(h + 42),
    macStyle: d.getUint16(h + 44),
    indexToLocFormat: d.getInt16(h + 50),
  };
  const hh = need('hhea');
  const hhea: Hhea = { ascender: d.getInt16(hh + 4), descender: d.getInt16(hh + 6), lineGap: d.getInt16(hh + 8), numberOfHMetrics: d.getUint16(hh + 34) };
  const numGlyphs = d.getUint16(need('maxp') + 4);
  const os2 = readOs2(d, tables.get('OS/2'));
  const postT = tables.get('post');
  const post: Post | null = postT === undefined ? null : {
    italicAngle: d.getInt32(postT.offset + 4) / 65536,
    underlinePosition: d.getInt16(postT.offset + 8),
    underlineThickness: d.getInt16(postT.offset + 10),
    isFixedPitch: d.getUint32(postT.offset + 12) !== 0,
  };
  const names = readNames(d, tables.get('name'));
  const outlines = tables.has('CFF2') ? 'cff2' : tables.has('CFF ') ? 'cff' : 'truetype';
  const variable = tables.has('fvar');
  const cmap = readCmap(d, tables.get('cmap'));
  const hmtx = need('hmtx');
  const advance = (glyph: number): number => {
    const i = Math.min(glyph, hhea.numberOfHMetrics - 1);
    return d.getUint16(hmtx + i * 4);
  };
  const loca = outlines === 'truetype' ? tables.get('loca') : undefined;
  const glyf = outlines === 'truetype' ? tables.get('glyf') : undefined;
  const glyphRange = (glyph: number): [number, number] => {
    if (loca === undefined || glyf === undefined) throw new Malformed('no loca or glyf table');
    if (glyph < 0 || glyph >= numGlyphs) throw new Malformed(`glyph ${glyph} out of range`);
    const [a, b] = head.indexToLocFormat === 0
      ? [d.getUint16(loca.offset + glyph * 2) * 2, d.getUint16(loca.offset + glyph * 2 + 2) * 2]
      : [d.getUint32(loca.offset + glyph * 4), d.getUint32(loca.offset + glyph * 4 + 4)];
    return [glyf.offset + a, glyf.offset + b];
  };
  const glyphBounds = (glyph: number): GlyphBounds | null | SfntRefusal => {
    if (outlines !== 'truetype') return { kind: 'cff-bounds', glyph };
    const pts = glyphPoints(d, glyphRange, glyph, 0);
    if (pts.length === 0) return null;
    let xMin = Infinity;
    let yMin = Infinity;
    let xMax = -Infinity;
    let yMax = -Infinity;
    for (const [x, y] of pts) {
      xMin = Math.min(xMin, x);
      yMin = Math.min(yMin, y);
      xMax = Math.max(xMax, x);
      yMax = Math.max(yMax, y);
    }
    return { xMin, yMin, xMax, yMax };
  };
  return {
    tables,
    head,
    hhea,
    os2,
    numGlyphs,
    post,
    names,
    outlines,
    variable,
    glyphForCodePoint: cmap,
    advance,
    glyphBounds,
    facts: () => ({ outlines, variable, unitsPerEm: head.unitsPerEm, numGlyphs, tables: [...tables.keys()].sort() }),
  };
}

function readOs2(d: DataView, t: { offset: number; length: number } | undefined): Os2 | null {
  if (t === undefined || t.length < 78) return null;
  const o = t.offset;
  const version = d.getUint16(o);
  const v2 = version >= 2 && t.length >= 90;
  return {
    version,
    usWeightClass: d.getUint16(o + 4),
    usWidthClass: d.getUint16(o + 6),
    fsSelection: d.getUint16(o + 62),
    sTypoAscender: d.getInt16(o + 68),
    sTypoDescender: d.getInt16(o + 70),
    sTypoLineGap: d.getInt16(o + 72),
    usWinAscent: d.getUint16(o + 74),
    usWinDescent: d.getUint16(o + 76),
    sxHeight: v2 ? d.getInt16(o + 86) : null,
    sCapHeight: v2 ? d.getInt16(o + 88) : null,
  };
}

/** UTF-16BE (platform 0 or 3) or Mac Roman ASCII (platform 1) name records; postScriptName is ID 6, family ID 1, subfamily ID 2. */
function readNames(d: DataView, t: { offset: number; length: number } | undefined): Names {
  if (t === undefined) return { postScriptName: null, family: null, subfamily: null };
  const count = d.getUint16(t.offset + 2);
  const strings = t.offset + d.getUint16(t.offset + 4);
  const found = new Map<number, { rank: number; value: string }>();
  for (let i = 0; i < count; i++) {
    const r = t.offset + 6 + i * 12;
    const platform = d.getUint16(r);
    const encoding = d.getUint16(r + 2);
    const language = d.getUint16(r + 4);
    const id = d.getUint16(r + 6);
    const length = d.getUint16(r + 8);
    const at = strings + d.getUint16(r + 10);
    if (id !== 1 && id !== 2 && id !== 6) continue;
    let value: string;
    let rank: number;
    if (platform === 3 && (encoding === 1 || encoding === 10) || platform === 0) {
      const units: number[] = [];
      for (let k = 0; k + 1 < length; k += 2) units.push(d.getUint16(at + k));
      value = String.fromCharCode(...units);
      rank = platform === 3 && language === 0x409 ? 0 : 1;
    } else if (platform === 1 && encoding === 0) {
      const chars: number[] = [];
      for (let k = 0; k < length; k++) chars.push(d.getUint8(at + k));
      value = String.fromCharCode(...chars);
      rank = 2;
    } else continue;
    const prev = found.get(id);
    if (prev === undefined || rank < prev.rank) found.set(id, { rank, value });
  }
  return { postScriptName: found.get(6)?.value ?? null, family: found.get(1)?.value ?? null, subfamily: found.get(2)?.value ?? null };
}

/** cmap: the Unicode subtable of format 12 if present, else format 4 (platform 3 encodings 10 and 1, platform 0). */
function readCmap(d: DataView, t: { offset: number; length: number } | undefined): (cp: number) => number {
  if (t === undefined) throw new Malformed('no cmap table');
  const n = d.getUint16(t.offset + 2);
  let f12: number | null = null;
  let f4: number | null = null;
  for (let i = 0; i < n; i++) {
    const r = t.offset + 4 + i * 8;
    const platform = d.getUint16(r);
    const encoding = d.getUint16(r + 2);
    const sub = t.offset + d.getUint32(r + 4);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = d.getUint16(sub);
    if (format === 12 && f12 === null) f12 = sub;
    if (format === 4 && f4 === null) f4 = sub;
  }
  if (f12 !== null) {
    const sub = f12;
    const groups = d.getUint32(sub + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = sub + 16 + mid * 12;
        const start = d.getUint32(g);
        const end = d.getUint32(g + 4);
        if (cp < start) hi = mid - 1;
        else if (cp > end) lo = mid + 1;
        else return d.getUint32(g + 8) + (cp - start);
      }
      return 0;
    };
  }
  if (f4 !== null) {
    const sub = f4;
    const segX2 = d.getUint16(sub + 6);
    const ends = sub + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const rangeOffsets = deltas + segX2;
    return (cp) => {
      if (cp > 0xffff) return 0;
      for (let s = 0; s < segX2; s += 2) {
        if (cp > d.getUint16(ends + s)) continue;
        const start = d.getUint16(starts + s);
        if (cp < start) return 0;
        const delta = d.getInt16(deltas + s);
        const ro = d.getUint16(rangeOffsets + s);
        if (ro === 0) return (cp + delta) & 0xffff;
        const g = d.getUint16(rangeOffsets + s + ro + (cp - start) * 2);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
      return 0;
    };
  }
  throw new Malformed('no Unicode cmap subtable of format 4 or 12');
}

const X_SHORT = 2;
const Y_SHORT = 4;
const REPEAT = 8;
const X_SAME = 16;
const Y_SAME = 32;

/** The outline points of a glyph in font units, composites resolved with their offsets and 2x2 transforms. */
function glyphPoints(d: DataView, range: (g: number) => [number, number], glyph: number, depth: number): [number, number][] {
  if (depth > 16) throw new Malformed('composite glyphs nest too deeply');
  const [start, end] = range(glyph);
  if (end <= start) return [];
  const contours = d.getInt16(start);
  if (contours >= 0) {
    const endPts = start + 10;
    const count = contours === 0 ? 0 : d.getUint16(endPts + (contours - 1) * 2) + 1;
    let p = endPts + contours * 2;
    p += 2 + d.getUint16(p);
    const flags: number[] = [];
    while (flags.length < count) {
      const f = d.getUint8(p++);
      flags.push(f);
      if (f & REPEAT) {
        const r = d.getUint8(p++);
        for (let k = 0; k < r; k++) flags.push(f);
      }
    }
    const xs: number[] = [];
    let x = 0;
    for (const f of flags) {
      if (f & X_SHORT) {
        const v = d.getUint8(p++);
        x += f & X_SAME ? v : -v;
      } else if (!(f & X_SAME)) {
        x += d.getInt16(p);
        p += 2;
      }
      xs.push(x);
    }
    const pts: [number, number][] = [];
    let y = 0;
    for (let i = 0; i < flags.length; i++) {
      const f = flags[i] as number;
      if (f & Y_SHORT) {
        const v = d.getUint8(p++);
        y += f & Y_SAME ? v : -v;
      } else if (!(f & Y_SAME)) {
        y += d.getInt16(p);
        p += 2;
      }
      pts.push([xs[i] as number, y]);
    }
    return pts;
  }
  const out: [number, number][] = [];
  let p = start + 10;
  for (;;) {
    const flags = d.getUint16(p);
    const component = d.getUint16(p + 2);
    p += 4;
    let dx: number;
    let dy: number;
    if (flags & 1) {
      dx = d.getInt16(p);
      dy = d.getInt16(p + 2);
      p += 4;
    } else {
      dx = d.getInt8(p);
      dy = d.getInt8(p + 1);
      p += 2;
    }
    if (!(flags & 2)) throw new Malformed(`composite glyph ${glyph} positions a component by point numbers`);
    let a = 1;
    let b = 0;
    let c = 0;
    let dd = 1;
    const f2dot14 = (at: number): number => d.getInt16(at) / 16384;
    if (flags & 8) {
      a = dd = f2dot14(p);
      p += 2;
    } else if (flags & 0x40) {
      a = f2dot14(p);
      dd = f2dot14(p + 2);
      p += 4;
    } else if (flags & 0x80) {
      a = f2dot14(p);
      b = f2dot14(p + 2);
      c = f2dot14(p + 4);
      dd = f2dot14(p + 6);
      p += 8;
    }
    for (const [x, y] of glyphPoints(d, range, component, depth + 1)) out.push([a * x + c * y + dx, b * x + dd * y + dy]);
    if (!(flags & 0x20)) break;
  }
  return out;
}

/** The typed refusal for metrics of a variable font (deferred to TXT1b). */
export function metricsRefusal(font: SfntFont): SfntRefusal | null {
  return font.variable ? { kind: 'variable-font' } : null;
}
