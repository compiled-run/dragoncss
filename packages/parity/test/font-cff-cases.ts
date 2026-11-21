// Fonts that each sit just on one side of one rule of Chrome's sanitizer (OTS) for the 'CFF ' table, built from
// DragonBlackletter-Regular.otf (and Lato Regular for a CFF beside glyf and loca); woff-sanitizer.test.ts checks Dragon against Chrome.
import { cat, sfntOf, sfntTables } from './font-table-cases.ts';
import type { Table } from './font-table-cases.ts';

type Bytes = Uint8Array;
type At = { at(block: string): number; len(block: string): number };
type Part = number[] | ((a: At) => number[]);
type Entry = { key: number; part: Part };
type Model = {
  names: Bytes[];
  top: Entry[];
  strings: Bytes[];
  gsubrs: Bytes[];
  charset: Bytes;
  glyphs: Bytes[];
  priv: Entry[];
  subrs: Bytes[];
  fd: Entry[];
  blocks: [string, (a: At) => ArrayLike<number>][];
};

const ESC = 1200;
const u16 = (v: number) => [(v >> 8) & 255, v & 255];
const u32 = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
const opBytes = (key: number) => (key >= ESC ? [12, key - ESC] : [key]);

/** A DICT integer in its shortest form. */
function int(v: number): number[] {
  if (v >= -107 && v <= 107) return [v + 139];
  if (v >= 108 && v <= 1131) return [247 + ((v - 108) >> 8), (v - 108) & 255];
  if (v <= -108 && v >= -1131) return [251 + ((-v - 108) >> 8), (-v - 108) & 255];
  if (v >= -32768 && v <= 32767) return [28, ...u16(v)];
  return [29, ...u32(v)];
}
/** A DICT integer in the fixed 5-byte form, so offsets can be laid out in two passes. */
const long = (v: number) => [29, ...u32(v)];
const dictEntry = (key: number, ...args: number[]) => [...args.flatMap(int), ...opBytes(key)];

function index(items: ArrayLike<number>[], offSize = 0): Bytes {
  if (items.length === 0) return new Uint8Array([0, 0]);
  const end = items.reduce((s, x) => s + x.length, 1);
  const size = offSize || (end < 0x100 ? 1 : end < 0x10000 ? 2 : end < 0x1000000 ? 3 : 4);
  const offs: number[] = [];
  let o = 1;
  for (const x of [...items, []]) {
    for (let k = size - 1; k >= 0; k--) offs.push(Math.floor(o / 256 ** k) & 255);
    o += x.length;
  }
  return cat(u16(items.length), [size], offs, ...items);
}

const OPS: Record<string, number[]> = {
  hstem: [1], vstem: [3], vmoveto: [4], rlineto: [5], hlineto: [6], rrcurveto: [8], callsubr: [10], return: [11], endchar: [14],
  hstemhm: [18], hintmask: [19], rmoveto: [21], hmoveto: [22], vhcurveto: [30], callgsubr: [29], dotsection: [12, 0],
  add: [12, 10], random: [12, 23], dup: [12, 27], roll: [12, 30], flex: [12, 35], blend: [16], reserved2: [2],
};
/** A Type 2 charstring: numbers, operator names, and raw byte arrays. */
function cs(...xs: (number | string | number[])[]): Bytes {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === 'string') out.push(...OPS[x]!);
    else if (Array.isArray(x)) out.push(...x);
    else if (x >= -107 && x <= 107) out.push(x + 139);
    else if (x >= 108 && x <= 1131) out.push(247 + ((x - 108) >> 8), (x - 108) & 255);
    else if (x <= -108 && x >= -1131) out.push(251 + ((-x - 108) >> 8), (-x - 108) & 255);
    else out.push(28, ...u16(x));
  }
  return Uint8Array.from(out);
}

function readIndex(c: Bytes, at: number): { items: Bytes[]; end: number } {
  const n = (c[at]! << 8) | c[at + 1]!;
  if (n === 0) return { items: [], end: at + 2 };
  const size = c[at + 2]!;
  const off = (i: number) => {
    let v = 0;
    for (let k = 0; k < size; k++) v = v * 256 + c[at + 3 + i * size + k]!;
    return at + 3 + (n + 1) * size + v - 1;
  };
  return { items: Array.from({ length: n }, (_, i) => c.slice(off(i), off(i + 1))), end: off(n) };
}

function readDict(d: Bytes): { key: number; args: number[]; raw: Bytes }[] {
  const out: { key: number; args: number[]; raw: Bytes }[] = [];
  let args: number[] = [];
  let start = 0;
  let i = 0;
  while (i < d.length) {
    const b0 = d[i]!;
    if (b0 <= 21) {
      const key = b0 === 12 ? ESC + d[i + 1]! : b0;
      i += b0 === 12 ? 2 : 1;
      out.push({ key, args, raw: d.slice(start, i) });
      args = [];
      start = i;
    } else if (b0 === 28) (args.push((d[i + 1]! << 8) | d[i + 2]!), (i += 3));
    else if (b0 === 29) (args.push((d[i + 1]! << 24) | (d[i + 2]! << 16) | (d[i + 3]! << 8) | d[i + 4]!), (i += 5));
    else if (b0 === 30) {
      i++;
      while ((d[i]! & 0xf) !== 0xf && (d[i]! & 0xf0) !== 0xf0) i++;
      i++;
      args.push(0);
    } else if (b0 <= 246) (args.push(b0 - 139), i++);
    else if (b0 <= 250) (args.push((b0 - 247) * 256 + d[i + 1]! + 108), (i += 2));
    else (args.push(-(b0 - 251) * 256 - d[i + 1]! - 108), (i += 2));
  }
  return out;
}

/** The OTF's CFF as parts that rebuild into an equivalent table, with every offset laid out afresh. */
function model(c: Bytes, glyphCount: number): Model {
  const names = readIndex(c, 4);
  const top = readIndex(c, names.end);
  const strings = readIndex(c, top.end);
  const gsubrs = readIndex(c, strings.end);
  const te = readDict(top.items[0]!);
  const arg = (es: { key: number; args: number[] }[], key: number) => es.find((e) => e.key === key)!.args;
  const [privLen, privAt] = arg(te, 18) as [number, number];
  const pe = readDict(c.subarray(privAt, privAt + privLen));
  const charsetAt = arg(te, 15)[0]!;
  const m: Model = {
    names: names.items,
    strings: strings.items,
    gsubrs: gsubrs.items,
    charset: c.slice(charsetAt, charsetAt + 1 + 2 * (glyphCount - 1)),
    glyphs: readIndex(c, arg(te, 17)[0]!).items,
    subrs: readIndex(c, privAt + arg(pe, 19)[0]!).items,
    top: [
      ...te.filter((e) => ![15, 16, 17, 18].includes(e.key)).map((e) => ({ key: e.key, part: [...e.raw] })),
      { key: 15, part: (a) => [...long(a.at('charset')), 15] },
      { key: 16, part: [139, 16] },
      { key: 17, part: (a) => [...long(a.at('charstrings')), 17] },
      { key: 18, part: (a) => [...long(a.len('private')), ...long(a.at('private')), 18] },
    ],
    priv: [
      ...pe.filter((e) => e.key !== 19).map((e) => ({ key: e.key, part: [...e.raw] })),
      { key: 19, part: (a) => [...long(a.at('subrs') - a.at('private')), 19] },
    ],
    fd: [],
    blocks: [],
  };
  const flat = (a: At, es: Entry[]) => es.flatMap((e) => (typeof e.part === 'function' ? e.part(a) : e.part));
  m.blocks = [
    ['header', () => [1, 0, 4, 4]],
    ['names', () => index(m.names)],
    ['top', (a) => index([flat(a, m.top)])],
    ['strings', () => index(m.strings)],
    ['gsubrs', () => index(m.gsubrs)],
    ['charset', () => m.charset],
    ['charstrings', () => index(m.glyphs)],
    ['private', (a) => flat(a, m.priv)],
    ['subrs', () => index(m.subrs)],
  ];
  return m;
}

function build(m: Model): Bytes {
  const pass = (a: At) => {
    const pos = new Map<string, number>();
    const lens = new Map<string, number>();
    let off = 0;
    const parts = m.blocks.map(([name, f]) => {
      const b = Uint8Array.from(f(a));
      pos.set(name, off);
      lens.set(name, b.length);
      off += b.length;
      return b;
    });
    return { bytes: cat(...parts), pos, lens };
  };
  const first = pass({ at: () => 0, len: () => 0 });
  return pass({ at: (n) => first.pos.get(n) ?? 0, len: (n) => first.lens.get(n) ?? 0 }).bytes;
}

const setEntry = (es: Entry[], key: number, part: Part | null, front = false) => {
  const i = es.findIndex((e) => e.key === key);
  if (part === null) {
    if (i >= 0) es.splice(i, 1);
  } else if (i >= 0 && !front) es[i] = { key, part };
  else {
    if (i >= 0) es.splice(i, 1);
    if (front) es.unshift({ key, part });
    else es.push({ key, part });
  }
};
const setBlock = (m: Model, name: string, f: (a: At) => ArrayLike<number>, after?: string) => {
  const i = m.blocks.findIndex(([n]) => n === name);
  if (i >= 0) m.blocks[i] = [name, f];
  else m.blocks.splice(after ? m.blocks.findIndex(([n]) => n === after) + 1 : m.blocks.length, 0, [name, f]);
};
const flatEntries = (a: At, es: Entry[]) => es.flatMap((e) => (typeof e.part === 'function' ? e.part(a) : e.part));

/** Makes the font CID-keyed: ROS first, no Encoding, one Font DICT holding the Private DICT, and the given FDSelect. */
function cid(m: Model, fdSelect: number[], fdCount = 1): void {
  setEntry(m.top, ESC + 30, dictEntry(ESC + 30, 391, 392, 0), true);
  setEntry(m.top, 18, null);
  setEntry(m.top, 16, null);
  m.fd = [{ key: 18, part: (a) => [...long(a.len('private')), ...long(a.at('private')), 18] }];
  setEntry(m.top, ESC + 36, (a) => [...long(a.at('fdarray')), 12, 36]);
  setEntry(m.top, ESC + 37, (a) => [...long(a.at('fdselect')), 12, 37]);
  setBlock(m, 'fdarray', (a) => index(Array.from({ length: fdCount }, () => flatEntries(a, m.fd))), 'subrs');
  setBlock(m, 'fdselect', () => fdSelect, 'fdarray');
}
const fd3 = (...ranges: number[]) => [3, ...u16((ranges.length - 1) / 2), ...ranges.flatMap((v, i) => (i % 2 === 0 ? u16(v) : [v]))];

/** 11 more local subrs after the font's own: subr 11 + k calls subr 12 + k, so calling subr 11 nests `depth` deep. */
function chain(m: Model, depth: number): number {
  const first = m.subrs.length;
  for (let k = 0; k < depth; k++) m.subrs.push(k === depth - 1 ? cs('return') : cs(first + k + 1 - 107, 'callsubr', 'return'));
  return first - 107;
}

function cases(otf: Uint8Array): { ts: Table[]; glyphCount: number; out: [string, Uint8Array][]; add: (name: string, f: (m: Model) => void, patch?: (b: Bytes) => Bytes) => void } {
  const ts = sfntTables(otf);
  const version = new DataView(otf.buffer, otf.byteOffset).getUint32(0);
  const cff = ts.find((t) => t.tag === 'CFF ')!.data;
  const glyphCount = new DataView(ts.find((t) => t.tag === 'maxp')!.data.buffer).getUint16(4);
  const withCff = (data: Bytes) => sfntOf(ts.map((t) => (t.tag === 'CFF ' ? { tag: t.tag, data } : t)), version);
  const out: [string, Uint8Array][] = [];
  const add = (name: string, f: (m: Model) => void, patch?: (b: Bytes) => Bytes) => {
    const m = model(cff, glyphCount);
    f(m);
    const b = build(m);
    out.push(['sfnt: CFF ' + name, withCff(patch ? patch(b) : b)]);
  };
  return { ts, glyphCount, out, add };
}

export function cffCases(otf: Uint8Array, ttf: Uint8Array): [string, Uint8Array][] {
  const { glyphCount, out, add } = cases(otf);
  const glyph = (...xs: (number | string | number[])[]) => (m: Model) => void (m.glyphs[1] = cs(...xs));
  const nums = (n: number) => Array.from({ length: n }, (_, i) => i % 50);

  add('rebuilt unchanged', () => {});
  add('header offSize 0', () => {}, (b) => ((b[3] = 0), b));
  add('header offSize 1', () => {}, (b) => ((b[3] = 1), b));
  add('version 1.1', () => {}, (b) => ((b[1] = 1), b));
  add('header size 5', (m) => setBlock(m, 'header', () => [1, 0, 5, 4, 0]));
  add('table of 4 bytes', () => {}, (b) => b.slice(0, 4));

  add('Name INDEX with 2 names', (m) => m.names.push(ascii('Second')));
  add('font name with a space', (m) => (m.names[0] = ascii('Dragon Black')));
  add('font name with a leading NUL', (m) => (m.names[0] = cat([0], ascii('DragonBlack'))));
  add('font name of 128 bytes', (m) => (m.names[0] = ascii('A'.repeat(128))));
  add('font name of 127 bytes', (m) => (m.names[0] = ascii('A'.repeat(127))));
  add('Name INDEX offSize 5', (m) => setBlock(m, 'names', () => cat([0, 1, 5], [0, 0, 0, 0, 1, 0, 0, 0, 0, 7], ascii('Dragon'))));
  add('Name INDEX first offset 2', (m) => setBlock(m, 'names', () => cat([0, 1, 1, 2, 8], ascii('xDragon'))));
  add('Top DICT INDEX with 2 DICTs', (m) => setBlock(m, 'top', (a) => index([flatEntries(a, m.top), [139, 13]])));
  add('String INDEX of 64609 strings', (m) => (m.strings = Array.from({ length: 64609 }, (_, i) => m.strings[i] ?? new Uint8Array())));
  add('String INDEX of 64610 strings', (m) => (m.strings = Array.from({ length: 64610 }, (_, i) => m.strings[i] ?? new Uint8Array())));
  add('Global Subrs INDEX with offsets 1 3 2', (m) => setBlock(m, 'gsubrs', () => [0, 2, 1, 1, 3, 2, 11, 11]));
  add('Global Subrs INDEX with an empty entry', (m) => setBlock(m, 'gsubrs', () => [0, 2, 1, 1, 1, 2, 11]));
  add('Global Subrs INDEX offset past the table', (m) => setBlock(m, 'gsubrs', () => [0, 1, 4, 0, 0, 0, 1, 0x7f, 0, 0, 0, 11]));

  add('Top DICT reserved byte 25', (m) => setEntry(m.top, 13, [25]));
  add('Top DICT reserved escape 12 15', (m) => setEntry(m.top, ESC + 15, [139, 12, 15]));
  add('FontBBox of 47 operands', (m) => setEntry(m.top, 5, dictEntry(5, ...nums(47))));
  add('FontBBox of 48 operands', (m) => setEntry(m.top, 5, dictEntry(5, ...nums(48))));
  add('Top DICT ending in 1 loose operand', (m) => setEntry(m.top, 999, [139]));
  add('Top DICT ending in 49 loose operands', (m) => setEntry(m.top, 999, nums(49).flatMap(int)));
  add('real with two points', (m) => setEntry(m.top, ESC + 2, [30, 0x1a, 0x2a, 0xff, 12, 2]));
  add('real with a second point in a high nibble', (m) => setEntry(m.top, ESC + 2, [30, 0xa1, 0xa2, 0xff, 12, 2]));
  add('real with nibble 0xd', (m) => setEntry(m.top, ESC + 2, [30, 0x1d, 0xff, 12, 2]));
  add('real ending f in the high nibble only', (m) => setEntry(m.top, ESC + 2, [30, 0x12, 0xf1, 12, 2]));
  add('CharstringType 251 110 (OTS reads 2)', (m) => setEntry(m.top, ESC + 6, [251, 110, 12, 6]));
  add('CharstringType 251 111 (OTS reads 3)', (m) => setEntry(m.top, ESC + 6, [251, 111, 12, 6]));

  add('version SID 395 (the last string)', (m) => setEntry(m.top, 0, dictEntry(0, 395)));
  add('version SID 396 (no such string)', (m) => setEntry(m.top, 0, dictEntry(0, 396)));
  add('version with 2 operands', (m) => setEntry(m.top, 0, dictEntry(0, 1, 2)));
  add('version as a real', (m) => setEntry(m.top, 0, [30, 0x1f, 0]));
  add('FontBBox with no operands', (m) => setEntry(m.top, 5, [5]));
  add('UniqueID with 1 operand', (m) => setEntry(m.top, 13, dictEntry(13, 5)));
  add('UniqueID with 2 operands', (m) => setEntry(m.top, 13, dictEntry(13, 5, 6)));
  add('CharstringType 2', (m) => setEntry(m.top, ESC + 6, dictEntry(ESC + 6, 2)));
  add('CharstringType 1', (m) => setEntry(m.top, ESC + 6, dictEntry(ESC + 6, 1)));
  add('isFixedPitch 1', (m) => setEntry(m.top, ESC + 1, dictEntry(ESC + 1, 1)));
  add('isFixedPitch 2', (m) => setEntry(m.top, ESC + 1, dictEntry(ESC + 1, 2)));
  add('Top DICT with BlueValues', (m) => setEntry(m.top, 6, dictEntry(6, 0, 10)));
  add('CIDCount without ROS', (m) => setEntry(m.top, ESC + 34, dictEntry(ESC + 34, 96)));
  add('CID-keyed with CIDCount', (m) => {
    cid(m, fd3(0, 0, glyphCount));
    setEntry(m.top, ESC + 34, dictEntry(ESC + 34, glyphCount));
  });
  add('ROS after another operator', (m) => setEntry(m.top, ESC + 30, dictEntry(ESC + 30, 391, 392, 0)));
  add('ROS with 2 operands', (m) => setEntry(m.top, ESC + 30, dictEntry(ESC + 30, 391, 392), true));
  add('ROS ordering SID 396', (m) => setEntry(m.top, ESC + 30, dictEntry(ESC + 30, 391, 396, 0), true));

  add('charset offset past the table', (m) => setEntry(m.top, 15, [...long(1 << 24), 15]));
  add('two charset operators', (m) => m.top.push({ key: 1015, part: (a) => [...long(a.at('charset')), 15] }));
  add('charset format 3', (m) => (m.charset = Uint8Array.from([3, ...m.charset.subarray(1)])));
  add('charset format 2', (m) => (m.charset = Uint8Array.from([2, 0, 1, ...u16(glyphCount - 2)])));
  add('charset format 1', (m) => (m.charset = Uint8Array.from([1, 0, 1, glyphCount - 2])));
  add('charset format 1 with SID 396', (m) => (m.charset = Uint8Array.from([1, ...u16(396), glyphCount - 2])));
  add('charset format 0 with SID 395', (m) => m.charset.set(u16(395), 1));
  add('charset format 0 with SID 396', (m) => m.charset.set(u16(396), 1));
  add('charset format 0 with SID 396 in a CID font', (m) => {
    m.charset.set(u16(396), 1);
    cid(m, fd3(0, 0, glyphCount));
  });
  add('charset cut short at the table end', (m) => {
    m.blocks = m.blocks.filter(([n]) => n !== 'charset');
    m.blocks.push(['charset', () => m.charset.subarray(0, m.charset.length - 1)]);
  });
  add('custom encoding format 0', (m) => {
    setEntry(m.top, 16, (a) => [...long(a.at('encoding')), 16]);
    setBlock(m, 'encoding', () => [0, 0], 'charset');
  });
  add('supplemental encoding', (m) => {
    setEntry(m.top, 16, (a) => [...long(a.at('encoding')), 16]);
    setBlock(m, 'encoding', () => [0x80, 0, 0], 'charset');
  });
  add('encoding offset past the table', (m) => setEntry(m.top, 16, [...long(1 << 24), 16]));

  add('CharStrings one glyph short of maxp', (m) => m.glyphs.pop());
  add('two CharStrings operators', (m) => m.top.push({ key: 1017, part: (a) => [...long(a.at('charstrings')), 17] }));
  add('Private with 3 operands', (m) => setEntry(m.top, 18, (a) => [139, ...long(a.len('private')), ...long(a.at('private')), 18]));
  add('Private running past the table', (m) => setEntry(m.top, 18, (a) => [...long(1 << 24), ...long(a.at('private')), 18]));
  add('second empty Private', (m) => m.top.push({ key: 1018, part: [139, 139, 18] }));
  add('second Private with its own Subrs', (m) => m.top.push({ key: 1018, part: (a) => [...long(a.len('private')), ...long(a.at('private')), 18] }));

  add('BlueValues of 4', (m) => setEntry(m.priv, 6, dictEntry(6, -5, 16, 456, 5)));
  add('BlueValues of 3', (m) => setEntry(m.priv, 6, dictEntry(6, -5, 16, 456)));
  add('StemSnapH empty', (m) => setEntry(m.priv, ESC + 12, [12, 12]));
  add('StdHW with 2 operands', (m) => setEntry(m.priv, 10, dictEntry(10, 26, 27)));
  add('ForceBold 1', (m) => setEntry(m.priv, ESC + 14, dictEntry(ESC + 14, 1)));
  add('ForceBold 2', (m) => setEntry(m.priv, ESC + 14, dictEntry(ESC + 14, 2)));
  add('Private DICT with a charset operator', (m) => setEntry(m.priv, 15, dictEntry(15, 0)));
  add('Private DICT with vsindex', (m) => setEntry(m.priv, 22, dictEntry(22, 0)));
  add('Subrs offset past the table', (m) => setEntry(m.priv, 19, [...long(1 << 24), 19]));
  add('Subrs offset as a real', (m) => setEntry(m.priv, 19, [30, 0x1f, 19]));
  add('two Subrs in the Top Private DICT', (m) => m.priv.push({ key: 1019, part: (a) => [...long(a.at('subrs') - a.at('private')), 19] }));

  add('CID-keyed with FDSelect format 3', (m) => cid(m, fd3(0, 0, glyphCount)));
  add('CID-keyed with FDSelect format 0', (m) => cid(m, [0, ...Array(glyphCount).fill(0)]));
  add('CID-keyed with FDSelect format 1', (m) => cid(m, [1, ...Array(glyphCount).fill(0)]));
  add('CID-keyed FDSelect naming Font DICT 1 of 1', (m) => cid(m, fd3(0, 0, 50, 1, glyphCount)));
  add('CID-keyed FDSelect naming Font DICT 1 of 2', (m) => cid(m, fd3(0, 0, 50, 1, glyphCount), 2));
  add('CID-keyed FDSelect first range at glyph 1', (m) => cid(m, fd3(1, 0, glyphCount)));
  add('CID-keyed FDSelect with no ranges', (m) => cid(m, [3, 0, 0, ...u16(glyphCount)]));
  add('CID-keyed FDSelect ranges out of order', (m) => cid(m, fd3(0, 0, 50, 0, 50, 0, glyphCount)));
  add('CID-keyed FDSelect sentinel one past the glyphs', (m) => cid(m, fd3(0, 0, glyphCount + 1)));
  add('CID-keyed FDSelect sentinel leaving the last glyph unmapped', (m) => cid(m, fd3(0, 0, glyphCount - 1)));
  add('CID-keyed FDSelect twice', (m) => {
    cid(m, fd3(0, 0, glyphCount));
    m.top.push({ key: 2037, part: (a) => [...long(a.at('fdselect')), 12, 37] });
  });
  add('CID-keyed Font DICT with CharStrings', (m) => {
    cid(m, fd3(0, 0, glyphCount));
    m.fd.push({ key: 17, part: (a) => [...long(a.at('charstrings')), 17] });
  });
  add('CID-keyed with two FDArrays', (m) => {
    cid(m, fd3(0, 0, glyphCount));
    m.top.push({ key: 2036, part: (a) => [...long(a.at('fdarray')), 12, 36] });
  });
  add('CID-keyed Font DICT without Private, Top DICT keeping Private', (m) => {
    cid(m, fd3(0, 0, glyphCount));
    m.fd = [{ key: ESC + 38, part: dictEntry(ESC + 38, 391) }];
    setEntry(m.top, 18, (a) => [...long(a.len('private')), ...long(a.at('private')), 18]);
  });
  add('CID-keyed Font DICT Private without Subrs', (m) => {
    cid(m, fd3(0, 0, glyphCount));
    setEntry(m.priv, 19, null);
  });

  add('glyph without endchar', glyph(-130));
  add('glyph ending in seac-style endchar', glyph(1, 2, 3, 4, 5, 'endchar'));
  add('glyph stacking 48 arguments', glyph(...nums(48), 'endchar'));
  add('glyph stacking 49 arguments', glyph(...nums(49), 'endchar'));
  add('glyph using reserved operator 2', glyph('reserved2', 'endchar'));
  add('glyph using random', glyph('random', 'endchar'));
  add('glyph using roll', glyph(1, 1, 'roll', 'endchar'));
  add('glyph using blend', glyph(1, 'blend', 'endchar'));
  add('glyph with dotsection', glyph('dotsection', 'endchar'));
  add('glyph with dotsection after an argument', glyph(1, 'dotsection', 'endchar'));
  add('glyph drawing before a moveto', glyph(1, 2, 'rlineto', 'endchar'));
  add('glyph drawing after a moveto', glyph(0, 0, 'rmoveto', 1, 2, 'rlineto', 'endchar'));
  add('glyph rlineto with 3 arguments', glyph(0, 0, 'rmoveto', 1, 2, 3, 'rlineto', 'endchar'));
  add('glyph rmoveto with a width', glyph(100, 0, 0, 'rmoveto', 'endchar'));
  add('glyph second rmoveto with 3 arguments', glyph(0, 0, 'rmoveto', 1, 0, 0, 'rmoveto', 'endchar'));
  add('glyph hstem with a width', glyph(100, 0, 10, 'hstem', 'endchar'));
  add('glyph hstem with an odd count after the width', glyph(0, 10, 'hstem', 0, 10, 20, 'hstem', 'endchar'));
  add('glyph with 96 stem hints', glyph(...[0, 0, 0, 0].flatMap(() => [...nums(48), 'hstem']), 'endchar'));
  add('glyph with 97 stem hints', glyph(...[0, 0, 0, 0].flatMap(() => [...nums(48), 'hstem']), 0, 1, 'vstem', 'endchar'));
  add('glyph hintmask after a stem', glyph(0, 10, 'hstem', 'hintmask', [0x80], 'endchar'));
  add('glyph hintmask before any stem', glyph('hintmask', [0x80], 'endchar'));
  add('glyph hintmask whose mask runs off the end', glyph(...nums(48), 'hstem', 0, 10, 'hstem', 'hintmask', [0x80, 0x80, 0x80]));
  add('glyph vhcurveto with 4 arguments', glyph(0, 0, 'rmoveto', 1, 2, 3, 4, 'vhcurveto', 'endchar'));
  add('glyph vhcurveto with 6 arguments', glyph(0, 0, 'rmoveto', 1, 2, 3, 4, 5, 6, 'vhcurveto', 'endchar'));
  add('glyph flex with 13 arguments', glyph(0, 0, 'rmoveto', ...nums(13), 'flex', 'endchar'));
  add('glyph flex with 12 arguments', glyph(0, 0, 'rmoveto', ...nums(12), 'flex', 'endchar'));
  add('glyph dup with 47 arguments', glyph(...nums(47), 'dup', 'endchar'));
  add('glyph dup with 48 arguments', glyph(...nums(48), 'dup', 'endchar'));
  add('glyph add with 1 argument', glyph(1, 'add', 'endchar'));
  add('glyph add with 2 arguments', glyph(1, 2, 'add', 'endchar'));
  add('glyph returning before endchar', glyph('return', 'endchar'));
  add('glyph calling a missing subr', glyph(-107 + 11, 'callsubr', 'endchar'));
  add('glyph calling a missing global subr', glyph(-107, 'callgsubr', 'endchar'));
  add('glyph calling a computed subr number', glyph(-108, 1, 'add', 'callsubr', 'endchar'));
  add('glyph calling a 16.16 subr number', glyph([255, 0xff, 0x95, 0, 0], 'callsubr', 'endchar'));
  add('glyph with a 16.16 argument', glyph([255, 0, 1, 0, 0], 'hmoveto', 'endchar'));
  add('glyph calling subrs nested 10 deep', (m) => (m.glyphs[1] = cs(chain(m, 10), 'callsubr', 'endchar')));
  add('glyph calling subrs nested 11 deep', (m) => (m.glyphs[1] = cs(chain(m, 11), 'callsubr', 'endchar')));
  add('glyph calling a subr that calls itself', (m) => {
    m.subrs.push(cs(m.subrs.length - 107, 'callsubr', 'return'));
    m.glyphs[1] = cs(m.subrs.length - 1 - 107, 'callsubr', 'endchar');
  });
  add('glyph calling a subr without return', (m) => {
    m.subrs.push(cs(1, 2));
    m.glyphs[1] = cs(m.subrs.length - 1 - 107, 'callsubr', 'endchar');
  });
  add('glyph calling a subr that ends the glyph', (m) => {
    m.subrs.push(cs(0, 'hmoveto', 'endchar'));
    m.glyphs[1] = cs(m.subrs.length - 1 - 107, 'callsubr');
  });
  const moves = (n: number) => Array.from({ length: n }, () => [139, 139, 21]).flat();
  add('glyph charstring of 65535 bytes', glyph(moves(21844), 0, 'hmoveto', 'endchar'));
  add('glyph charstring of 65536 bytes', glyph(moves(21845), 'endchar'));

  const lato = sfntTables(ttf);
  const latoGlyphs = new DataView(lato.find((t) => t.tag === 'maxp')!.data.buffer).getUint16(4);
  const latoVersion = new DataView(ttf.buffer, ttf.byteOffset).getUint32(0);
  const garbage = Uint8Array.from({ length: 64 }, (_, i) => (i * 167 + 13) & 255);
  out.push(['sfnt: CFF 64 garbage bytes beside glyf', sfntOf([...lato, { tag: 'CFF ', data: garbage }], latoVersion)]);
  const minimal: Model = { names: [ascii('Lato')], top: [], strings: [], gsubrs: [], charset: new Uint8Array(), glyphs: [], priv: [], subrs: [], fd: [], blocks: [] };
  minimal.glyphs = Array.from({ length: latoGlyphs }, () => cs('endchar'));
  minimal.blocks = [
    ['header', () => [1, 0, 4, 4]],
    ['names', () => index(minimal.names)],
    ['top', (a) => index([[...long(a.at('charstrings')), 17]])],
    ['strings', () => index([])],
    ['gsubrs', () => index([])],
    ['charstrings', () => index(minimal.glyphs)],
  ];
  out.push(['sfnt: CFF minimal and valid beside glyf', sfntOf([...lato, { tag: 'CFF ', data: build(minimal) }], latoVersion)]);
  minimal.glyphs[1] = cs(1, 2, 'rlineto', 'endchar');
  out.push(['sfnt: CFF minimal with one bad glyph beside glyf', sfntOf([...lato, { tag: 'CFF ', data: build(minimal) }], latoVersion)]);
  return out;
}
