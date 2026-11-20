// OTS's cmap check (OpenTypeCMAP::Parse, plus the one refusal in its Serialize): only the accept/refuse decision.
//
// Ported from OTS's src/cmap.cc (third_party/ots/src, at the revision Chrome 145 pins), under this notice:
//
//   Copyright (c) 2009-2017 The OTS Authors. All rights reserved.
//
//   Redistribution and use in source and binary forms, with or without
//   modification, are permitted provided that the following conditions are
//   met:
//
//      * Redistributions of source code must retain the above copyright
//   notice, this list of conditions and the following disclaimer.
//      * Redistributions in binary form must reproduce the above
//   copyright notice, this list of conditions and the following disclaimer
//   in the documentation and/or other materials provided with the
//   distribution.
//      * Neither the name of Google Inc. nor the names of its
//   contributors may be used to endorse or promote products derived from
//   this software without specific prior written permission.
//
//   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
//   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
//   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
//   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
//   OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
//   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
//   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
//   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
//   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
//   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
//   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
import { type OtsFont, type Reader, refuse } from './reader.ts';

type Header = { platform: number; encoding: number; offset: number; format: number; length: number; language: number };

const GIB = 1024 * 1024 * 1024;
const UNICODE_MAX = 0x10ffff;

/** Which subtables Serialize would write; it refuses the font when none of these exist. */
type Kept = { bmp: boolean; ucs4: boolean };

function checkFormat4(t: Reader, numGlyphs: number): void {
  t.skip(4);
  if (t.u16() !== 0) refuse('cmap format 4 language is not 0');
  const segCountX2 = t.u16();
  const searchRange = t.u16();
  const entrySelector = t.u16();
  const rangeShift = t.u16();
  if (segCountX2 & 1 || searchRange & 1) refuse('cmap format 4 has an odd segCountX2 or searchRange');
  const segCount = segCountX2 >> 1;
  if (segCount < 1) refuse('cmap format 4 has no segments');
  let log2 = 0;
  while (1 << (log2 + 1) <= segCount) log2++;
  if (searchRange !== 2 << log2) refuse('cmap format 4 searchRange is wrong');
  if (entrySelector !== log2) refuse('cmap format 4 entrySelector is wrong');
  if (rangeShift !== segCountX2 - searchRange) refuse('cmap format 4 rangeShift is wrong');

  const segs = Array.from({ length: segCount }, () => ({ end: t.u16(), start: 0, delta: 0, rangeOffset: 0, rangeOffsetAt: 0 }));
  if (t.u16() !== 0) refuse('cmap format 4 reservedPad is not 0');
  for (const s of segs) s.start = t.u16();
  for (const s of segs) s.delta = t.s16();
  for (const [i, s] of segs.entries()) {
    s.rangeOffsetAt = t.offset;
    s.rangeOffset = t.u16();
    if (s.rangeOffset & 1) {
      if (i !== segCount - 1) refuse('cmap format 4 idRangeOffset is odd');
      s.rangeOffset = 0;
    }
  }

  for (const [i, s] of segs.entries()) {
    const prev = segs[i - 1];
    if (!prev) continue;
    if (i === segCount - 1 && prev.start === 0xffff && prev.end === 0xffff && s.start === 0xffff && s.end === 0xffff) continue;
    if (s.end <= prev.end) refuse('cmap format 4 segments are out of order');
    if (s.start <= prev.end) refuse('cmap format 4 segments overlap');
  }
  const last = segs.at(-1);
  if (last?.start !== 0xffff || last.end !== 0xffff) refuse('cmap format 4 does not end with a 0xFFFF segment');

  for (const s of segs) {
    for (let cp = s.start; cp <= s.end; cp++) {
      let glyph: number;
      if (s.rangeOffset === 0) {
        glyph = (cp + s.delta) & 0xffff;
      } else {
        const at = s.rangeOffsetAt + s.rangeOffset + (cp - s.start) * 2;
        if (at + 1 >= t.length) refuse('cmap format 4 glyph index lies past the subtable');
        glyph = (t.byteAt(at) << 8) | t.byteAt(at + 1);
      }
      if (glyph >= numGlyphs) refuse('cmap format 4 maps to a glyph past numGlyphs');
    }
  }
}

function checkGroups(t: Reader, numGlyphs: number, format: 12 | 13): void {
  t.skip(8);
  if (t.u32() !== 0) refuse(`cmap format ${format} language is not 0`);
  const numGroups = t.u32();
  if (numGroups === 0 || Math.floor(t.remaining / 12) < numGroups) refuse(`cmap format ${format} group count is bad`);
  const groups = Array.from({ length: numGroups }, () => {
    const g = { start: t.u32(), end: t.u32(), glyph: t.u32() };
    if (g.start > UNICODE_MAX || g.end > UNICODE_MAX || g.glyph > 0xffff) refuse(`cmap format ${format} group is out of range`);
    if (format === 12) {
      if (g.end < g.start) refuse('cmap format 12 group ends before it starts');
      if (g.end - g.start + g.glyph > numGlyphs) refuse('cmap format 12 group maps past numGlyphs');
    } else if (g.glyph >= numGlyphs) {
      refuse('cmap format 13 group maps to a glyph past numGlyphs');
    }
    return g;
  });
  groups.reduce((prev, g) => {
    if (g.start <= prev.start) refuse(`cmap format ${format} groups are out of order`);
    if (g.start <= prev.end) refuse(`cmap format ${format} groups overlap`);
    return g;
  });
}

const isVariationSelector = (v: number) =>
  (v >= 0x180b && v <= 0x180d) || (v >= 0xfe00 && v <= 0xfe0f) || (v >= 0xe0100 && v <= 0xe01ef);

function checkFormat14(t: Reader): void {
  t.skip(6);
  const numRecords = t.u32();
  if (numRecords === 0 || numRecords > 259) refuse('cmap format 14 record count is bad');
  const records: { def: number; nonDef: number }[] = [];
  let lastSelector = -1;
  for (let i = 0; i < numRecords; i++) {
    const selector = t.u24();
    const def = t.u32();
    const nonDef = t.u32();
    if (!isVariationSelector(selector)) refuse('cmap format 14 names something that is not a variation selector');
    if (lastSelector >= selector) refuse('cmap format 14 selectors are out of order');
    lastSelector = selector;
    if (!def && !nonDef) refuse('cmap format 14 record has no tables');
    if (def >= t.length || nonDef >= t.length) refuse('cmap format 14 offset lies past the subtable');
    records.push({ def, nonDef });
  }
  for (const { def, nonDef } of records) {
    if (def) {
      t.offset = def;
      const numRanges = t.u32();
      if (numRanges === 0 || Math.floor(t.remaining / 4) < numRanges) refuse('cmap format 14 default range count is bad');
      let last = 0;
      for (let j = 0; j < numRanges; j++) {
        const value = t.u24();
        const top = value + t.u8();
        if (value === 0 || value > UNICODE_MAX || top > 0xffffff || (last && value <= last)) refuse('cmap format 14 default range is bad');
        last = top;
      }
    }
    if (nonDef) {
      t.offset = nonDef;
      const numMappings = t.u32();
      if (numMappings === 0 || Math.floor(t.remaining / 5) < numMappings) refuse('cmap format 14 mapping count is bad');
      let last = 0;
      for (let j = 0; j < numMappings; j++) {
        const value = t.u24();
        const glyph = t.u16();
        if (glyph === 0 || value === 0) refuse('cmap format 14 mapping uses 0');
        if (value > UNICODE_MAX) refuse('cmap format 14 mapping is past U+10FFFF');
        if (last && value <= last) refuse('cmap format 14 mappings are out of order');
        last = value;
      }
    }
  }
  if (t.offset !== t.length) refuse('cmap format 14 does not end where its last table ends');
}

function checkFormat0(t: Reader): void {
  t.skip(6 + 256);
}

export function checkCmap(t: Reader, font: OtsFont): void {
  if (t.u16() !== 0) refuse('cmap version is not 0');
  const numTables = t.u16();
  if (!numTables) refuse('cmap has no subtables');
  const headers: Header[] = Array.from({ length: numTables }, () => ({
    platform: t.u16(),
    encoding: t.u16(),
    offset: t.u32(),
    format: 0,
    length: 0,
    language: 0,
  }));
  const dataOffset = t.offset;
  for (const h of headers) {
    if (h.offset > GIB) refuse('cmap subtable offset is over 1 GiB');
    if (h.offset < dataOffset || h.offset >= t.length) refuse('cmap subtable offset lies outside the table');
  }
  for (const h of headers) {
    t.offset = h.offset;
    h.format = t.u16();
    if (h.format === 0 || h.format === 4) {
      h.length = t.u16();
      h.language = t.u16();
    } else if (h.format === 12 || h.format === 13) {
      t.skip(2);
      h.length = t.u32();
      h.language = t.u32();
    } else if (h.format === 14) {
      h.length = t.u32();
    }
  }
  for (const h of headers) {
    if (!h.length) continue;
    if (h.length > GIB) refuse('cmap subtable length is over 1 GiB');
    if (h.offset + h.length > t.length) refuse('cmap subtable runs past the table');
  }

  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const h of headers) {
    const key = `${h.offset}:${h.offset + h.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([h.offset, 1], [h.offset + h.length, 0]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0;
  for (const [, isStart] of edges) {
    open += isStart ? 1 : -1;
    if (open > 1) refuse('cmap subtables overlap');
  }

  const numGlyphs = font.numGlyphs;
  const kept: Kept = { bmp: false, ucs4: false };
  for (const h of headers) {
    const sub = () => t.sub(h.offset, h.length);
    const { platform: p, encoding: e, format: f } = h;
    if (p === 0) {
      if ((e === 0 || e === 1 || e === 3) && f === 4) {
        checkFormat4(sub(), numGlyphs);
        kept.bmp = true;
      } else if ((e === 3 || e === 4) && f === 12) {
        checkGroups(sub(), numGlyphs, 12);
        kept.ucs4 = true;
      } else if (e === 5 && f === 14) {
        checkFormat14(sub());
      }
    } else if (p === 1) {
      if (e === 0 && f === 0) checkFormat0(sub());
    } else if (p === 3) {
      if ((e === 0 || e === 1) && f === 4) {
        checkFormat4(sub(), numGlyphs);
        kept.bmp = true;
      } else if (e === 10 && (f === 12 || f === 13)) {
        checkGroups(sub(), numGlyphs, f);
        kept.ucs4 = true;
      }
    }
  }
  if (!kept.bmp && !kept.ucs4) refuse('cmap has no Unicode subtable OTS keeps');
}
