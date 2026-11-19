// Font files Dragon reads at build time, judged against Chrome's font sanitizer: for every mutated WOFF and WOFF2 header, table
// directory, block layout and transform version, and every mutated sfnt table directory below, Dragon accepts the file
// (decodeFontFile, then readSfnt) exactly when Chrome loads it (document.fonts.load on a FontFace of its bytes), so native never draws a font the web falls back from, or the reverse.
import { readFileSync } from 'node:fs';
import { brotliCompressSync, deflateSync, inflateSync } from 'node:zlib';
import type { Browser, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeFontFile } from '../../dragon/src/fonts/woff.ts';
import { readSfnt } from '../../dragon/src/fonts/sfnt.ts';
import { launchChrome } from '../src/chrome.ts';
import { NODE_BROTLI } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(new URL(`../../dragon/test/fonts/woff/${name}`, import.meta.url)));
const round4 = (n: number): number => Math.ceil(n / 4) * 4;
const MB128 = 128 * 1024 * 1024;

const dragonAccepts = (bytes: Uint8Array): boolean => {
  const decoded = decodeFontFile(bytes, NODE_BROTLI);
  return decoded.ok && readSfnt(decoded.sfnt).ok;
};

const edit = (b: Uint8Array, f: (d: DataView, out: Uint8Array) => void): Uint8Array => {
  const out = b.slice();
  f(new DataView(out.buffer), out);
  return out;
};

/** The file with n bytes of fill appended and its header length updated. */
const grow = (b: Uint8Array, n: number): Uint8Array => {
  const out = new Uint8Array(b.length + n);
  out.set(b);
  new DataView(out.buffer).setUint32(8, out.length);
  return out;
};

type Table = { readonly tag: string; readonly data: Uint8Array };

function woffTables(b: Uint8Array): Table[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return Array.from({ length: d.getUint16(12) }, (_, i) => {
    const e = 44 + i * 20;
    const [offset, comp, orig] = [d.getUint32(e + 4), d.getUint32(e + 8), d.getUint32(e + 12)];
    const stored = b.slice(offset, offset + comp);
    return { tag: String.fromCharCode(...b.subarray(e, e + 4)), data: comp === orig ? stored : new Uint8Array(inflateSync(stored)) };
  });
}

/** A well-formed WOFF of the tables in directory order, each compressed when that makes it smaller, with totalSfntSize filled in. */
function woffOf(tables: readonly Table[]): Uint8Array {
  const n = tables.length;
  let at = 44 + 20 * n;
  const stored = tables.map((t) => {
    const z = new Uint8Array(deflateSync(t.data));
    return z.length < t.data.length ? z : t.data;
  });
  const offsets = stored.map((s) => {
    const o = at;
    at = round4(at + s.length);
    return o;
  });
  const out = new Uint8Array(at);
  const d = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x46]);
  d.setUint32(4, 0x00010000);
  d.setUint32(8, at);
  d.setUint16(12, n);
  d.setUint32(16, tables.reduce((s, t) => s + round4(t.data.length), 12 + 16 * n));
  tables.forEach((t, i) => {
    const e = 44 + 20 * i;
    for (let k = 0; k < 4; k++) out[e + k] = t.tag.charCodeAt(k);
    d.setUint32(e + 4, offsets[i] as number);
    d.setUint32(e + 8, (stored[i] as Uint8Array).length);
    d.setUint32(e + 12, t.data.length);
    out.set(stored[i] as Uint8Array, offsets[i] as number);
  });
  return out;
}

const entryOf = (b: Uint8Array, tag: string): number => {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < d.getUint16(12); i++) if (String.fromCharCode(...b.subarray(44 + i * 20, 48 + i * 20)) === tag) return 44 + i * 20;
  throw new Error(`no ${tag}`);
};

/** The WOFF with one more table of the given tag (replacing any of that tag) whose zlib stream is corrupt. */
function corruptTable(base: readonly Table[], tag: string): Uint8Array {
  const file = woffOf([...base.filter((t) => t.tag !== tag), { tag, data: new Uint8Array(400).fill(3) }]);
  const e = entryOf(file, tag);
  const d = new DataView(file.buffer);
  file.fill(0xff, d.getUint32(e + 4), d.getUint32(e + 4) + 4);
  return file;
}

/** WOFF2 §4.1 Known Table Tags, by flag index. */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
];

type Woff2Entry = { readonly tag: string; readonly data: Uint8Array; readonly version: number; readonly origLength: number; readonly transformLength: number | null };

/** The directory entries and stream bytes of a WOFF2, in directory order; the offset of each entry's flag byte too. */
function woff2Entries(b: Uint8Array): (Woff2Entry & { readonly flagAt: number })[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 48;
  const base128 = (): number => {
    let v = 0;
    for (;;) {
      const x = b[p++] as number;
      v = v * 128 + (x & 0x7f);
      if ((x & 0x80) === 0) return v;
    }
  };
  const entries = Array.from({ length: d.getUint16(12) }, () => {
    const flagAt = p;
    const flags = b[p++] as number;
    const explicit = (flags & 0x3f) === 0x3f;
    const tag = explicit ? String.fromCharCode(...b.subarray(p, p + 4)) : (KNOWN_TAGS[flags & 0x3f] as string);
    if (explicit) p += 4;
    const version = flags >> 6;
    const origLength = base128();
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    return { flagAt, tag, version, origLength, transformLength: transformed ? base128() : null };
  });
  const stream = new Uint8Array(NODE_BROTLI(b.subarray(p, p + d.getUint32(20)), entries.reduce((n, e) => n + (e.transformLength ?? e.origLength), 0)));
  let at = 0;
  return entries.map((e) => {
    const n = e.transformLength ?? e.origLength;
    at += n;
    return { ...e, data: stream.subarray(at - n, at) };
  });
}

/** A WOFF2 of the entries, its padding filled with pad and totalSfntSize the sfnt the tables make (at least the file length). */
function woff2Of(entries: readonly Woff2Entry[], pad = 0): Uint8Array {
  const base128 = (v: number): number[] => {
    const out = [v & 0x7f];
    for (v = Math.floor(v / 128); v > 0; v = Math.floor(v / 128)) out.unshift((v & 0x7f) | 0x80);
    return out;
  };
  const dir: number[] = [];
  for (const e of entries) {
    const known = KNOWN_TAGS.indexOf(e.tag);
    dir.push((known < 0 ? 0x3f : known) | (e.version << 6));
    if (known < 0) dir.push(...[...e.tag].map((c) => c.charCodeAt(0)));
    dir.push(...base128(e.origLength));
    if (e.transformLength !== null) dir.push(...base128(e.transformLength));
  }
  const stream = new Uint8Array(brotliCompressSync(Buffer.concat(entries.map((e) => e.data))));
  const end = 48 + dir.length + stream.length;
  const out = new Uint8Array(round4(end)).fill(pad);
  out.fill(0, 0, end);
  const d = new DataView(out.buffer);
  out.set([0x77, 0x4f, 0x46, 0x32]);
  d.setUint32(4, 0x00010000);
  d.setUint32(8, out.length);
  d.setUint16(12, entries.length);
  d.setUint32(16, Math.max(out.length, entries.reduce((n, e) => n + round4(e.origLength), 12 + 16 * entries.length)));
  d.setUint32(20, stream.length);
  out.set(dir, 48);
  out.set(stream, 48 + dir.length);
  return out;
}

const plain = (e: Woff2Entry): Woff2Entry => e;

function cases(): [string, Uint8Array][] {
  const woff = fixture('Lato-Regular.woff');
  const d = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  const n = d.getUint16(12);
  const entries = Array.from({ length: n }, (_, i) => 44 + i * 20).map((at) => ({ at, offset: d.getUint32(at + 4), comp: d.getUint32(at + 8), orig: d.getUint32(at + 12) }));
  const byOffset = [...entries].sort((a, b) => a.offset - b.offset);
  const stored = entries.find((e) => e.comp === e.orig) as (typeof entries)[number];
  const base = woffTables(woff);
  const rebuilt = woffOf(base);
  const withBlock = (at: number, offset: (len: number) => number, size: number, extra: number): Uint8Array => {
    const out = grow(rebuilt, extra);
    const v = new DataView(out.buffer);
    v.setUint32(at, offset(rebuilt.length));
    v.setUint32(at + 4, size);
    return out;
  };
  // One table, inserted 4 bytes after where it was, moves every table at or after it.
  const gapAt = (p: number): Uint8Array => {
    const out = new Uint8Array(woff.length + 4);
    out.set(woff.subarray(0, p));
    out.set(woff.subarray(p), p + 4);
    const v = new DataView(out.buffer);
    v.setUint32(8, out.length);
    for (const e of entries) if (e.offset >= p) v.setUint32(e.at + 4, e.offset + 4);
    return out;
  };
  const sumCompressed = base.reduce((s, t) => s + (new Uint8Array(deflateSync(t.data)).length < t.data.length ? t.data.length : 0), 0);
  const out: [string, Uint8Array][] = [
    ['WOFF: the file as fontTools wrote it', woff],
    ['WOFF: rebuilt with tables in data order', rebuilt],
    ['WOFF: totalSfntSize 4 more than its tables make', edit(woff, (v) => v.setUint32(16, v.getUint32(16) + 4))],
    ['WOFF: totalSfntSize 4 less than its tables make', edit(woff, (v) => v.setUint32(16, v.getUint32(16) - 4))],
    ['WOFF: reserved field 1', edit(woff, (v) => v.setUint16(14, 1))],
    ['WOFF: numTables 0', edit(woff, (v) => v.setUint16(12, 0))],
    ['WOFF: majorVersion 9', edit(woff, (v) => v.setUint16(20, 9))],
    ['WOFF: every table checksum 0', edit(woff, (v) => entries.forEach((e) => v.setUint32(e.at + 16, 0)))],
    ['WOFF: flavor true', edit(woff, (v) => v.setUint32(4, 0x74727565))],
    ['WOFF: flavor OTTO over TrueType tables', edit(woff, (v) => v.setUint32(4, 0x4f54544f))],
    ['WOFF: an unknown flavor', edit(woff, (v) => v.setUint32(4, 0x12345678))],
    ['WOFF: header length 4 more than the file', edit(woff, (v) => v.setUint32(8, woff.length + 4))],
    ['WOFF: 4 zero bytes after the last table', grow(woff, 4)],
    ['WOFF: 2 zero bytes after the last table', grow(woff, 2)],
    ['WOFF: the last table unpadded at the end of the file', (() => {
      const last = byOffset[byOffset.length - 1] as (typeof entries)[number];
      const cut = woff.slice(0, last.offset + last.comp);
      new DataView(cut.buffer).setUint32(8, cut.length);
      return cut;
    })()],
    ['WOFF: directory entries out of tag order', edit(woff, (_, o) => {
      const first = o.slice(44, 64);
      o.copyWithin(44, 64, 84);
      o.set(first, 64);
    })],
    ['WOFF: a stored table with origLength 4 more', edit(woff, (v) => v.setUint32(stored.at + 12, stored.orig + 4))],
    ['WOFF: a stored table with compLength 0', edit(woff, (v) => v.setUint32(stored.at + 8, 0))],
    ['WOFF: compLength greater than origLength', edit(woff, (v) => v.setUint32(stored.at + 8, stored.orig + 4))],
    ['WOFF: an empty gasp table', woffOf(base.map((t) => (t.tag === 'gasp' ? { tag: 'gasp', data: new Uint8Array(0) } : t)))],
    ['WOFF: the first table at offset 44, inside the directory', edit(woff, (v) => v.setUint32((byOffset[0] as (typeof entries)[number]).at + 4, 44))],
    ['WOFF: 4 bytes between the directory and the first table', gapAt((byOffset[0] as (typeof entries)[number]).offset)],
    ['WOFF: 4 bytes between two tables', gapAt((byOffset[3] as (typeof entries)[number]).offset)],
    ['WOFF: a table 2 bytes off its 4-byte boundary', edit(woff, (v) => v.setUint32((byOffset[3] as (typeof entries)[number]).at + 4, (byOffset[3] as (typeof entries)[number]).offset + 2))],
    ['WOFF: a second table at the first one\'s offset', edit(woff, (v) => v.setUint32((byOffset[1] as (typeof entries)[number]).at + 4, (byOffset[0] as (typeof entries)[number]).offset))],
    ['WOFF: an unknown table overlapping gasp', (() => {
      const file = woffOf([...base, { tag: 'zzzz', data: new Uint8Array(8).fill(1) }]);
      const v = new DataView(file.buffer);
      const gasp = entryOf(file, 'gasp');
      const z = entryOf(file, 'zzzz');
      v.setUint32(z + 4, v.getUint32(gasp + 4));
      v.setUint32(z + 8, v.getUint32(gasp + 8));
      v.setUint32(z + 12, v.getUint32(gasp + 12));
      return file;
    })()],
    ['WOFF: OS/2 renamed maxp, so maxp is listed twice and OS/2 is missing', edit(woff, (_, o) => o.set(o.subarray(entryOf(woff, 'maxp'), entryOf(woff, 'maxp') + 4), entryOf(woff, 'OS/2')))],
    ['WOFF: gasp listed twice with the same bytes', woffOf([...base, base.find((t) => t.tag === 'gasp') as Table])],
    ['WOFF: an unknown table listed twice', woffOf([...base, { tag: 'zzzz', data: new Uint8Array(40).fill(7) }, { tag: 'zzzz', data: new Uint8Array(40).fill(8) }])],
    ['WOFF: head listed twice, the first copy corrupt', woffOf([{ tag: 'head', data: (base.find((t) => t.tag === 'head') as Table).data.slice().fill(0xee, 12, 16) }, ...base])],
    ['WOFF: head listed twice, the last copy corrupt', woffOf([...base, { tag: 'head', data: (base.find((t) => t.tag === 'head') as Table).data.slice().fill(0xee, 12, 16) }])],
    ['WOFF: an unknown table whose origLength is 4 more than it inflates to', (() => {
      const file = woffOf([...base, { tag: 'zzzz', data: new Uint8Array(400).fill(3) }]);
      const v = new DataView(file.buffer);
      v.setUint32(entryOf(file, 'zzzz') + 12, 404);
      v.setUint32(16, v.getUint32(16) + 4);
      return file;
    })()],
    ['WOFF: the metadata offset 0 with a length', edit(woff, (v) => v.setUint32(28, 8))],
    ['WOFF: the private data offset 0 with a length', edit(woff, (v) => v.setUint32(40, 8))],
    ['WOFF: a metadata block past the end of the file', edit(woff, (v) => {
      v.setUint32(24, woff.length + 4);
      v.setUint32(28, 4);
    })],
    ['WOFF: a metadata block right after the tables', withBlock(24, (len) => len, 8, 8)],
    ['WOFF: a metadata block 4 bytes after the tables', withBlock(24, (len) => len + 4, 8, 12)],
    ['WOFF: a 5-byte metadata block ending the file unpadded', withBlock(24, (len) => len, 5, 5)],
    ['WOFF: a private block right after the tables, no metadata', withBlock(36, (len) => len, 8, 8)],
    ['WOFF: a metadata block of length 0 at the end of the file', edit(rebuilt, (v) => v.setUint32(24, rebuilt.length))],
    ['WOFF: a metadata block over the last table', edit(rebuilt, (v) => {
      v.setUint32(24, rebuilt.length - 4);
      v.setUint32(28, 4);
    })],
    ['WOFF: compressed tables inflating to exactly 128 MiB', woffOf([...base, { tag: 'zzzz', data: new Uint8Array(MB128 - sumCompressed) }])],
    ['WOFF: compressed tables inflating to 128 MiB and 1 byte', woffOf([...base, { tag: 'zzzz', data: new Uint8Array(MB128 - sumCompressed + 1) }])],
  ];
  for (const tag of [...new Set([...KNOWN_TAGS, 'CFF2', 'DSIG', 'HVAR', 'MVAR', 'VVAR', 'STAT', 'meta', 'ltag', 'kerx', 'ankr', 'FFTM', 'zzzz'])]) {
    out.push([`WOFF: a ${JSON.stringify(tag)} table whose zlib stream is corrupt`, corruptTable(base, tag)]);
  }
  for (const tag of ['GPOS', 'OS/2', 'cmap', 'name', 'post', 'glyf', 'loca', 'prep']) out.push([`WOFF: no ${tag} table`, woffOf(base.filter((t) => t.tag !== tag))]);

  const w2 = fixture('Lato-Regular.woff2');
  const hmtx = fixture('Lato-Regular.hmtx.woff2');
  const nul = fixture('Lato-Regular.subset.untransformed.woff2');
  const versioned = (file: Uint8Array, versions: Readonly<Record<string, number>>): Uint8Array => {
    const out = file.slice();
    for (const e of woff2Entries(file)) if (versions[e.tag] !== undefined) out[e.flagAt] = ((out[e.flagAt] as number) & 0x3f) | ((versions[e.tag] as number) << 6);
    return out;
  };
  const nulEntries = woff2Entries(nul).map(({ flagAt: _, ...e }) => plain(e));
  const w2Entries = woff2Entries(w2).map(({ flagAt: _, ...e }) => plain(e));
  const swapped = (entries: readonly Woff2Entry[], a: string, b: string): Woff2Entry[] =>
    entries.map((e) => (e.tag === a ? (entries.find((x) => x.tag === b) as Woff2Entry) : e.tag === b ? (entries.find((x) => x.tag === a) as Woff2Entry) : e));
  const nulHmtx = nulEntries.find((e) => e.tag === 'hmtx') as Woff2Entry;
  const hhea = nulEntries.find((e) => e.tag === 'hhea') as Woff2Entry;
  const metrics = new DataView(hhea.data.buffer, hhea.data.byteOffset).getUint16(34);
  const advancesOnly = new Uint8Array(1 + 2 * metrics);
  advancesOnly[0] = 3;
  for (let g = 0; g < metrics; g++) advancesOnly.set(nulHmtx.data.subarray(4 * g, 4 * g + 2), 1 + 2 * g);
  out.push(
    ['WOFF2: the file as fontTools wrote it', w2],
    ['WOFF2: totalSfntSize 1 less than the file length', edit(w2, (v) => v.setUint32(16, w2.length - 1))],
    ['WOFF2: totalSfntSize the file length', edit(w2, (v) => v.setUint32(16, w2.length))],
    ['WOFF2: totalSfntSize 4 less than fontTools wrote', edit(w2, (v) => v.setUint32(16, v.getUint32(16) - 4))],
    ['WOFF2: totalSfntSize 128 MiB', edit(w2, (v) => v.setUint32(16, MB128))],
    ['WOFF2: totalSfntSize 128 MiB and 1 byte', edit(w2, (v) => v.setUint32(16, MB128 + 1))],
    ['WOFF2: totalSfntSize 2^32 - 1', edit(w2, (v) => v.setUint32(16, 0xffffffff))],
    ['WOFF2: reserved field 1', edit(w2, (v) => v.setUint16(14, 1))],
    ['WOFF2: numTables 0', edit(w2, (v) => v.setUint16(12, 0))],
    ['WOFF2: majorVersion 9', edit(w2, (v) => v.setUint16(24, 9))],
    ['WOFF2: flavor true', edit(w2, (v) => v.setUint32(4, 0x74727565))],
    ['WOFF2: an unknown flavor', edit(w2, (v) => v.setUint32(4, 0x12345678))],
    ['WOFF2: totalCompressedSize 1 more', edit(w2, (v) => v.setUint32(20, v.getUint32(20) + 1))],
    ['WOFF2: totalCompressedSize 1 less', edit(w2, (v) => v.setUint32(20, v.getUint32(20) - 1))],
    ['WOFF2: 4 bytes after the font data', grow(w2, 4)],
    ['WOFF2: the metadata offset 0 with a length', edit(w2, (v) => v.setUint32(32, 8))],
    ['WOFF2: the private data offset 0 with a length', edit(w2, (v) => v.setUint32(44, 8))],
    ['WOFF2: hmtx transformed (version 1)', hmtx],
    ['WOFF2: hmtx transformed at version 2', versioned(hmtx, { hmtx: 2 })],
    ['WOFF2: hmtx transformed at version 3', versioned(hmtx, { hmtx: 3 })],
    ['WOFF2: glyf and loca null-transformed (version 3)', nul],
    ['WOFF2: glyf and loca at version 1', versioned(nul, { glyf: 1, loca: 1 })],
    ['WOFF2: glyf and loca at version 2', versioned(nul, { glyf: 2, loca: 2 })],
    ['WOFF2: glyf at version 3, loca at version 1', versioned(nul, { loca: 1 })],
    ['WOFF2: rebuilt from its tables', woff2Of(nulEntries)],
    ['WOFF2: null-transformed loca before glyf in the directory', woff2Of(swapped(nulEntries, 'glyf', 'loca'))],
    ['WOFF2: transformed glyf, rebuilt from its tables', woff2Of(w2Entries)],
    ['WOFF2: transformed loca before glyf in the directory', woff2Of(swapped(w2Entries, 'glyf', 'loca'))],
    ['WOFF2: hmtx transformed over a null-transformed glyf', woff2Of(nulEntries.map((e) => (e.tag === 'hmtx' ? { ...e, version: 1, data: advancesOnly, transformLength: advancesOnly.length } : e)))],
    ['WOFF2: cmap at transform version 1', woff2Of(nulEntries.map((e) => (e.tag === 'cmap' ? { ...e, version: 1, transformLength: e.data.length } : e)))],
    ['WOFF2: an unknown table at transform version 1', woff2Of([...nulEntries, { tag: 'zzzz', data: new Uint8Array(8), version: 1, origLength: 8, transformLength: 8 }])],
    ['WOFF2: an unknown table listed twice', woff2Of([...nulEntries, { tag: 'zzzz', data: new Uint8Array(8), version: 0, origLength: 8, transformLength: null }, { tag: 'zzzz', data: new Uint8Array(8).fill(1), version: 0, origLength: 8, transformLength: null }])],
    ['WOFF2: an empty unknown table', woff2Of([...nulEntries, { tag: 'zzzz', data: new Uint8Array(0), version: 0, origLength: 0, transformLength: null }])],
  );
  const ttf = new Uint8Array(readFileSync(repoPath('vendor/fonts/Lato/Lato-Regular.ttf')));
  const td = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const records = Array.from({ length: td.getUint16(4) }, (_, i) => 12 + i * 16).map((at) => ({ at, tag: String.fromCharCode(...ttf.subarray(at, at + 4)), offset: td.getUint32(at + 8), length: td.getUint32(at + 12) }));
  const rec = (tag: string): (typeof records)[number] => records.find((r) => r.tag === tag) as (typeof records)[number];
  const firstTable = records.reduce((a, r) => (r.offset < a.offset ? r : a));
  const lastTable = records.reduce((a, r) => (r.offset > a.offset ? r : a));
  out.push(
    ['sfnt: Lato Regular as vendored', ttf],
    ['sfnt: a table 2 bytes off its 4-byte boundary', edit(ttf, (v) => v.setUint32(rec('gasp').at + 8, rec('gasp').offset + 2))],
    ['sfnt: a table inside the directory', edit(ttf, (v) => v.setUint32(firstTable.at + 8, 12))],
    ['sfnt: an empty gasp table', edit(ttf, (v) => v.setUint32(rec('gasp').at + 12, 0))],
    ['sfnt: the last table 4 bytes past the end of the file', edit(ttf, (v) => v.setUint32(lastTable.at + 12, ttf.length - lastTable.offset + 4))],
    ['sfnt: gasp over the start of another table', edit(ttf, (v) => v.setUint32(rec('gasp').at + 8, rec('post').offset))],
    ['sfnt: gasp renamed zzzz, an unknown table', edit(ttf, (_, o) => o.set([0x7a, 0x7a, 0x7a, 0x7a], rec('gasp').at))],
    ['sfnt: OS/2 renamed maxp, so maxp is listed twice and OS/2 is missing', edit(ttf, (_, o) => o.set(o.subarray(rec('maxp').at, rec('maxp').at + 4), rec('OS/2').at))],
    ['sfnt: every table checksum 0', edit(ttf, (v) => records.forEach((r) => v.setUint32(r.at + 4, 0)))],
    ['sfnt: 4 bytes after the last table', (() => {
      const longer = new Uint8Array(ttf.length + 4);
      longer.set(ttf);
      return longer;
    })()],
  );
  for (let k = 1; k <= 4; k++) out.push([`WOFF2: ${k} more stream bytes, the padding after them not zero`, woff2Of([...nulEntries, { tag: 'zzzz', data: new Uint8Array(k).fill(5), version: 0, origLength: k, transformLength: null }], 0x55)]);
  return out;
}

describe('Dragon accepts a font file exactly when Chrome loads it', () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => {
    browser = await launchChrome();
    page = await browser.newPage();
    await page.setContent('<!DOCTYPE html><html><body></body></html>');
  }, 120_000);
  afterAll(async () => {
    await browser?.close();
  });

  it('on every mutation, both ways, and each verdict occurs', async () => {
    const all = cases();
    const results: { name: string; chrome: boolean; dragon: boolean }[] = [];
    for (const [name, bytes] of all) {
      const chrome = await page.evaluate(async (b64) => {
        const raw = atob(b64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const family = `probe-${document.fonts.size}`;
        const face = new FontFace(family, bytes.buffer);
        document.fonts.add(face);
        await document.fonts.load(`16px "${family}"`).catch(() => []);
        await face.loaded.catch(() => null);
        return face.status === 'loaded';
      }, Buffer.from(bytes).toString('base64'));
      results.push({ name, chrome, dragon: dragonAccepts(bytes) });
    }
    expect(results.filter((r) => r.chrome !== r.dragon).map((r) => `${r.name}: Chrome ${r.chrome ? 'loads' : 'refuses'} it, Dragon ${r.dragon ? 'accepts' : 'refuses'} it`)).toEqual([]);
    expect(results.length).toBe(all.length);
    expect(results.some((r) => r.chrome)).toBe(true);
    expect(results.some((r) => !r.chrome)).toBe(true);
  }, 300_000);
});
