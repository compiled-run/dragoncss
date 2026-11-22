// Fonts that each sit just on one side of one table-content rule of Chrome's font sanitizer (OTS) or of the typeface Chrome then
// makes, built from Lato Regular; woff-sanitizer.test.ts checks Dragon accepts each exactly when Chrome loads it.

export type Table = { readonly tag: string; readonly data: Uint8Array };
export type Field = [1 | 2 | 3 | 4, number];
export type Case = [string, Uint8Array];

export const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** Big-endian fields of 1 to 4 bytes. */
export function fields(spec: readonly Field[]): Uint8Array {
  const out = new Uint8Array(spec.reduce((s, [w]) => s + w, 0));
  const d = view(out);
  let p = 0;
  for (const [w, v] of spec) {
    if (w === 1) d.setUint8(p, v & 0xff);
    else if (w === 2) d.setUint16(p, v & 0xffff);
    else if (w === 3) {
      d.setUint8(p, (v >>> 16) & 0xff);
      d.setUint16(p + 1, v & 0xffff);
    } else d.setUint32(p, v >>> 0);
    p += w;
  }
  return out;
}

export function cat(...parts: readonly ArrayLike<number>[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, b) => s + b.length, 0));
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

export function sfntTables(b: Uint8Array): Table[] {
  const d = view(b);
  return Array.from({ length: d.getUint16(4) }, (_, i) => {
    const at = 12 + i * 16;
    const offset = d.getUint32(at + 8);
    return { tag: String.fromCharCode(...b.subarray(at, at + 4)), data: b.slice(offset, offset + d.getUint32(at + 12)) };
  });
}

/** A well-formed sfnt of the tables in directory order, each 4-byte aligned. */
export function sfntOf(tables: readonly Table[], version = 0x00010000): Uint8Array {
  const pad = (n: number): number => Math.ceil(n / 4) * 4;
  let at = 12 + 16 * tables.length;
  const offsets = tables.map((t) => {
    const o = at;
    at = pad(at + t.data.length);
    return o;
  });
  const out = new Uint8Array(at);
  const d = view(out);
  d.setUint32(0, version);
  d.setUint16(4, tables.length);
  tables.forEach((t, i) => {
    const e = 12 + 16 * i;
    for (let k = 0; k < 4; k++) out[e + k] = t.tag.charCodeAt(k);
    d.setUint32(e + 8, offsets[i] as number);
    d.setUint32(e + 12, t.data.length);
    out.set(t.data, offsets[i] as number);
  });
  return out;
}

export const tableOf = (tables: readonly Table[], tag: string): Uint8Array => (tables.find((t) => t.tag === tag) as Table).data;

/** The tables with these in place of the tables of their tags, and added after them when the tag is new. */
export const replaced = (tables: readonly Table[], ...extra: readonly Table[]): Table[] => [
  ...tables.map((t) => extra.find((e) => e.tag === t.tag) ?? t),
  ...extra.filter((e) => !tables.some((t) => t.tag === e.tag)),
];

/** A copy of one table, edited in place or replaced by what f returns. */
export function edited(tables: readonly Table[], tag: string, f: (d: DataView, b: Uint8Array) => Uint8Array | void): Table[] {
  return tables.map((t) => {
    if (t.tag !== tag) return t;
    const b = t.data.slice();
    return { tag, data: f(view(b), b) ?? b };
  });
}

const resized = (b: Uint8Array, length: number): Uint8Array => {
  const out = new Uint8Array(length);
  out.set(b.subarray(0, length));
  return out;
};

/** head, maxp, hhea, hmtx, loca, OS/2, post and name. */
function metricsCases(lato: readonly Table[], subset: readonly Table[]): Case[] {
  const out: Case[] = [];
  const add = (name: string, tag: string, f: (d: DataView, b: Uint8Array) => Uint8Array | void): void => {
    out.push([`sfnt: ${tag} ${name}`, sfntOf(edited(lato, tag, f))]);
  };
  const numGlyphs = view(tableOf(lato, 'maxp')).getUint16(4);
  add('version 1.5', 'head', (d) => d.setUint32(0, 0x00018000));
  add('version 2.0', 'head', (d) => d.setUint32(0, 0x00020000));
  add('magicNumber off by one', 'head', (d) => d.setUint32(12, 0x5f0f3cf4));
  add('flags 0xFFFF', 'head', (d) => d.setUint16(16, 0xffff));
  for (const upem of [15, 16, 16384, 16385]) add(`unitsPerEm ${upem}`, 'head', (d) => d.setUint16(18, upem));
  add('xMin equal to xMax', 'head', (d) => d.setInt16(36, d.getInt16(40)));
  add('xMin above xMax', 'head', (d) => d.setInt16(36, d.getInt16(40) + 1));
  add('yMin above yMax', 'head', (d) => d.setInt16(38, d.getInt16(42) + 1));
  for (const format of [-1, 1, 2]) add(`indexToLocFormat ${format}`, 'head', (d) => d.setInt16(50, format));
  add('glyphDataFormat 1', 'head', (d) => d.setInt16(52, 1));
  add('53 bytes long', 'head', (_, b) => b.slice(0, 53));
  add('56 bytes long', 'head', (_, b) => resized(b, 56));
  add('version 0.5, 32 bytes long', 'maxp', (d) => d.setUint32(0, 0x00005000));
  add('version 0.5, 6 bytes long', 'maxp', (d, b) => {
    d.setUint32(0, 0x00005000);
    return b.slice(0, 6);
  });
  add('version 1.5', 'maxp', (d) => d.setUint32(0, 0x00018000));
  add('version 2.0', 'maxp', (d) => d.setUint32(0, 0x00020000));
  add('version 1.0, 31 bytes long', 'maxp', (_, b) => b.slice(0, 31));
  add('numGlyphs 0', 'maxp', (d) => d.setUint16(4, 0));
  for (const zones of [0, 3, 4]) add(`maxZones ${zones}`, 'maxp', (d) => d.setUint16(14, zones));
  add('version 1.5', 'hhea', (d) => d.setUint32(0, 0x00018000));
  add('version 2.0', 'hhea', (d) => d.setUint32(0, 0x00020000));
  add('metricDataFormat 1', 'hhea', (d) => d.setInt16(32, 1));
  add('numberOfHMetrics 0', 'hhea', (d) => d.setUint16(34, 0));
  add('numberOfHMetrics numGlyphs + 1', 'hhea', (d) => d.setUint16(34, numGlyphs + 1));
  add('35 bytes long', 'hhea', (_, b) => b.slice(0, 35));
  add('ascender negative', 'hhea', (d) => d.setInt16(4, -5));
  const hmtx = tableOf(lato, 'hmtx').length;
  add('2 bytes short', 'hmtx', (_, b) => b.slice(0, hmtx - 2));
  add('2 bytes long', 'hmtx', (_, b) => resized(b, hmtx + 2));
  const oneMetric = (length: number): Uint8Array => sfntOf(edited(edited(lato, 'hhea', (d) => d.setUint16(34, 1)), 'hmtx', (_, b) => b.slice(0, length)));
  out.push(['sfnt: hmtx of 1 metric and side bearings to numGlyphs', oneMetric(4 + 2 * (numGlyphs - 1))], ['sfnt: hmtx of 1 metric, 1 byte short', oneMetric(4 + 2 * (numGlyphs - 1) - 1)]);
  const loca = tableOf(lato, 'loca').length;
  add('2 bytes short', 'loca', (_, b) => b.slice(0, loca - 2));
  add('4 bytes long', 'loca', (_, b) => resized(b, loca + 4));
  add('second offset below the first', 'loca', (d) => d.setUint16(2, d.getUint16(4) + 1));
  for (const v of [5, 6]) add(`version ${v}`, 'OS/2', (d) => d.setUint16(0, v));
  for (const [v, length] of [[0, 77], [0, 78], [1, 83], [1, 84], [1, 85], [1, 86], [2, 95], [5, 96], [5, 99], [5, 100]] as const) {
    add(`version ${v}, ${length} bytes long`, 'OS/2', (d, b) => {
      d.setUint16(0, v);
      return resized(b, length);
    });
  }
  add('usWeightClass 0', 'OS/2', (d) => d.setUint16(4, 0));
  for (const v of [0x00010000, 0x00020000, 0x00025000, 0x00030000, 0x00040000]) add(`version 0x${v.toString(16)} over a 32-byte table`, 'post', (d) => d.setUint32(0, v));
  add('31 bytes long', 'post', (_, b) => b.slice(0, 31));
  const postV2 = (glyphs: number, index: (g: number) => number, names: readonly (readonly number[])[]): Uint8Array =>
    cat(fields([[4, 0x00020000], [4, 0], [4, 0], [4, 0], [4, 0], [4, 0], [4, 0], [4, 0], [2, glyphs]]), fields(Array.from({ length: glyphs }, (_, g): Field => [2, index(g)])), ...names.map((n) => [n.length, ...n]));
  const post = (name: string, data: Uint8Array, tables = lato): number => out.push([`sfnt: post ${name}`, sfntOf(replaced(tables, { tag: 'post', data }))]);
  post('version 2, standard names only', postV2(numGlyphs, (g) => g % 258, []));
  post('version 2, index 258 and one name', postV2(numGlyphs, (g) => (g === 5 ? 258 : 0), [[97, 98]]));
  post('version 2, index 259 and one name', postV2(numGlyphs, (g) => (g === 5 ? 259 : 0), [[97, 98]]));
  post('version 2, a name with a NUL byte', postV2(numGlyphs, (g) => (g === 5 ? 258 : 0), [[97, 0]]));
  post('version 2, a name running past the end', postV2(numGlyphs, () => 0, [[97, 98]]).slice(0, -1));
  post('version 2, names no glyph refers to', postV2(numGlyphs, () => 0, [[97], [98]]));
  post('version 2, numGlyphs 0 in a font of more than 258 glyphs', postV2(0, () => 0, []));
  post('version 2, numGlyphs 0 in a font of 9 glyphs', postV2(0, () => 0, []), subset);
  post('version 2, numGlyphs 1 less than maxp', postV2(numGlyphs - 1, () => 0, []));
  post('version 2, glyph name indexes cut short', postV2(numGlyphs, () => 0, []).slice(0, 34 + 2 * numGlyphs - 2));
  const family = [...'Probe'].flatMap((c) => [0, c.charCodeAt(0)]);
  const nameTable = (format: number, records: readonly (readonly number[])[], strings: readonly number[], o: { stringOffset?: number; tags?: readonly [number, number][] } = {}): Uint8Array => {
    const recs = fields(records.flatMap((r) => r.map((v): Field => [2, v])));
    const tags = format === 1 ? fields([[2, o.tags?.length ?? 0], ...(o.tags ?? []).flatMap(([l, at]): Field[] => [[2, l], [2, at]])]) : new Uint8Array(0);
    return cat(fields([[2, format], [2, records.length], [2, o.stringOffset ?? 6 + recs.length + tags.length]]), recs, tags, strings);
  };
  const familyRecord = [3, 1, 0x409, 1, family.length, 0];
  const name = (label: string, data: Uint8Array): number => out.push([`sfnt: name ${label}`, sfntOf(replaced(lato, { tag: 'name', data }))]);
  name('of one record', nameTable(0, [familyRecord], family));
  name('format 2', nameTable(2, [familyRecord], family));
  name('format 1, no language tags', nameTable(1, [familyRecord], family, { tags: [] }));
  name('format 1, a language tag past the end', nameTable(1, [familyRecord], family, { tags: [[4, family.length]] }));
  name('format 1, a 200-byte language tag', nameTable(1, [familyRecord], [...family, ...Array<number>(200).fill(65)], { tags: [[200, family.length]] }));
  name('format 1, a 202-byte language tag', nameTable(1, [familyRecord], [...family, ...Array<number>(202).fill(65)], { tags: [[202, family.length]] }));
  name('stringOffset past the end', nameTable(0, [familyRecord], family, { stringOffset: 1000 }));
  name('stringOffset inside the records', nameTable(0, [familyRecord, [3, 1, 0x409, 2, family.length, 0]], family, { stringOffset: 10 }));
  name('records cut short', nameTable(0, [familyRecord, [3, 1, 0x409, 2, family.length, 0]], family, { stringOffset: 30 }).slice(0, 24));
  name('a family name past the end', nameTable(0, [[3, 1, 0x409, 1, 100, 0]], family));
  name('a PostScript name past the end', nameTable(0, [[3, 1, 0x409, 6, 100, 0]], family));
  name('of an unknown platform', nameTable(0, [[7, 1, 0x409, 1, family.length, 0]], family));
  name('of no records', nameTable(0, [], []));
  name('5 bytes long', nameTable(0, [], []).slice(0, 5));
  return out;
}

/** cmap: the header, records, subtable bounds and overlap, each subtable format OTS checks, and which subtables it keeps. */
function cmapCases(font: readonly Table[]): Case[] {
  const lato = tableOf(font, 'cmap');
  const sfnt = (cmap: Uint8Array): Uint8Array => sfntOf(replaced(font, { tag: 'cmap', data: cmap }));
  const edit = (f: (d: DataView, b: Uint8Array) => void): Uint8Array => {
    const b = lato.slice();
    f(view(b), b);
    return b;
  };

  /** A cmap whose subtables follow the records in order; a record may name another record's subtable (same object) or a raw offset. */
  type Rec = [number, number, Uint8Array | number];
  const cmap = (recs: Rec[], version = 0): Uint8Array => {
    const head = 4 + 8 * recs.length;
    const placed = new Map<Uint8Array, number>();
    const body: Uint8Array[] = [];
    let at = head;
    for (const [, , s] of recs) if (typeof s !== 'number' && !placed.has(s)) (placed.set(s, at), body.push(s), (at += s.length));
    const hdr = fields([[2, version], [2, recs.length], ...recs.flatMap(([p, e, s]): Field[] => [[2, p], [2, e], [4, typeof s === 'number' ? s : placed.get(s)!]])]);
    return cat(hdr, ...body);
  };

  type Seg = { start: number; end: number; delta?: number; ro?: number };
  type F4 = { lang?: number; segX2?: number; search?: number; selector?: number; shift?: number; pad?: number; glyphs?: number[]; length?: number | undefined };
  const f4 = (segs: Seg[], o: F4 = {}): Uint8Array => {
    const n = segs.length;
    let log2 = 0;
    while (1 << (log2 + 1) <= n) log2++;
    const search = o.search ?? 2 << log2;
    const body: Field[] = [
      [2, o.segX2 ?? 2 * n], [2, search], [2, o.selector ?? log2], [2, o.shift ?? 2 * n - search],
      ...segs.map((s): Field => [2, s.end]), [2, o.pad ?? 0],
      ...segs.map((s): Field => [2, s.start]), ...segs.map((s): Field => [2, s.delta ?? 0]), ...segs.map((s): Field => [2, s.ro ?? 0]),
      ...(o.glyphs ?? []).map((g): Field => [2, g]),
    ];
    const len = 6 + body.reduce((s, [w]) => s + w, 0);
    return fields([[2, 4], [2, o.length ?? len], [2, o.lang ?? 0], ...body]);
  };
  const ffff: Seg = { start: 0xffff, end: 0xffff, delta: 1 };
  const bmp = f4([{ start: 0x41, end: 0x5a, delta: 1 - 0x41 }, ffff]);
  const groups = (format: 12 | 13, gs: [number, number, number][], o: { lang?: number; count?: number } = {}) =>
    fields([[2, format], [2, 0], [4, 16 + 12 * gs.length], [4, o.lang ?? 0], [4, o.count ?? gs.length], ...gs.flatMap(([a, b, g]): Field[] => [[4, a], [4, b], [4, g]])]);
  type Vs = { sel: number; def?: number; nonDef?: number };
  const f14 = (recs: Vs[], tail: Uint8Array, count = recs.length) => {
    const head = 10 + 11 * recs.length;
    const off = (x?: number) => (x === undefined ? 0 : head + x);
    return cat(fields([[2, 14], [4, head + tail.length], [4, count], ...recs.flatMap((r): Field[] => [[3, r.sel], [4, off(r.def)], [4, off(r.nonDef)]])]), tail);
  };
  const defTable = (ranges: [number, number][], count = ranges.length) => fields([[4, count], ...ranges.flatMap(([v, n]): Field[] => [[3, v], [1, n]])]);
  const nonDefTable = (maps: [number, number][], count = maps.length) => fields([[4, count], ...maps.flatMap(([v, g]): Field[] => [[3, v], [2, g]])]);
  const withVs = (sub: Uint8Array) => sfnt(cmap([[0, 5, sub], [3, 1, bmp]]));
  const f0 = (len = 262, lang = 0) => cat(fields([[2, 0], [2, len], [2, lang]]), new Uint8Array(256).fill(1)).subarray(0, Math.max(6, len));

  const c: Case[] = [];
  const add = (name: string, cm: Uint8Array) => c.push(['sfnt: cmap ' + name, sfnt(cm)]);

  add('Lato unchanged', lato);
  add('version 1', edit((d) => d.setUint16(0, 1)));
  add('numTables 0', edit((d) => d.setUint16(2, 0)));
  add('records run past the table', cmap([[3, 1, bmp]]).subarray(0, 10));
  add('minimal 3-1-4 right after the records', cmap([[3, 1, bmp]]));
  {
    const ok = cmap([[3, 1, bmp], [4, 0, 0]]);
    const tail = (off: number, extra: Uint8Array) => {
      const b = cat(ok, extra);
      view(b).setUint32(4 + 8 + 4, off);
      return b;
    };
    add('unknown-format record at the last 2 bytes', tail(ok.length, fields([[2, 6]])));
    add('record offset equals table length', tail(ok.length + 2, fields([[2, 6]])));
    add('record offset leaves 1 byte for the format', tail(ok.length + 1, fields([[2, 6]])));
    add('record offset inside the record list', tail(4, new Uint8Array(0)));
    add('format 4 length field cut off', tail(ok.length, fields([[2, 4], [1, 0]])));
    add('format 12 length field cut off', tail(ok.length, fields([[2, 12], [2, 0], [2, 0]])));
    add('format 14 length field cut off', tail(ok.length, fields([[2, 14], [2, 0]])));
  }
  add('3-1-4 length one past the table', (() => { const b = cmap([[3, 1, bmp]]); view(b).setUint16(14, bmp.length + 1); return b; })());
  add('3-1-4 length one short of the table', (() => { const b = cmap([[3, 1, bmp]]); view(b).setUint16(14, bmp.length - 1); return b; })());
  {
    const g = groups(12, [[0x41, 0x5a, 1]]);
    add('two subtables touching end to start', cmap([[3, 1, bmp], [3, 10, g]]));
    const longer = cmap([[3, 1, bmp], [3, 10, g]]);
    view(longer).setUint16(22, bmp.length + 2);
    add('3-1-4 length running 2 bytes into the next subtable', longer);
    add('0-3-4 and 3-1-4 sharing one subtable', cmap([[0, 3, bmp], [3, 1, bmp]]));
    const inside = cmap([[3, 1, bmp], [4, 0, 0]]);
    view(inside).setUint32(16, 20 + 14);
    add('unknown-format record pointing inside another subtable', inside);
  }

  add('only 1-0-0', cmap([[1, 0, f0()]]));
  add('only 0-5-14', cmap([[0, 5, f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0x41, 1]]))]]));
  add("only Lato's 1-0-6", (() => { const d = view(lato); const o = d.getUint32(16); return cmap([[1, 0, lato.slice(o, o + d.getUint16(o + 2))]]); })());
  add('only 0-4-4', cmap([[0, 4, bmp]]));
  add('only 3-10-4', cmap([[3, 10, bmp]]));
  add('only 0-6-13', cmap([[0, 6, groups(13, [[0x41, 0x5a, 1]])]]));
  add('only 0-0-4', cmap([[0, 0, bmp]]));
  add('only 0-1-4', cmap([[0, 1, bmp]]));
  add('only 0-3-4', cmap([[0, 3, bmp]]));
  add('only 3-0-4', cmap([[3, 0, bmp]]));
  add('only 0-3-12', cmap([[0, 3, groups(12, [[0x41, 0x5a, 1]])]]));
  add('only 0-4-12', cmap([[0, 4, groups(12, [[0x41, 0x5a, 1]])]]));
  add('only 3-10-12', cmap([[3, 10, groups(12, [[0x41, 0x5a, 1]])]]));
  add('only 3-10-13', cmap([[3, 10, groups(13, [[0x41, 0x5a, 1]])]]));
  const broken4 = f4([{ start: 0x41, end: 0x5a, delta: 3000 }, ffff]);
  add('bad format 4 under 0-4 beside a good 3-1-4', cmap([[0, 4, broken4], [3, 1, bmp]]));
  add('bad format 4 under 3-10 beside a good 3-1-4', cmap([[3, 1, bmp], [3, 10, broken4]]));
  add('bad format 4 under 0-1 beside a good 3-1-4', cmap([[0, 1, broken4], [3, 1, bmp]]));
  add('bad format 4 under 3-0 beside a good 3-1-4', cmap([[3, 0, broken4], [3, 1, bmp]]));
  add('records out of platform order', cmap([[3, 1, bmp], [0, 3, groups(12, [[0x41, 0x5a, 1]])]]));

  const one4 = (sub: Uint8Array) => cmap([[3, 1, sub]]);
  const az: Seg = { start: 0x41, end: 0x5a, delta: 1 - 0x41 };
  const segs = [az, ffff];
  add('format 4 language 1', one4(f4(segs, { lang: 1 })));
  add('format 4 segCountX2 odd', one4(f4(segs, { segX2: 5 })));
  add('format 4 searchRange odd', one4(f4(segs, { search: 5 })));
  add('format 4 segCount 0', one4(f4([], { search: 2, selector: 0, shift: 0 })));
  add('format 4 searchRange wrong', one4(f4(segs, { search: 8, shift: 0xfffc })));
  add('format 4 entrySelector wrong', one4(f4(segs, { selector: 0 })));
  add('format 4 rangeShift wrong', one4(f4(segs, { shift: 2 })));
  add('format 4 three segments, correct header', one4(f4([{ start: 0x30, end: 0x39, delta: 1 - 0x30 }, ...segs])));
  add('format 4 reservedPad 1', one4(f4(segs, { pad: 1 })));
  add('format 4 odd idRangeOffset on a middle segment', one4(f4([{ ...az, ro: 1 }, ffff])));
  add('format 4 odd idRangeOffset on the last segment', one4(f4([az, { ...ffff, ro: 0xffff }])));
  add('format 4 ends out of order', one4(f4([{ start: 0x41, end: 0x5a, delta: 1 - 0x41 }, { start: 0x30, end: 0x5a, delta: 1 - 0x30 }, ffff])));
  add('format 4 start on the previous end', one4(f4([{ start: 0x41, end: 0x5a, delta: 1 - 0x41 }, { start: 0x5a, end: 0x60, delta: 1 - 0x5a }, ffff])));
  add('format 4 start just past the previous end', one4(f4([{ start: 0x41, end: 0x5a, delta: 1 - 0x41 }, { start: 0x5b, end: 0x60, delta: 1 - 0x5b }, ffff])));
  add('format 4 segment starting after its end', one4(f4([{ start: 0x41, end: 0x5a, delta: 1 - 0x41 }, { start: 0x70, end: 0x60 }, ffff])));
  add('format 4 two 0xFFFF terminators', one4(f4([...segs, ffff])));
  add('format 4 three 0xFFFF terminators', one4(f4([...segs, ffff, ffff])));
  add('format 4 last segment ends at 0xFFFE', one4(f4([az, { start: 0xfffe, end: 0xfffe, delta: 2 }])));
  add('format 4 delta maps to numGlyphs', one4(f4([{ start: 0x41, end: 0x5a, delta: 3023 - 0x5a }, ffff])));
  add('format 4 delta maps to numGlyphs - 1', one4(f4([{ start: 0x41, end: 0x5a, delta: 3022 - 0x5a }, ffff])));
  add('format 4 terminator delta wraps to 0', one4(f4([az, { ...ffff, delta: 1 }])));
  add('format 4 terminator delta 0 maps 0xFFFF', one4(f4([az, { ...ffff, delta: 0 }])));
  const viaArray = (glyphs: number[], ro = 4, end = 0x42, length?: number) =>
    one4(f4([{ start: 0x41, end, ro }, ffff], { glyphs, length }));
  add('format 4 glyph array entry numGlyphs', viaArray([5, 3023]));
  add('format 4 glyph array entry numGlyphs - 1', viaArray([5, 3022]));
  add('format 4 glyph array read ending on the last byte', viaArray([5, 6]));
  add('format 4 glyph array read one byte past the end', viaArray([5, 6], 4, 0x42, f4([{ start: 0x41, end: 0x42, ro: 4 }, ffff], { glyphs: [5, 6] }).length - 1));
  add('format 4 glyph array read past the end', viaArray([5], 4, 0x42));
  add('format 4 shorter than its own length field', one4(f4(segs).subarray(0, 20)));
  const latoDelta = (top: number) => edit((d) => {
    const o = d.getUint32(24), n = d.getUint16(o + 6) / 2;
    const k = Array.from({ length: n - 1 }, (_, i) => i).find((i) => d.getUint16(o + 16 + 6 * n + 2 * i) === 0)!;
    d.setInt16(o + 16 + 4 * n + 2 * k, top - d.getUint16(o + 14 + 2 * k));
  });
  add("Lato 3-1-4's first delta segment ending on glyph numGlyphs", latoDelta(3023));
  add("Lato 3-1-4's first delta segment ending on glyph numGlyphs - 1", latoDelta(3022));
  add('Lato 1-0-6 garbage (ignored)', edit((d) => { const o = d.getUint32(16); d.setUint16(o + 2, 0xffff); d.setUint16(o + 6, 0xffff); }));

  const g12 = (gs: [number, number, number][], o?: { lang?: number; count?: number }) => cmap([[3, 1, bmp], [3, 10, groups(12, gs, o)]]);
  add('format 12 language 1', g12([[0x41, 0x5a, 1]], { lang: 1 }));
  add('format 12 no groups', g12([], { count: 0 }));
  add('format 12 one more group than fits', g12([[0x41, 0x5a, 1]], { count: 2 }));
  add('format 12 start past U+10FFFF', g12([[0x110000, 0x110000, 1]]));
  add('format 12 group at U+10FFFF', g12([[0x10ffff, 0x10ffff, 1]]));
  add('format 12 startGlyph 0x10000', g12([[0x41, 0x41, 0x10000]]));
  add('format 12 group ends before it starts', g12([[0x42, 0x41, 1]]));
  add('format 12 group ends on glyph numGlyphs', g12([[0x41, 0x42, 3022]]));
  add('format 12 group ends on glyph numGlyphs + 1', g12([[0x41, 0x42, 3023]]));
  add('format 12 single group at glyph numGlyphs', g12([[0x41, 0x41, 3023]]));
  add('format 12 groups with the same start', g12([[0x41, 0x41, 1], [0x41, 0x42, 1]]));
  add('format 12 groups overlapping', g12([[0x41, 0x45, 1], [0x45, 0x46, 1]]));
  add('format 12 groups adjacent', g12([[0x41, 0x45, 1], [0x46, 0x47, 1]]));
  add('format 12 under 0-3 maps past numGlyphs', cmap([[0, 3, groups(12, [[0x41, 0x42, 3023]])], [3, 1, bmp]]));
  add('format 12 under 3-10 cut short', (() => { const b = g12([[0x41, 0x5a, 1]]); return b.subarray(0, b.length - 1); })());

  const g13 = (gs: [number, number, number][], o?: { lang?: number; count?: number }) => cmap([[3, 1, bmp], [3, 10, groups(13, gs, o)]]);
  add('format 13 language 1', g13([[0x41, 0x5a, 1]], { lang: 1 }));
  add('format 13 no groups', g13([], { count: 0 }));
  add('format 13 one more group than fits', g13([[0x41, 0x5a, 1]], { count: 2 }));
  add('format 13 end past U+10FFFF', g13([[0x41, 0x110000, 1]]));
  add('format 13 glyph numGlyphs', g13([[0x41, 0x5a, 3023]]));
  add('format 13 glyph numGlyphs - 1', g13([[0x41, 0x5a, 3022]]));
  add('format 13 group ends before it starts', g13([[0x42, 0x41, 1]]));
  add('format 13 groups overlapping', g13([[0x41, 0x45, 1], [0x45, 0x46, 1]]));
  add('format 13 groups out of order', g13([[0x50, 0x55, 1], [0x41, 0x46, 1]]));

  const nd = nonDefTable([[0x41, 1]]);
  c.push(['sfnt: cmap format 14 one record', withVs(f14([{ sel: 0xfe00, nonDef: 0 }], nd))]);
  c.push(['sfnt: cmap format 14 no records', withVs(f14([], new Uint8Array(0)))]);
  {
    const sels = [0x180b, 0x180c, 0x180d, ...Array.from({ length: 16 }, (_, i) => 0xfe00 + i), ...Array.from({ length: 240 }, (_, i) => 0xe0100 + i)];
    c.push(['sfnt: cmap format 14 259 records', withVs(f14(sels.map((sel) => ({ sel, nonDef: 0 })), nd))]);
    const over = f14(sels.map((sel) => ({ sel, nonDef: 0 })), nd);
    view(over).setUint32(6, 260);
    c.push(['sfnt: cmap format 14 count 260', withVs(over)]);
  }
  const vs = (name: string, sub: Uint8Array) => c.push(['sfnt: cmap format 14 ' + name, withVs(sub)]);
  vs('selector U+FE10', f14([{ sel: 0xfe10, nonDef: 0 }], nd));
  vs('selector U+FE0F', f14([{ sel: 0xfe0f, nonDef: 0 }], nd));
  vs('selector U+E01F0', f14([{ sel: 0xe01f0, nonDef: 0 }], nd));
  vs('selector U+180A', f14([{ sel: 0x180a, nonDef: 0 }], nd));
  vs('selectors repeated', f14([{ sel: 0xfe00, nonDef: 0 }, { sel: 0xfe00, nonDef: 0 }], nd));
  vs('selectors descending', f14([{ sel: 0xfe01, nonDef: 0 }, { sel: 0xfe00, nonDef: 0 }], nd));
  vs('two records sharing one table', f14([{ sel: 0xfe00, nonDef: 0 }, { sel: 0xfe01, nonDef: 0 }], nd));
  vs('record with no tables', f14([{ sel: 0xfe00 }], nd));
  vs('default offset at the subtable length', f14([{ sel: 0xfe00, def: nd.length, nonDef: 0 }], nd));
  vs('non-default offset at the subtable length', f14([{ sel: 0xfe00, nonDef: nd.length }], nd));
  vs('second record table placed first', f14([{ sel: 0xfe00, nonDef: 9 }, { sel: 0xfe01, nonDef: 0 }], cat(nd, nonDefTable([[0x42, 2]]))));
  vs('tables in record order', f14([{ sel: 0xfe00, nonDef: 0 }, { sel: 0xfe01, nonDef: 9 }], cat(nd, nonDefTable([[0x42, 2]]))));
  vs('trailing byte after the last table', f14([{ sel: 0xfe00, nonDef: 0 }], cat(nd, new Uint8Array(1))));
  vs('default and non-default tables', f14([{ sel: 0xfe00, def: 0, nonDef: 8 }], cat(defTable([[0x41, 3]]), nd)));
  vs('default range count 0', f14([{ sel: 0xfe00, def: 0 }], defTable([], 0)));
  vs('default range count one past the end', f14([{ sel: 0xfe00, def: 0 }], defTable([[0x41, 0]], 2)));
  vs('default range value 0', f14([{ sel: 0xfe00, def: 0 }], defTable([[0, 1]])));
  vs('default range value U+110000', f14([{ sel: 0xfe00, def: 0 }], defTable([[0x110000, 0]])));
  vs('default range value U+10FFFF plus 255', f14([{ sel: 0xfe00, def: 0 }], defTable([[0x10ffff, 255]])));
  vs('default ranges touching', f14([{ sel: 0xfe00, def: 0 }], defTable([[0x41, 3], [0x44, 0]])));
  vs('default ranges adjacent', f14([{ sel: 0xfe00, def: 0 }], defTable([[0x41, 3], [0x45, 0]])));
  vs('non-default count 0', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([], 0)));
  vs('non-default count one past the end', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0x41, 1]], 2)));
  vs('non-default glyph 0', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0x41, 0]])));
  vs('non-default glyph 60000', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0x41, 60000]])));
  vs('non-default value 0', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0, 1]])));
  vs('non-default value U+110000', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0x110000, 1]])));
  vs('non-default values repeated', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0x41, 1], [0x41, 2]])));
  vs('non-default values ascending', f14([{ sel: 0xfe00, nonDef: 0 }], nonDefTable([[0x41, 1], [0x42, 2]])));
  c.push(['sfnt: cmap format 14 under 0-4 (ignored) with no records', sfnt(cmap([[0, 4, f14([], new Uint8Array(0))], [3, 1, bmp]]))]);

  const mac = (sub: Uint8Array) => sfnt(cmap([[1, 0, sub], [3, 1, bmp]]));
  c.push(['sfnt: cmap format 0 complete', mac(f0())]);
  c.push(['sfnt: cmap format 0 one byte short', mac(f0(261))]);
  c.push(['sfnt: cmap format 0 language 7', mac(f0(262, 7))]);
  c.push(['sfnt: cmap format 0 under 1-1 (ignored) one byte short', sfnt(cmap([[1, 1, f0(261)], [3, 1, bmp]]))]);
  return c;
}

/** glyf: each glyph's header, contours, flags and coordinates, and composite components and their point totals. */
function glyfCases(lato: readonly Table[]): Case[] {
  const numGlyphs = view(tableOf(lato, 'maxp')).getUint16(4);
  const loca = view(tableOf(lato, 'loca'));
  const glyf = tableOf(lato, 'glyf');
  const short = view(tableOf(lato, 'head')).getInt16(50) === 0;
  const at = (g: number): number => (short ? loca.getUint16(g * 2) * 2 : loca.getUint32(g * 4));
  const glyphs = Array.from({ length: numGlyphs }, (_, g) => glyf.slice(at(g), at(g + 1)));
  // Glyphs replaced or added, written with long loca offsets.
  const font = (changes: ReadonlyMap<number, Uint8Array>, added: readonly Uint8Array[] = [], maxpV05 = false): Uint8Array => {
    const all = [...glyphs.map((g, i) => changes.get(i) ?? g), ...added];
    const offsets: number[] = [0];
    for (const g of all) offsets.push((offsets.at(-1) as number) + Math.ceil(g.length / 4) * 4);
    const data = new Uint8Array(offsets.at(-1) as number);
    all.forEach((g, i) => data.set(g, offsets[i] as number));
    let tables = replaced(lato, { tag: 'glyf', data }, { tag: 'loca', data: fields(offsets.map((o): Field => [4, o])) });
    tables = edited(edited(tables, 'head', (d) => d.setInt16(50, 1)), 'maxp', (d, b) => {
      d.setUint16(4, all.length);
      if (!maxpV05) return;
      d.setUint32(0, 0x00005000);
      return b.slice(0, 6);
    });
    return sfntOf(edited(tables, 'hmtx', (_, b) => resized(b, b.length + 2 * added.length)));
  };
  const simpleId = glyphs.findIndex((g) => g.length >= 10 && view(g).getInt16(0) >= 2);
  const compositeId = glyphs.findIndex((g) => g.length >= 10 && view(g).getInt16(0) === -1);
  const out: Case[] = [['sfnt: glyf rewritten with long loca offsets', font(new Map())]];
  const edit = (name: string, f: (d: DataView, b: Uint8Array) => Uint8Array | void): void => {
    const b = (glyphs[simpleId] as Uint8Array).slice();
    out.push([`sfnt: glyf ${name}`, font(new Map([[simpleId, f(view(b), b) ?? b]]))]);
  };
  const instructions = (d: DataView): number => 10 + 2 * d.getInt16(0);
  const firstFlag = (d: DataView): number => instructions(d) + 2 + d.getUint16(instructions(d));
  edit('-2 contours', (d) => d.setInt16(0, -2));
  edit('0 contours and outline data', (d) => d.setInt16(0, 0));
  edit('xMin above xMax', (d) => d.setInt16(2, d.getInt16(6) + 1));
  edit('yMin above yMax', (d) => d.setInt16(4, d.getInt16(8) + 1));
  edit('bounds 32767, 32767, -32767, -32767', (d) => [32767, 32767, -32767, -32767].forEach((v, i) => d.setInt16(2 + 2 * i, v)));
  edit('a contour ending at point 65535', (d) => d.setUint16(instructions(d) - 2, 0xffff));
  edit('two contours ending at the same point', (d) => d.setUint16(12, d.getUint16(10)));
  edit('instructions longer than the glyph', (d) => d.setUint16(instructions(d), 0xfff0));
  edit('bit 6 on the first flag', (d) => d.setUint8(firstFlag(d), d.getUint8(firstFlag(d)) | 64));
  edit('bit 7 on the first flag', (d) => d.setUint8(firstFlag(d), d.getUint8(firstFlag(d)) | 128));
  edit('cut 4 bytes short', (_, b) => b.slice(0, b.length - 4));
  edit('cut to its 10-byte header', (_, b) => b.slice(0, 10));
  edit('cut to 9 bytes', (_, b) => b.slice(0, 9));
  edit('with 4 bytes after its coordinates', (_, b) => resized(b, b.length + 4));
  const SHORT = 1 | 2 | 4 | 16 | 32;
  const simple = (flags: readonly number[], coordinates: readonly number[], ends: readonly number[] = [2]): Uint8Array =>
    cat(fields([[2, ends.length], [2, 0], [2, 0], [2, 10], [2, 10], ...ends.map((e): Field => [2, e]), [2, 0]]), flags, coordinates);
  const hand = (name: string, g: Uint8Array): number => out.push([`sfnt: glyf ${name}`, font(new Map([[simpleId, g]]))]);
  hand('3 points of short coordinates', simple([SHORT, SHORT, SHORT], [1, 1, 2, 2, 3, 3]));
  hand('a flag repeated twice', simple([SHORT | 8, 2], [1, 1, 2, 2, 3, 3]));
  hand('a flag repeated 0 times', simple([SHORT | 8, 0, SHORT, SHORT], [1, 1, 2, 2, 3, 3]));
  hand('a flag repeated past the last point', simple([SHORT | 8, 3], [1, 1, 2, 2, 3, 3, 4, 4]));
  hand('the last flag repeated', simple([SHORT, SHORT, SHORT | 8, 1], [1, 1, 2, 2, 3, 3, 4, 4]));
  hand('bit 6 on the second flag', simple([SHORT, SHORT | 64, SHORT], [1, 1, 2, 2, 3, 3]));
  hand('one coordinate byte short, inside its 4-byte padding', simple([SHORT, SHORT, SHORT], [1, 1, 2, 2, 3]));
  hand('flags missing', simple([SHORT], []));
  const composite = (parts: readonly [number, number][], tail: readonly number[] = []): Uint8Array =>
    cat(fields([[2, 0xffff], [2, 0], [2, 0], [2, 10], [2, 10]]), ...parts.map(([flags, gid]) => cat(fields([[2, flags], [2, gid]]), Array<number>(flags & 1 ? 4 : 2).fill(0), flags & 8 ? [64, 0] : flags & 64 ? [64, 0, 64, 0] : flags & 128 ? [64, 0, 0, 0, 0, 0, 64, 0] : [])), tail);
  const comp = (name: string, changes: readonly [number, Uint8Array][], added: readonly Uint8Array[] = [], maxpV05 = false): number =>
    out.push([`sfnt: glyf composite ${name}`, font(new Map(changes), added, maxpV05)]);
  const MORE = 0x20;
  comp('of a simple glyph', [[compositeId, composite([[2, simpleId]])]]);
  comp('of glyph numGlyphs - 1', [[compositeId, composite([[2, numGlyphs - 1]])]]);
  comp('of glyph numGlyphs', [[compositeId, composite([[2, numGlyphs]])]]);
  // A version 0.5 maxp spares Chrome a warning for each of the 65536 levels it follows a cycle down, which takes it 40 s.
  comp('of itself, maxp version 0.5', [[compositeId, composite([[2, compositeId]])]], [], true);
  comp('of a composite of it, maxp version 0.5', [[compositeId, composite([[2, compositeId + 1]])], [compositeId + 1, composite([[2, compositeId]])]], [], true);
  comp('of a composite, maxp version 0.5', [[compositeId, composite([[2, compositeId + 1]])], [compositeId + 1, composite([[2, simpleId]])]], [], true);
  comp('of a composite', [[compositeId, composite([[2 | MORE, simpleId], [2, compositeId + 1]])], [compositeId + 1, composite([[2, simpleId]])]]);
  comp('of word arguments, a scale, an x and y scale and a 2x2', [[compositeId, composite([[2 | 1 | 8 | MORE, simpleId], [2 | 64 | MORE, simpleId], [2 | 128, simpleId]])]]);
  comp('with its arguments cut short', [[compositeId, composite([[2 | 1, simpleId]]).slice(0, 15)]]);
  comp('with instructions', [[compositeId, composite([[2 | 0x100, simpleId]], [0, 2, 0, 0])]]);
  comp('with instructions past its end', [[compositeId, composite([[2 | 0x100, simpleId]], [0, 50])]]);
  comp('of an empty glyph', [[compositeId, composite([[2, 0]])]]);
  const points = simple(Array<number>(200).fill(SHORT), Array<number>(400).fill(1), [199]);
  const many = (n: number): Uint8Array => composite(Array.from({ length: n }, (_, i): [number, number] => [2 | (i < n - 1 ? MORE : 0), numGlyphs]));
  comp('of 327 copies of a 200-point glyph', [[compositeId, many(327)]], [points]);
  comp('of 328 copies of a 200-point glyph', [[compositeId, many(328)]], [points]);
  comp('of 2 composites of 163 copies of a 200-point glyph', [[compositeId, composite([[2 | MORE, numGlyphs + 1], [2, numGlyphs + 1]])]], [points, many(163)]);
  comp('of 2 composites of 164 copies of a 200-point glyph', [[compositeId, composite([[2 | MORE, numGlyphs + 1], [2, numGlyphs + 1]])]], [points, many(164)]);
  out.push(
    ['sfnt: glyf 4 bytes longer than loca reaches', sfntOf(edited(lato, 'glyf', (_, b) => resized(b, b.length + 4)))],
    ['sfnt: loca reaching 2 bytes past the end of glyf', sfntOf(edited(lato, 'loca', (d) => d.setUint16(numGlyphs * 2, d.getUint16(numGlyphs * 2) + 1)))],
  );
  return out;
}

/** The other tables OTS checks: hinting programs, gasp, hdmx, VDMX, LTSH, VORG, kern, MATH, vhea and vmtx. */
function otherTableCases(lato: readonly Table[]): Case[] {
  const numGlyphs = view(tableOf(lato, 'maxp')).getUint16(4);
  const out: Case[] = [];
  const add = (name: string, ...tables: Table[]): number => out.push([`sfnt: ${name}`, sfntOf(replaced(lato, ...tables))]);
  for (const [tag, length] of [['cvt ', 3], ['cvt ', 131070], ['cvt ', 131072], ['fpgm', 131071], ['fpgm', 131072], ['prep', 131071], ['prep', 131072]] as const) add(`${tag.trim()} ${length} bytes long`, { tag, data: new Uint8Array(length) });
  const table = (tag: string) => (name: string, data: Uint8Array): number => add(`${tag} ${name}`, { tag, data });
  const gasp = table('gasp');
  gasp('version 1, one range', fields([[2, 1], [2, 1], [2, 0xffff], [2, 15]]));
  gasp('version 2, cut short after its header', fields([[2, 2], [2, 3]]));
  gasp('version 1, 2 ranges, 1 present', fields([[2, 1], [2, 2], [2, 0xffff], [2, 15]]));
  gasp('version 1, ranges out of order', fields([[2, 1], [2, 2], [2, 9], [2, 15], [2, 8], [2, 15]]));
  gasp('version 1, the last range ending below 0xFFFF', fields([[2, 1], [2, 1], [2, 9], [2, 15]]));
  gasp('version 1, no ranges', fields([[2, 1], [2, 0]]));
  gasp('3 bytes long', fields([[2, 1], [1, 0]]));
  const hdmx = (records: number, size: number, body: number): Uint8Array => cat(fields([[2, 0], [2, records], [4, size]]), new Uint8Array(body));
  const flags = (on: boolean): Table[] => edited(lato, 'head', (d) => d.setUint16(16, on ? d.getUint16(16) | 0x10 : d.getUint16(16) & ~0x14));
  const hd = (name: string, data: Uint8Array, on = true): number => out.push([`sfnt: hdmx ${name}`, sfntOf(replaced(flags(on), { tag: 'hdmx', data }))]);
  hd('of 1 record', hdmx(1, numGlyphs + 2, numGlyphs + 2));
  hd('of 1 record padded by 2 bytes', hdmx(1, numGlyphs + 4, numGlyphs + 4));
  hd('of 1 record padded by 4 bytes', hdmx(1, numGlyphs + 6, numGlyphs + 6));
  hd('of 1 record cut short', hdmx(1, numGlyphs + 2, numGlyphs + 1));
  hd('of 1 record cut short, without head flags bit 2 or 4', hdmx(1, numGlyphs + 2, numGlyphs + 1), false);
  hd('records shorter than numGlyphs + 2', hdmx(1, numGlyphs + 1, numGlyphs + 2));
  hd('of no records', hdmx(0, numGlyphs + 2, 0));
  hd('7 bytes long', hdmx(1, numGlyphs + 2, 0).slice(0, 7));
  const vdmx = (version: number, ratios: readonly (readonly number[])[], offsets: readonly number[], groups: readonly (readonly number[])[]): Uint8Array =>
    cat(fields([[2, version], [2, groups.length], [2, ratios.length]]), ...ratios, fields(offsets.map((o): Field => [2, o])), ...groups.map(([start, end, ...rows]) => cat(fields([[2, rows.length / 3], [1, start as number], [1, end as number], ...rows.map((v): Field => [2, v])]))));
  const vd = table('VDMX');
  vd('of 1 ratio and 1 group', vdmx(0, [[1, 1, 1, 1]], [0], [[8, 9, 8, 10, 0]]));
  vd('a ratio offset past the end', vdmx(0, [[1, 1, 1, 1]], [100], [[8, 9, 8, 10, 0]]));
  vd('version 2', vdmx(2, [[1, 1, 1, 1]], [100], [[8, 9, 8, 10, 0]]));
  vd('character set 2', vdmx(0, [[2, 1, 1, 1]], [100], []));
  vd('a group cut short', vdmx(0, [[1, 1, 1, 1]], [0], [[8, 9, 8, 10, 0]]).slice(0, -1));
  vd('yMax below yMin', vdmx(0, [[1, 1, 1, 1]], [0], [[8, 9, 8, 0xfffb, 10]]));
  const ltsh = table('LTSH');
  ltsh('of numGlyphs', cat(fields([[2, 0], [2, numGlyphs]]), new Uint8Array(numGlyphs)));
  ltsh('cut 1 byte short', cat(fields([[2, 0], [2, numGlyphs]]), new Uint8Array(numGlyphs - 1)));
  ltsh('of numGlyphs + 1', cat(fields([[2, 0], [2, numGlyphs + 1]]), new Uint8Array(1)));
  ltsh('version 1', fields([[2, 1], [2, numGlyphs]]));
  const vorg = table('VORG');
  vorg('of 1 record', fields([[2, 1], [2, 0], [2, 880], [2, 1], [2, 3], [2, 800]]));
  vorg('of 2 records, 1 present', fields([[2, 1], [2, 0], [2, 880], [2, 2], [2, 3], [2, 800]]));
  vorg('majorVersion 2', fields([[2, 2], [2, 0], [2, 880], [2, 2]]));
  vorg('7 bytes long', fields([[2, 1], [2, 0], [2, 880], [1, 0]]));
  const kern = (pairs: readonly [number, number][], o: { selector?: number; length?: number; coverage?: number; version?: number } = {}): Uint8Array => {
    const log2 = 31 - Math.clz32(pairs.length || 1);
    return cat(fields([[2, o.version ?? 0], [2, 1], [2, 0], [2, o.length ?? 14 + 6 * pairs.length], [2, o.coverage ?? 1], [2, pairs.length], [2, 6 << log2], [2, o.selector ?? log2], [2, 0]]), ...pairs.map(([l, r]) => fields([[2, l], [2, r], [2, 0xfff6]])));
  };
  const kn = table('kern');
  kn('of 2 pairs', kern([[1, 2], [1, 3]]));
  kn('entrySelector wrong', kern([[1, 2], [1, 3]], { selector: 0 }));
  kn('a subtable longer than the table', kern([[1, 2], [1, 3]], { length: 100 }));
  kn('pairs out of order', kern([[1, 3], [1, 2]]));
  kn('pairs cut short', kern([[1, 2], [1, 3]]).slice(0, -2));
  kn('version 1', kern([[1, 2]], { version: 1 }));
  kn('coverage with reserved bits', kern([[1, 2]], { coverage: 0x11 }));
  kn('of only a vertical subtable', kern([[1, 2]], { coverage: 0 }));
  const math = table('MATH');
  math('3 bytes long', new Uint8Array(3));
  math('version 1.0, 9 bytes long', fields([[4, 0x00010000], [2, 10], [2, 10], [1, 0]]));
  math('version 1.0, 10 bytes long, its offsets past the end', fields([[4, 0x00010000], [2, 10], [2, 10], [2, 10]]));
  math('version 2.0, 4 bytes long', fields([[4, 0x00020000]]));
  const vhea = (version: number, metrics: number, format = 0): Uint8Array =>
    fields([[4, version], [2, 500], [2, 0xfe0c], [2, 0], [2, 1000], [2, 0], [2, 0], [2, 1000], [2, 1], [2, 0], [2, 0], [4, 0], [4, 0], [2, format], [2, metrics]]);
  const vmtx = (metrics: number): Table => ({ tag: 'vmtx', data: new Uint8Array(4 * metrics + 2 * (numGlyphs - metrics)) });
  add('vhea version 1.0 and vmtx', { tag: 'vhea', data: vhea(0x00010000, 1) }, vmtx(1));
  add('vhea version 1.1 and vmtx', { tag: 'vhea', data: vhea(0x00011000, 1) }, vmtx(1));
  add('vhea version 1.2 and vmtx', { tag: 'vhea', data: vhea(0x00012000, 1) }, vmtx(1));
  add('vhea of 0 metrics and vmtx', { tag: 'vhea', data: vhea(0x00010000, 0) }, vmtx(1));
  add('vhea of 0 metrics, no vmtx', { tag: 'vhea', data: vhea(0x00010000, 0) });
  add('vhea of numGlyphs + 1 metrics, no vmtx', { tag: 'vhea', data: vhea(0x00010000, numGlyphs + 1) });
  add('vhea metricDataFormat 1', { tag: 'vhea', data: vhea(0x00010000, 1, 1) });
  add('vhea 35 bytes long', { tag: 'vhea', data: vhea(0x00010000, 1).slice(0, 35) });
  add('vmtx cut 1 byte short', { tag: 'vhea', data: vhea(0x00010000, 1) }, { tag: 'vmtx', data: vmtx(1).data.slice(0, -1) });
  add('vmtx without vhea', vmtx(1));
  return out;
}

/** Tables Chrome passes through unchecked, which still decide which rasterizer makes the typeface and whether it can. */
function passedThroughCases(lato: readonly Table[]): Case[] {
  const out: Case[] = [];
  const garbage = new Uint8Array(64).fill(1);
  const add = (name: string, ...tables: Table[]): number => out.push([`sfnt: ${name}`, sfntOf(replaced(lato, ...tables))]);
  for (const tag of ['avar', 'gvar', 'HVAR', 'MVAR', 'STAT', 'GSUB', 'COLR', 'CFF2', 'sbix', 'EBDT']) add(`a garbage ${tag} table`, { tag, data: garbage });
  const noOutlines = lato.filter((t) => t.tag !== 'glyf' && t.tag !== 'loca');
  out.push(
    ['sfnt: no glyf or loca, garbage CBDT and CBLC tables', sfntOf([...noOutlines, { tag: 'CBDT', data: garbage }, { tag: 'CBLC', data: garbage }])],
    ['sfnt: no glyf or loca, a garbage CBDT table', sfntOf([...noOutlines, { tag: 'CBDT', data: garbage }])],
    ['sfnt: no glyf or loca, a garbage CFF2 table', sfntOf([...noOutlines, { tag: 'CFF2', data: garbage }])],
  );
  type Axis = { readonly offset?: number; readonly count?: number; readonly axisSize?: number; readonly instances?: number; readonly instanceSize?: number; readonly extra?: number };
  const fvar = (o: Axis = {}): Uint8Array => {
    const offset = o.offset ?? 16;
    const axis = cat([0x77, 0x67, 0x68, 0x74], fields([[4, 100 << 16], [4, 400 << 16], [4, 900 << 16], [2, 0], [2, 256]]));
    const head = fields([[2, 1], [2, 0], [2, offset], [2, 2], [2, o.count ?? 1], [2, o.axisSize ?? 20], [2, o.instances ?? 0], [2, o.instanceSize ?? 8]]);
    return cat(head, new Uint8Array(Math.max(0, offset - 16)), axis, new Uint8Array(o.extra ?? 0));
  };
  const fv = (name: string, data: Uint8Array, ...more: Table[]): number => add(`fvar ${name}`, { tag: 'fvar', data }, ...more);
  fv('of 1 axis', fvar());
  fv('of 1 axis, 1 byte short', fvar().slice(0, 35));
  fv('of 1 axis, 15 bytes long', fvar().slice(0, 15));
  fv('of 0 axes, 16 bytes long', fvar({ count: 0 }).slice(0, 16));
  fv('of 2 axes, the first present', fvar({ count: 2 }));
  fv('of 2 axes, 20 bytes long', fvar({ count: 2 }).slice(0, 20));
  fv('axes at offset 40, 1 byte short', fvar({ offset: 40 }).slice(0, 59));
  fv('axes at offset 40', fvar({ offset: 40 }));
  fv('axes at offset 0', fvar({ offset: 0 }));
  for (const size of [19, 20, 24]) fv(`axisSize ${size}`, fvar({ axisSize: size, extra: 8 }));
  fv('axisSize 24, 39 bytes long', fvar({ axisSize: 24, extra: 8 }).slice(0, 39));
  fv('of 0 axes, axisSize 0', fvar({ count: 0, axisSize: 0 }));
  fv('instanceSize 0', fvar({ instanceSize: 0 }));
  fv('instanceSize 1, 1 instance', fvar({ instanceSize: 1, instances: 1 }));
  fv('of 0 axes, instanceSize 0, 1 instance', fvar({ count: 0, instanceSize: 0, instances: 1 }));
  fv('of 65535 instances, none present', fvar({ instances: 0xffff }));
  fv('of 64 bytes of 0x01', garbage);
  fv('of 64 zero bytes', new Uint8Array(64));
  const colr1 = new Uint8Array(34);
  colr1[1] = 1;
  fv('of 64 bytes of 0x01, beside a 14-byte COLR version 0', garbage, { tag: 'COLR', data: new Uint8Array(14) });
  fv('of 64 bytes of 0x01, beside a 13-byte COLR version 0', garbage, { tag: 'COLR', data: new Uint8Array(13) });
  fv('of 64 bytes of 0x01, beside a 34-byte COLR version 1', garbage, { tag: 'COLR', data: colr1 });
  fv('of 64 bytes of 0x01, beside a 33-byte COLR version 1', garbage, { tag: 'COLR', data: colr1.slice(0, 33) });
  fv('of 64 bytes of 0x01, beside a garbage COLR', garbage, { tag: 'COLR', data: garbage });
  fv('of 64 bytes of 0x01, beside garbage CBDT and CBLC', garbage, { tag: 'CBDT', data: garbage }, { tag: 'CBLC', data: garbage });
  fv('of 64 bytes of 0x01, beside a garbage CBDT', garbage, { tag: 'CBDT', data: garbage });
  fv('of 64 bytes of 0x01, beside a garbage CFF2', garbage, { tag: 'CFF2', data: garbage });
  fv('of 64 bytes of 0x01, beside a garbage sbix', garbage, { tag: 'sbix', data: garbage });
  fv('of 1 axis, beside garbage gvar, avar, HVAR, MVAR and STAT', fvar(), ...['gvar', 'avar', 'HVAR', 'MVAR', 'STAT'].map((tag) => ({ tag, data: garbage })));
  return out;
}

export function tableCases(ttf: Uint8Array, subset: Uint8Array): Case[] {
  const lato = sfntTables(ttf);
  return [...metricsCases(lato, sfntTables(subset)), ...cmapCases(lato), ...glyfCases(lato), ...otherTableCases(lato), ...passedThroughCases(lato)];
}
