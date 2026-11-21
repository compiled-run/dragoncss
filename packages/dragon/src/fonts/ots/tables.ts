// Ported from OTS's table checks (third_party/ots/src, at the revision Chrome 145 pins) in src/: head.cc, maxp.cc, hhea.cc, vhea.cc,
// metrics.cc (hmtx and vmtx), loca.cc, os2.cc, post.cc, name.cc, cvt.cc, fpgm.cc, prep.cc, gasp.cc, hdmx.cc, vdmx.cc, ltsh.cc, vorg.cc,
// kern.cc and math.cc, under this notice:
//
//   Copyright (c) 2009-2017 The OTS Authors. All rights reserved.
//   Copyright (c) 2011-2017 The OTS Authors. All rights reserved.
//   Copyright (c) 2014-2017 The OTS Authors. All rights reserved.
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
import { drop, refuse } from './reader.ts';
import type { OtsFont, Reader } from './reader.ts';

export function checkHead(t: Reader, font: OtsFont): void {
  const version = t.u32();
  t.skip(4);
  if (version >>> 16 !== 1) refuse(`head majorVersion ${version >>> 16}`);
  t.skip(4);
  if (t.u32() !== 0x5f0f3cf5) refuse('the head magicNumber is not 0x5F0F3CF5');
  font.headFlags = t.u16() & 0x381f;
  const upem = t.u16();
  if (upem < 16 || upem > 16384) refuse(`head unitsPerEm ${upem} is outside 16 to 16384`);
  t.skip(16);
  const [xMin, yMin, xMax, yMax] = [t.s16(), t.s16(), t.s16(), t.s16()];
  if (xMin > xMax || yMin > yMax) refuse('the head bounding box is inverted');
  t.skip(6);
  const format = t.s16();
  if (format < 0 || format > 1) refuse(`head indexToLocFormat ${format}`);
  font.indexToLocFormat = format;
  if (t.s16() !== 0) refuse('head glyphDataFormat is not 0');
}

export function checkMaxp(t: Reader, font: OtsFont): void {
  const major = t.u32() >>> 16;
  if (major > 1) refuse(`maxp version ${major}`);
  font.numGlyphs = t.u16();
  if (font.numGlyphs === 0) refuse('maxp numGlyphs is 0');
  if (major !== 1) return;
  t.skip(8);
  const zones = t.u16();
  t.skip(16);
  if (zones > 3) refuse(`maxp maxZones ${zones}`);
}

/** hhea and vhea: the header both metrics tables share. */
function metricsHeader(t: Reader, font: OtsFont): number {
  t.skip(28);
  if (t.s16() !== 0) refuse('metricDataFormat is not 0');
  const metrics = t.u16();
  if (metrics > font.numGlyphs) refuse(`${metrics} metrics for ${font.numGlyphs} glyphs`);
  return metrics;
}

export function checkHhea(t: Reader, font: OtsFont): void {
  const version = t.u32();
  if (version >>> 16 !== 1) refuse(`hhea majorVersion ${version >>> 16}`);
  font.hheaMetrics = metricsHeader(t, font);
}

export function checkVhea(t: Reader, font: OtsFont): void {
  const version = t.u32();
  if (version !== 0x00010000 && version !== 0x00011000) refuse(`vhea version 0x${version.toString(16)}`);
  font.vheaMetrics = metricsHeader(t, font);
}

/** hmtx and vmtx: the advance and side-bearing pairs, then side bearings to numGlyphs. */
function checkMetrics(t: Reader, font: OtsFont, metrics: number): void {
  if (metrics === 0) refuse('no metrics');
  t.skip(metrics * 4 + (font.numGlyphs - metrics) * 2);
}

export const checkHmtx = (t: Reader, font: OtsFont): void => checkMetrics(t, font, font.hheaMetrics);

export function checkVmtx(t: Reader, font: OtsFont): void {
  if (!font.kept.has('vhea')) refuse('vmtx without vhea');
  checkMetrics(t, font, font.vheaMetrics);
}

export function checkLoca(t: Reader, font: OtsFont): void {
  const offsets: number[] = [];
  for (let i = 0; i <= font.numGlyphs; i++) {
    const at = font.indexToLocFormat === 0 ? t.u16() * 2 : t.u32();
    if (i > 0 && at < (offsets[i - 1] as number)) refuse(`loca offset ${i} goes backwards`);
    offsets.push(at);
  }
  font.loca = offsets;
}

export function checkOs2(t: Reader): void {
  const version = t.u16();
  t.skip(76);
  if (version > 5) refuse(`OS/2 version ${version}`);
  // OTS compares the length with its in-memory struct, which pads 2 bytes after the PANOSE bytes, so 84 and 85 bytes refuse.
  if (version < 1 || t.length < 84) return;
  t.skip(8);
  if (version < 2 || t.length < 96) return;
  t.skip(10);
  if (version >= 5) t.skip(4);
}

export function checkPost(t: Reader, font: OtsFont): void {
  const version = t.u32();
  if (version !== 0x00010000 && version !== 0x00020000 && version !== 0x00030000) refuse(`post version 0x${version.toString(16)}`);
  t.skip(28);
  if (version !== 0x00020000) return;
  const glyphs = t.u16();
  if (glyphs === 0) {
    if (font.numGlyphs > 258) refuse('a post table of version 2 names no glyphs for more than 258');
    return;
  }
  if (glyphs !== font.numGlyphs) refuse(`post names ${glyphs} glyphs, maxp has ${font.numGlyphs}`);
  const indexes: number[] = [];
  for (let i = 0; i < glyphs; i++) indexes.push(t.u16());
  let strings = 0;
  while (t.remaining > 0) {
    const length = t.u8();
    if (length > t.remaining) refuse('a post glyph name runs past the end of the table');
    for (let k = 0; k < length; k++) if (t.u8() === 0) refuse('a post glyph name contains a NUL byte');
    strings++;
  }
  if (indexes.some((x) => x >= 258 && x - 258 >= strings)) refuse('a post name index is past the last name');
}

export function checkName(t: Reader): void {
  const format = t.u16();
  if (format > 1) refuse(`name format ${format}`);
  const count = t.u16();
  const strings = t.u16();
  if (strings > t.length) refuse('the name stringOffset is past the end of the table');
  t.skip(count * 12);
  if (format === 1) {
    const tags = t.u16();
    for (let i = 0; i < tags; i++) {
      const length = t.u16();
      if (strings + t.u16() + length > t.length) refuse('a name language tag runs past the end of the table');
      if (length > 200) refuse('a name language tag is longer than 200 bytes');
    }
  }
  if (t.offset > strings) refuse('the name records run into the string storage');
}

export function checkInstructions(t: Reader, tag: string): void {
  if (t.length >= 128 * 1024) refuse(`${tag} is 128 KiB or longer`);
  if (tag === 'cvt ' && t.length % 2 !== 0) refuse('cvt has an odd length');
}

export function checkGasp(t: Reader): void {
  const version = t.u16();
  const ranges = t.u16();
  if (version > 1) drop(`gasp version ${version}`);
  if (ranges === 0) drop('gasp has no ranges');
  let last = -1;
  for (let i = 0; i < ranges; i++) {
    const ppem = t.u16();
    t.skip(2);
    if (i > 0 && last >= ppem) drop('gasp ranges are not sorted');
    if (i === ranges - 1 && ppem !== 0xffff) drop('the last gasp range does not end at 0xFFFF');
    last = ppem;
  }
}

export function checkHdmx(t: Reader, font: OtsFont): void {
  if ((font.headFlags & 0x14) === 0) drop('hdmx without head flags bit 2 or 4');
  const version = t.u16();
  const records = t.s16();
  const size = t.s32();
  if (version !== 0) drop(`hdmx version ${version}`);
  if (records <= 0) drop('hdmx has no records');
  if (size < font.numGlyphs + 2) drop('hdmx records are shorter than numGlyphs + 2');
  const pad = size - (font.numGlyphs + 2);
  if (pad > 3) refuse('hdmx records are padded by more than 3 bytes');
  let last = 0;
  for (let i = 0; i < records; i++) {
    const ppem = t.u8();
    t.skip(1);
    if (i > 0 && ppem <= last) drop('hdmx records are not sorted');
    last = ppem;
    t.skip(font.numGlyphs + pad);
  }
}

export function checkVdmx(t: Reader): void {
  const version = t.u16();
  const groups = t.u16();
  const ratios = t.u16();
  if (version > 1) drop(`VDMX version ${version}`);
  for (let i = 0; i < ratios; i++) {
    const [charset, x, yStart, yEnd] = [t.u8(), t.u8(), t.u8(), t.u8()];
    if (charset > 1) drop(`VDMX character set ${charset}`);
    if (yStart > yEnd) drop('a VDMX y ratio range is inverted');
    if (i < ratios - 1 && x === 0 && yStart === 0 && yEnd === 0) drop('a VDMX ratio terminator before the last ratio');
  }
  const at = t.offset;
  for (let i = 0; i < ratios; i++) if (at + t.u16() >= t.length) refuse('a VDMX ratio offset is past the end of the table');
  for (let i = 0; i < groups; i++) {
    const records = t.u16();
    t.skip(2);
    let last = -1;
    for (let j = 0; j < records; j++) {
      const height = t.u16();
      const [yMax, yMin] = [t.s16(), t.s16()];
      if (yMax < yMin) drop('a VDMX record has yMax below yMin');
      if (j > 0 && last >= height) drop('VDMX records are not sorted');
      last = height;
    }
  }
}

export function checkLtsh(t: Reader, font: OtsFont): void {
  const version = t.u16();
  const glyphs = t.u16();
  if (version !== 0) drop(`LTSH version ${version}`);
  if (glyphs !== font.numGlyphs) drop(`LTSH has ${glyphs} glyphs, maxp ${font.numGlyphs}`);
  t.skip(glyphs);
}

export function checkVorg(t: Reader): void {
  const [major, minor] = [t.u16(), t.u16()];
  t.skip(2);
  const records = t.u16();
  if (major !== 1) drop(`VORG majorVersion ${major}`);
  if (minor !== 0) drop(`VORG minorVersion ${minor}`);
  let last = -1;
  for (let i = 0; i < records; i++) {
    const glyph = t.u16();
    t.skip(2);
    if (i > 0 && glyph <= last) drop('VORG records are not sorted');
    last = glyph;
  }
}

export function checkKern(t: Reader): void {
  const version = t.u16();
  const tables = t.u16();
  if (version > 0) drop(`kern version ${version}`);
  if (tables === 0) drop('kern has no subtables');
  let kept = 0;
  for (let i = 0; i < tables; i++) {
    const subVersion = t.u16();
    const length = t.u16();
    if (subVersion > 0) continue;
    if (t.offset - 4 + length > t.length) refuse(`kern subtable ${i} runs past the end of the table`);
    const coverage = t.u16();
    if (!(coverage & 1)) continue;
    if (coverage & 0xf0) drop('kern coverage sets reserved bits');
    if (coverage >> 8 !== 0) continue;
    const pairs = t.u16();
    t.skip(2);
    const selector = t.u16();
    t.skip(2);
    if (pairs === 0) drop('a kern subtable has no pairs');
    if (pairs > Math.floor(65536 / 6)) drop('a kern subtable has too many pairs');
    if (selector !== 31 - Math.clz32(pairs)) refuse(`kern subtable ${i} entrySelector ${selector}`);
    let last = -1;
    for (let j = 0; j < pairs; j++) {
      const pair = t.u32();
      t.skip(2);
      if (j > 0 && pair <= last) drop('kern pairs are not sorted');
      last = pair;
    }
    kept++;
  }
  if (kept === 0) drop('every kern subtable was skipped');
}

/** OTS drops a MATH table it cannot parse, but refuses one too short for its header. */
export function checkMath(t: Reader): void {
  if (t.u32() !== 0x00010000) drop('MATH version');
  t.skip(6);
}
