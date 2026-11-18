// WOFF 1.0 and WOFF 2.0 (W3C Recommendations; section numbers below are WOFF2's) decoded at build time to the sfnt the hosts load.
// WOFF tables inflate with the core's own zlib; WOFF2's Brotli decoder is given by the host, and without one a WOFF2 is refused.
import { zlibInflate } from '../images/inflate.ts';
import type { SfntRefusal } from './sfnt.ts';

export type FontContainer = 'sfnt' | 'woff' | 'woff2';

/** A font file as the hosts load it: the file itself when it is an sfnt, else its tables rebuilt as one. */
export type DecodedFontFile =
  | { readonly ok: true; readonly container: FontContainer; readonly sfnt: Uint8Array }
  | { readonly ok: false; readonly refusal: SfntRefusal };

/** Decompresses a Brotli stream that must not grow past limit bytes; throws on any malformed stream. The host supplies it. */
export type BrotliDecompress = (data: Uint8Array, limit: number) => Uint8Array;

class Malformed extends Error {}
const bad = (why: string): never => {
  throw new Malformed(why);
};

const tagAt = (b: Uint8Array, at: number): string => String.fromCharCode(b[at] ?? 0, b[at + 1] ?? 0, b[at + 2] ?? 0, b[at + 3] ?? 0);

/** Decodes a WOFF or WOFF2 file to its sfnt; any other file passes through as itself, for readSfnt to judge. */
export function decodeFontFile(bytes: Uint8Array, brotli: BrotliDecompress | null): DecodedFontFile {
  const signature = tagAt(bytes, 0);
  if (signature !== 'wOFF' && signature !== 'wOF2') return { ok: true, container: 'sfnt', sfnt: bytes };
  const container = signature === 'wOFF' ? 'woff' : 'woff2';
  if (container === 'woff2' && brotli === null) return { ok: false, refusal: { kind: 'no-brotli' } };
  try {
    const sfnt = container === 'woff' ? decodeWoff(bytes) : decodeWoff2(bytes, brotli as BrotliDecompress);
    return { ok: true, container, sfnt };
  } catch (e) {
    if (e instanceof Collection) return { ok: false, refusal: { kind: 'unsupported-container', container: 'collection' } };
    if (e instanceof Malformed || e instanceof RangeError) return { ok: false, refusal: { kind: 'malformed-container', container, reason: e.message } };
    throw e;
  }
}

class Collection extends Error {}

type Table = { readonly tag: string; readonly data: Uint8Array };

/** WOFF 1.0 §5-6: each table stored, or zlib-compressed when compLength < origLength. */
function decodeWoff(b: Uint8Array): Uint8Array {
  if (b.length < 44) bad('shorter than a WOFF header');
  const d = view(b);
  const flavor = d.getUint32(4);
  if (flavor === 0x74746366) throw new Collection();
  if (d.getUint32(8) !== b.length) bad(`the header length ${d.getUint32(8)} is not the file length ${b.length}`);
  const numTables = d.getUint16(12);
  if (d.getUint16(14) !== 0) bad('the reserved field is not zero');
  if (44 + numTables * 20 > b.length) bad('the table directory runs past the end of the file');
  const tables: Table[] = [];
  for (let i = 0; i < numTables; i++) {
    const e = 44 + i * 20;
    const tag = tagAt(b, e);
    const offset = d.getUint32(e + 4);
    const compLength = d.getUint32(e + 8);
    const origLength = d.getUint32(e + 12);
    if (offset % 4 !== 0) bad(`table ${tag} does not start on a 4-byte boundary`);
    if (offset + compLength > b.length) bad(`table ${tag} runs past the end of the file`);
    if (compLength > origLength) bad(`table ${tag} has compLength ${compLength} greater than origLength ${origLength}`);
    const stored = b.subarray(offset, offset + compLength);
    let data: Uint8Array;
    if (compLength === origLength) data = stored;
    else {
      try {
        data = zlibInflate(stored, origLength);
      } catch (e) {
        return bad(`table ${tag}: ${(e as Error).message}`);
      }
    }
    if (data.length !== origLength) bad(`table ${tag} decompresses to ${data.length} bytes, not origLength ${origLength}`);
    if (tables.some((t) => t.tag === tag)) bad(`table ${tag} is listed twice`);
    tables.push({ tag, data });
  }
  return buildSfnt(flavor, tables);
}

/** WOFF2 §4.1 Known Table Tags, by flag index 0-62. */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** A bounds-checked big-endian reader over one stream. */
class Stream {
  private at = 0;
  private readonly d: DataView;
  private readonly b: Uint8Array;
  private readonly name: string;
  constructor(b: Uint8Array, name: string) {
    this.b = b;
    this.name = name;
    this.d = view(b);
  }
  private need(n: number): number {
    const at = this.at;
    if (at + n > this.b.length) bad(`the ${this.name} ends early`);
    this.at += n;
    return at;
  }
  u8(): number {
    return this.d.getUint8(this.need(1));
  }
  u16(): number {
    return this.d.getUint16(this.need(2));
  }
  i16(): number {
    return this.d.getInt16(this.need(2));
  }
  u32(): number {
    return this.d.getUint32(this.need(4));
  }
  bytes(n: number): Uint8Array {
    const at = this.need(n);
    return this.b.subarray(at, at + n);
  }
  /** §3.1 255UInt16. */
  u255(): number {
    const code = this.u8();
    if (code === 253) return this.u16();
    if (code === 255) return 253 + this.u8();
    if (code === 254) return 506 + this.u8();
    return code;
  }
  /** §3.1 UIntBase128: no leading zero byte, at most 5 bytes, at most 2^32-1. */
  base128(): number {
    let accum = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      if (i === 0 && byte === 0x80) bad('a UIntBase128 has a leading zero');
      if (accum >= 0x2000000) bad('a UIntBase128 exceeds 2^32-1');
      accum = accum * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return accum;
    }
    return bad('a UIntBase128 is longer than 5 bytes');
  }
  get offset(): number {
    return this.at;
  }
  get done(): boolean {
    return this.at === this.b.length;
  }
}

type Entry = { readonly tag: string; readonly origLength: number; readonly transformed: boolean; readonly length: number };

function decodeWoff2(b: Uint8Array, brotli: BrotliDecompress): Uint8Array {
  if (b.length < 48) bad('shorter than a WOFF2 header');
  const header = new Stream(b, 'header');
  header.u32();
  const flavor = header.u32();
  if (flavor === 0x74746366) throw new Collection();
  const length = header.u32();
  if (length !== b.length) bad(`the header length ${length} is not the file length ${b.length}`);
  const numTables = header.u16();
  header.u16();
  header.u32();
  const totalCompressedSize = header.u32();
  header.u32();
  const metaOffset = header.u32();
  const metaLength = header.u32();
  header.u32();
  const privOffset = header.u32();
  const privLength = header.u32();
  const dir = new Stream(b.subarray(48), 'table directory');
  const entries: Entry[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = dir.u8();
    const index = flags & 0x3f;
    const tag = index === 63 ? tagAt(dir.bytes(4), 0) : (KNOWN_TAGS[index] as string);
    const version = flags >> 6;
    const origLength = dir.base128();
    let transformed: boolean;
    if (tag === 'glyf' || tag === 'loca') {
      if (version !== 0 && version !== 3) bad(`table ${tag} has the unknown transform version ${version}`);
      transformed = version === 0;
    } else if (tag === 'hmtx') {
      if (version > 1) bad(`table hmtx has the unknown transform version ${version}`);
      transformed = version === 1;
    } else if (version !== 0) return bad(`table ${tag} has the unknown transform version ${version}`);
    else transformed = false;
    const lengthInStream = transformed ? dir.base128() : origLength;
    if (entries.some((e) => e.tag === tag)) bad(`table ${tag} is listed twice`);
    entries.push({ tag, origLength, transformed, length: lengthInStream });
  }
  const dataStart = 48 + dir.offset;
  const dataEnd = dataStart + totalCompressedSize;
  if (dataEnd > b.length) bad('the compressed font data runs past the end of the file');
  // §3: the blocks follow each other, each optional one 4-byte aligned, with nothing after the last.
  let end = dataEnd;
  for (const [what, offset, size] of [['metadata', metaOffset, metaLength], ['private data', privOffset, privLength]] as const) {
    if (offset === 0 && size === 0) continue;
    if (offset !== ((end + 3) & ~3) || b.subarray(end, offset).some((x) => x !== 0)) bad(`the ${what} block does not follow the previous block`);
    if (offset + size > b.length) bad(`the ${what} block runs past the end of the file`);
    end = offset + size;
  }
  if (end > b.length || b.length - end > 3 || b.subarray(end).some((x) => x !== 0)) bad('the file has data after its last block');
  const total = entries.reduce((n, e) => n + e.length, 0);
  let stream: Uint8Array;
  try {
    stream = brotli(b.subarray(dataStart, dataEnd), total);
  } catch (e) {
    return bad(`the Brotli stream does not decode: ${(e as Error).message}`);
  }
  if (stream.length !== total) bad(`the font data decompresses to ${stream.length} bytes, not the ${total} the table directory lists`);
  const raw = new Map<string, Uint8Array>();
  let at = 0;
  for (const e of entries) {
    raw.set(e.tag, stream.subarray(at, at + e.length));
    at += e.length;
  }
  const entry = (tag: string): Entry | undefined => entries.find((e) => e.tag === tag);
  const glyf = entry('glyf');
  const loca = entry('loca');
  if ((glyf === undefined) !== (loca === undefined)) bad('the font has only one of glyf and loca');
  if (glyf !== undefined && loca !== undefined) {
    if (glyf.transformed !== loca.transformed) bad('glyf and loca are not both transformed or both untransformed');
    if (entries.indexOf(loca) < entries.indexOf(glyf)) bad('loca comes before glyf in the table directory');
  }
  const tables = new Map(raw);
  if (glyf?.transformed === true && loca !== undefined) {
    if (loca.length !== 0) bad('the transformed loca table has a transformLength other than zero');
    const rebuilt = reconstructGlyf(raw.get('glyf') as Uint8Array);
    if (loca.origLength !== rebuilt.loca.length) bad(`the transformed loca table has origLength ${loca.origLength}, not ${rebuilt.loca.length}`);
    tables.set('glyf', rebuilt.glyf);
    tables.set('loca', rebuilt.loca);
    const head = tables.get('head');
    if (head === undefined || head.length < 54) bad('no head table');
    if (view(head as Uint8Array).getInt16(50) !== rebuilt.indexFormat) bad('the glyf indexFormat does not match head indexToLocFormat');
  }
  if (entry('hmtx')?.transformed === true) tables.set('hmtx', reconstructHmtx(raw.get('hmtx') as Uint8Array, tables));
  return buildSfnt(flavor, [...tables].map(([tag, data]) => ({ tag, data })));
}

const sign = (positive: number): number => (positive ? 1 : -1);

/** §5.2 Triplet Encoding: the point's delta x and y from its flag (low 7 bits) and its 1-4 glyph stream bytes. */
function triplet(flag: number, s: Stream): [number, number] {
  const i = flag & 0x7f;
  if (i < 10) return [0, sign(i & 1) * ((i >> 1) * 256 + s.u8())];
  if (i < 20) {
    const j = i - 10;
    return [sign(j & 1) * ((j >> 1) * 256 + s.u8()), 0];
  }
  if (i < 84) {
    const j = i - 20;
    const v = s.u8();
    return [sign(j & 1) * (1 + (j >> 4) * 16 + (v >> 4)), sign((j >> 1) & 1) * (1 + ((j >> 2) & 3) * 16 + (v & 15))];
  }
  if (i < 120) {
    const j = i - 84;
    const x = s.u8();
    const y = s.u8();
    return [sign(j & 1) * (1 + Math.floor(j / 12) * 256 + x), sign((j >> 1) & 1) * (1 + ((j % 12) >> 2) * 256 + y)];
  }
  if (i < 124) {
    const j = i - 120;
    const v = (s.u8() << 16) | (s.u8() << 8) | s.u8();
    return [sign(j & 1) * (v >> 12), sign((j >> 1) & 1) * (v & 0xfff)];
  }
  const j = i - 124;
  const x = s.u16();
  return [sign(j & 1) * x, sign((j >> 1) & 1) * s.u16()];
}

/** A growable big-endian byte buffer. */
class Out {
  private b = new Uint8Array(1 << 16);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.b.length) return;
    let size = this.b.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.b.subarray(0, this.length));
    this.b = next;
  }
  u8(v: number): void {
    this.room(1);
    this.b[this.length++] = v & 0xff;
  }
  u16(v: number): void {
    this.u8(v >> 8);
    this.u8(v);
  }
  i16(v: number, what: string): void {
    if (v < -32768 || v > 32767) bad(`${what} ${v} does not fit in an Int16`);
    this.u16(v & 0xffff);
  }
  u32(v: number): void {
    this.u16(v >>> 16);
    this.u16(v & 0xffff);
  }
  bytes(v: Uint8Array): void {
    this.room(v.length);
    this.b.set(v, this.length);
    this.length += v.length;
  }
  pad4(): void {
    while (this.length % 4 !== 0) this.u8(0);
  }
  result(): Uint8Array {
    return this.b.slice(0, this.length);
  }
}

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const X_SAME_OR_POSITIVE = 0x10;
const Y_SAME_OR_POSITIVE = 0x20;
const OVERLAP_SIMPLE = 0x40;
const ARG_1_AND_2_ARE_WORDS = 0x0001;
const WE_HAVE_A_SCALE = 0x0008;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;
const WE_HAVE_INSTRUCTIONS = 0x0100;

const bit = (bitmap: Uint8Array, i: number): boolean => (((bitmap[i >> 3] as number) >> (7 - (i & 7))) & 1) === 1;

/** §5.1 and §5.3: the glyf table rebuilt glyph by glyph from its substreams, and loca from the glyph offsets. */
function reconstructGlyf(t: Uint8Array): { glyf: Uint8Array; loca: Uint8Array; indexFormat: number } {
  const h = new Stream(t, 'transformed glyf header');
  h.u16();
  const optionFlags = h.u16();
  const numGlyphs = h.u16();
  const indexFormat = h.u16();
  if (indexFormat !== 0 && indexFormat !== 1) bad(`the glyf indexFormat ${indexFormat} is neither 0 nor 1`);
  const sizes = Array.from({ length: 7 }, () => h.u32());
  let at = h.offset;
  const sub = (k: number, name: string): Stream => {
    const size = sizes[k] as number;
    if (at + size > t.length) bad(`the ${name} runs past the end of the transformed glyf table`);
    const s = new Stream(t.subarray(at, at + size), name);
    at += size;
    return s;
  };
  const nContour = sub(0, 'nContour stream');
  const nPoints = sub(1, 'nPoints stream');
  const flagStream = sub(2, 'flag stream');
  const glyphStream = sub(3, 'glyph stream');
  const composite = sub(4, 'composite stream');
  const bboxAll = sub(5, 'bbox stream');
  const instructions = sub(6, 'instruction stream');
  const bboxBitmap = bboxAll.bytes(4 * Math.floor((numGlyphs + 31) / 32));
  const overlap = (optionFlags & 1) === 1 ? new Stream(t.subarray(at), 'overlapSimpleBitmap').bytes((numGlyphs + 7) >> 3) : null;
  if (at + (overlap?.length ?? 0) !== t.length) bad('the transformed glyf table has data after its streams');
  const glyf = new Out();
  const offsets: number[] = [];
  for (let g = 0; g < numGlyphs; g++) {
    offsets.push(glyf.length);
    const contours = nContour.i16();
    const explicit = bit(bboxBitmap, g);
    if (contours === 0) {
      if (explicit) bad(`empty glyph ${g} has an explicit bounding box`);
      continue;
    }
    if (contours > 0) {
      const endPts: number[] = [];
      let total = 0;
      for (let c = 0; c < contours; c++) {
        total += nPoints.u255();
        endPts.push(total - 1);
      }
      if (total > 0xffff) bad(`glyph ${g} has more than 65535 points`);
      const flags: number[] = [];
      const xs: number[] = [];
      const ys: number[] = [];
      let x = 0;
      let y = 0;
      let xMin = 0;
      let yMin = 0;
      let xMax = 0;
      let yMax = 0;
      for (let p = 0; p < total; p++) {
        const flag = flagStream.u8();
        const [dx, dy] = triplet(flag, glyphStream);
        x += dx;
        y += dy;
        if (p === 0 || x < xMin) xMin = x;
        if (p === 0 || x > xMax) xMax = x;
        if (p === 0 || y < yMin) yMin = y;
        if (p === 0 || y > yMax) yMax = y;
        flags.push((flag & 0x80) === 0 ? ON_CURVE : 0);
        xs.push(dx);
        ys.push(dy);
      }
      const instructionLength = glyphStream.u255();
      const code = instructions.bytes(instructionLength);
      if (explicit) [xMin, yMin, xMax, yMax] = [bboxAll.i16(), bboxAll.i16(), bboxAll.i16(), bboxAll.i16()];
      glyf.i16(contours, 'numberOfContours');
      for (const [v, what] of [[xMin, 'xMin'], [yMin, 'yMin'], [xMax, 'xMax'], [yMax, 'yMax']] as const) glyf.i16(v, `glyph ${g} ${what}`);
      for (const e of endPts) glyf.u16(e);
      glyf.u16(instructionLength);
      glyf.bytes(code);
      const encoded = flags.map((f, p) => {
        const dx = xs[p] as number;
        const dy = ys[p] as number;
        let out = f;
        if (dx === 0) out |= X_SAME_OR_POSITIVE;
        else if (Math.abs(dx) < 256) out |= X_SHORT | (dx > 0 ? X_SAME_OR_POSITIVE : 0);
        if (dy === 0) out |= Y_SAME_OR_POSITIVE;
        else if (Math.abs(dy) < 256) out |= Y_SHORT | (dy > 0 ? Y_SAME_OR_POSITIVE : 0);
        return out;
      });
      if (overlap !== null && bit(overlap, g) && encoded.length > 0) encoded[0] = (encoded[0] as number) | OVERLAP_SIMPLE;
      for (const f of encoded) glyf.u8(f);
      for (const [k, d] of xs.entries()) {
        const f = encoded[k] as number;
        if (f & X_SHORT) glyf.u8(Math.abs(d));
        else if (!(f & X_SAME_OR_POSITIVE)) glyf.i16(d, `glyph ${g} delta x`);
      }
      for (const [k, d] of ys.entries()) {
        const f = encoded[k] as number;
        if (f & Y_SHORT) glyf.u8(Math.abs(d));
        else if (!(f & Y_SAME_OR_POSITIVE)) glyf.i16(d, `glyph ${g} delta y`);
      }
      glyf.pad4();
      continue;
    }
    if (contours !== -1) bad(`glyph ${g} has numberOfContours ${contours}`);
    if (!explicit) bad(`composite glyph ${g} has no explicit bounding box`);
    const parts = new Out();
    let hasInstructions = false;
    for (;;) {
      const flags = composite.u16();
      const argumentBytes = 2 + ((flags & ARG_1_AND_2_ARE_WORDS) ? 4 : 2) + ((flags & WE_HAVE_A_SCALE) ? 2 : (flags & WE_HAVE_AN_X_AND_Y_SCALE) ? 4 : (flags & WE_HAVE_A_TWO_BY_TWO) ? 8 : 0);
      parts.u16(flags);
      parts.bytes(composite.bytes(argumentBytes));
      if (flags & WE_HAVE_INSTRUCTIONS) hasInstructions = true;
      if (!(flags & MORE_COMPONENTS)) break;
    }
    glyf.i16(-1, 'numberOfContours');
    for (let k = 0; k < 4; k++) glyf.i16(bboxAll.i16(), `glyph ${g} bounding box`);
    glyf.bytes(parts.result());
    if (hasInstructions) {
      const instructionLength = glyphStream.u255();
      glyf.u16(instructionLength);
      glyf.bytes(instructions.bytes(instructionLength));
    }
    glyf.pad4();
  }
  offsets.push(glyf.length);
  const loca = new Out();
  for (const o of offsets) {
    if (indexFormat === 0) {
      if (o / 2 > 0xffff) bad('the rebuilt glyf table is too large for the short loca format');
      loca.u16(o / 2);
    } else loca.u32(o);
  }
  return { glyf: glyf.result(), loca: loca.result(), indexFormat };
}

/** §5.4: hmtx with the lsb arrays the transform dropped rebuilt from each glyph's xMin (0 for an empty glyph). */
function reconstructHmtx(t: Uint8Array, tables: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const glyf = tables.get('glyf');
  const loca = tables.get('loca');
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const maxp = tables.get('maxp');
  if (glyf === undefined || loca === undefined || head === undefined || hhea === undefined || maxp === undefined) return bad('the hmtx transform needs glyf, loca, head, hhea and maxp tables');
  if (head.length < 54 || hhea.length < 36 || maxp.length < 6) bad('head, hhea or maxp is too short');
  const numHMetrics = view(hhea).getUint16(34);
  const numGlyphs = view(maxp).getUint16(4);
  if (numHMetrics < 1 || numHMetrics > numGlyphs) bad(`hhea numberOfHMetrics ${numHMetrics} is outside 1 to numGlyphs ${numGlyphs}`);
  const longLoca = view(head).getInt16(50) === 1;
  const lv = view(loca);
  const gv = view(glyf);
  const xMin = (g: number): number => {
    const need = (g + 2) * (longLoca ? 4 : 2);
    if (need > loca.length) bad(`loca has no entry for glyph ${g}`);
    const [a, z] = longLoca ? [lv.getUint32(g * 4), lv.getUint32(g * 4 + 4)] : [lv.getUint16(g * 2) * 2, lv.getUint16(g * 2 + 2) * 2];
    if (z <= a) return 0;
    if (a + 10 > glyf.length) bad(`glyph ${g} runs past the end of glyf`);
    return gv.getInt16(a + 2);
  };
  const s = new Stream(t, 'transformed hmtx table');
  const flags = s.u8();
  if ((flags & 0xfc) !== 0 || (flags & 3) === 0) bad(`the hmtx transform flags ${flags} are invalid`);
  const advances = Array.from({ length: numHMetrics }, () => s.u16());
  const lsb = (flags & 1) ? advances.map((_, g) => xMin(g)) : advances.map(() => s.i16());
  const rest = Array.from({ length: numGlyphs - numHMetrics }, (_, k) => k + numHMetrics);
  const leftSideBearing = (flags & 2) ? rest.map(xMin) : rest.map(() => s.i16());
  if (!s.done) bad('the transformed hmtx table has data after its arrays');
  const out = new Out();
  advances.forEach((a, g) => {
    out.u16(a);
    out.i16(lsb[g] as number, 'lsb');
  });
  for (const v of leftSideBearing) out.i16(v, 'leftSideBearing');
  return out.result();
}

const checksum = (b: Uint8Array): number => {
  const padded = b.length % 4 === 0 ? b : (() => {
    const p = new Uint8Array((b.length + 3) & ~3);
    p.set(b);
    return p;
  })();
  const d = view(padded);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + d.getUint32(i)) >>> 0;
  return sum;
};

/** An sfnt with its tables in tag order, each 4-byte aligned and checksummed, and head's checkSumAdjustment recomputed. */
function buildSfnt(flavor: number, tables: readonly Table[]): Uint8Array {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const n = sorted.length;
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= n) entrySelector++;
  const searchRange = 2 ** entrySelector * 16;
  let size = 12 + 16 * n;
  const offsets = sorted.map((t) => {
    const at = size;
    size += (t.data.length + 3) & ~3;
    return at;
  });
  const out = new Uint8Array(size);
  const d = view(out);
  d.setUint32(0, flavor);
  d.setUint16(4, n);
  d.setUint16(6, searchRange);
  d.setUint16(8, entrySelector);
  d.setUint16(10, n * 16 - searchRange);
  let headAt = -1;
  sorted.forEach((t, i) => {
    const data = t.tag === 'head' ? t.data.slice() : t.data;
    if (t.tag === 'head') {
      if (data.length < 12) bad('the head table is too short');
      view(data).setUint32(8, 0);
      headAt = offsets[i] as number;
    }
    const rec = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[rec + k] = t.tag.charCodeAt(k);
    d.setUint32(rec + 4, checksum(data));
    d.setUint32(rec + 8, offsets[i] as number);
    d.setUint32(rec + 12, data.length);
    out.set(data, offsets[i] as number);
  });
  if (headAt >= 0) d.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}
