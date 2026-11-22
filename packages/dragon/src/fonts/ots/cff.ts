// Ported from OTS's src/cff.cc, and SelectLocalSubr from src/cff_charstring.cc (third_party/ots/src, at the revision Chrome 145 pins), under this notice:
//
//   Copyright (c) 2010-2017 The OTS Authors. All rights reserved.
//   Copyright (c) 2012-2017 The OTS Authors. All rights reserved.
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
import { checkCharString, EMPTY_INDEX, spend } from './cff-charstring.ts';
import type { Budget, CffIndex } from './cff-charstring.ts';
import { refuse } from './reader.ts';
import type { OtsFont, Reader } from './reader.ts';

const STANDARD_STRINGS = 390;
const ESC = 12 << 8;

type Operand = { readonly value: number; readonly real: boolean };
type Kind = 'top' | 'fd';

type Cff = {
  readonly t: Reader;
  readonly glyphs: number;
  readonly sidMax: number;
  readonly budget: Budget;
  charStrings: CffIndex | null;
  /** The FD index of each glyph FDSelect maps, or -1. */
  readonly fdSelect: Int32Array;
  fdMapped: number;
  fontDicts: number;
  readonly localPerFont: CffIndex[];
  local: CffIndex | null;
};

/** OTS's OpenTypeCFF::Parse: the header, the INDEXes and DICTs, charset, encoding, FDSelect and every glyph's charstring. */
export function checkCff(t: Reader, font: OtsFont): void {
  t.offset = 0;
  const major = t.u8();
  const minor = t.u8();
  const headerSize = t.u8();
  const offSize = t.u8();
  if (offSize < 1 || offSize > 4) refuse('the CFF header has a bad offSize');
  if (major !== 1 || minor !== 0) refuse(`CFF version ${major}.${minor} is not 1.0`);
  if (headerSize !== 4 || headerSize >= t.length) refuse('the CFF header size is not 4');
  const budget: Budget = { spent: 0 };
  t.offset = headerSize;
  const names = readIndex(t, budget);
  if (names.count !== 1) refuse('the CFF Name INDEX does not hold exactly one name');
  checkName(t, names);
  t.offset = names.next;
  const tops = readIndex(t, budget);
  if (tops.count !== 1) refuse('the CFF Top DICT INDEX does not hold exactly one DICT');
  t.offset = tops.next;
  const strings = readIndex(t, budget);
  if (strings.count >= 65000 - STANDARD_STRINGS) refuse('the CFF String INDEX holds too many strings');
  const glyphs = font.numGlyphs;
  const cff: Cff = {
    t,
    glyphs,
    sidMax: strings.count + STANDARD_STRINGS,
    budget,
    charStrings: null,
    fdSelect: new Int32Array(glyphs).fill(-1),
    fdMapped: 0,
    fontDicts: 0,
    localPerFont: [],
    local: null,
  };
  dicts(cff, tops, 'top');
  t.offset = strings.next;
  const global = readIndex(t, budget);
  for (const fd of cff.fdSelect) if (fd >= cff.fontDicts) refuse('CFF FDSelect names a Font DICT that does not exist');
  const charStrings = cff.charStrings;
  if (charStrings === null || charStrings.offsets.length === 0) refuse('CFF has no CharStrings');
  const offsets = (charStrings as CffIndex).offsets;
  for (let i = 1; i < offsets.length; i++) {
    const at = offsets[i - 1] as number;
    checkCharString({ table: t, global, local: localSubrs(cff, i - 1), budget }, at, (offsets[i] as number) - at);
  }
}

type Index = CffIndex & { readonly next: number };

/** OTS's ParseIndex; next is where the following structure starts. */
function readIndex(t: Reader, budget: Budget): Index {
  const count = t.u16();
  if (count === 0) return { count, offsets: [], next: t.offset };
  const size = t.u8();
  if (size < 1 || size > 4) refuse('a CFF INDEX has a bad offSize');
  const data = t.offset + (count + 1) * size;
  if (data >= t.length) refuse('a CFF INDEX runs past the end of the table');
  spend(budget, count);
  const offsets: number[] = [];
  for (let i = 0; i <= count; i++) {
    let rel = 0;
    for (let k = 0; k < size; k++) rel = rel * 256 + t.u8();
    if (rel < 1 || (i === 0 && rel !== 1)) refuse('a CFF INDEX offset is out of order');
    if (data + rel - 1 > t.length) refuse('a CFF INDEX offset points past the end of the table');
    if (i > 0 && data + rel - 1 < (offsets[i - 1] as number)) refuse('CFF INDEX offsets decrease');
    offsets.push(data + rel - 1);
  }
  return { count, offsets, next: offsets[count] as number };
}

function checkName(t: Reader, names: CffIndex): void {
  const at = names.offsets[0] as number;
  const length = (names.offsets[1] as number) - at;
  if (length > 127) refuse('the CFF font name is longer than 127 bytes');
  for (let i = 0; i < length; i++) {
    const c = t.byteAt(at + i);
    if (i === 0 && c === 0) continue;
    if (c < 33 || c > 126 || '[](){}<>/% '.includes(String.fromCharCode(c))) refuse('the CFF font name has a character PostScript names forbid');
  }
}

/** Reads one DICT token: an operator's code (escaped ones as 12 << 8 | op), or -1 after pushing an operand. */
function token(d: Reader, operands: Operand[]): number {
  const b0 = d.u8();
  let op = -1;
  if (b0 === 12) {
    const b1 = d.u8();
    if (!(b1 <= 14 || (b1 >= 17 && b1 <= 23) || (b1 >= 30 && b1 <= 38))) refuse(`CFF DICT operator 12 ${b1} is reserved`);
    op = ESC + b1;
  } else if (b0 <= 24) op = b0;
  else if (b0 <= 27 || b0 === 31 || b0 === 255) refuse(`CFF DICT byte ${b0} is reserved`);
  else operands.push(dictNumber(d, b0));
  if (operands.length + (op >= 0 ? 1 : 0) > 48) refuse('a CFF DICT operator has more than 48 operands');
  return op;
}

function dictNumber(d: Reader, b0: number): Operand {
  if (b0 === 28) return { value: d.u16(), real: false };
  if (b0 === 29) return { value: d.u32(), real: false };
  if (b0 === 30) return bcd(d);
  if (b0 <= 246) return { value: (b0 - 139) >>> 0, real: false };
  if (b0 <= 250) return { value: (b0 - 247) * 256 + d.u8() + 108, real: false };
  // OTS adds the second byte where the CFF spec subtracts it.
  return { value: (-(b0 - 251) * 256 + d.u8() - 108) >>> 0, real: false };
}

function bcd(d: Reader): Operand {
  let point = false;
  let exponent = false;
  for (;;) {
    const b = d.u8();
    const low = b & 0xf;
    if ((b & 0xf0) === 0xf0 && low !== 0xf) refuse('a CFF real number has a nibble after its end');
    if (low === 0xf) return { value: 0, real: true };
    // OTS shifts the high nibble out of the byte before checking it, so only the low nibble of each byte is checked.
    if (low === 0xd || low === 0xe) refuse('a CFF real number has a reserved nibble or a misplaced minus');
    if (low === 0xa) {
      if (point) refuse('a CFF real number has two decimal points');
      point = true;
    }
    if (low === 0xb || low === 0xc) {
      if (exponent) refuse('a CFF real number has two exponents');
      exponent = true;
    }
  }
}

function dicts(cff: Cff, index: CffIndex, kind: Kind): void {
  for (let i = 1; i < index.offsets.length; i++) {
    const at = index.offsets[i - 1] as number;
    dict(cff, cff.t.sub(at, (index.offsets[i] as number) - at), kind);
  }
}

function offsetOperand(cff: Cff, o: Operand): number {
  if (o.real || o.value >= cff.t.length) refuse('a CFF DICT offset is not an integer inside the table');
  return o.value;
}

function sid(cff: Cff, o: Operand): void {
  if (o.real || o.value > cff.sidMax) refuse('a CFF DICT string ID names no string');
}

function dict(cff: Cff, d: Reader, kind: Kind): void {
  const { t } = cff;
  const operands: Operand[] = [];
  let format: 'unknown' | 'cid' | 'other' = 'unknown';
  let ros = false;
  let haveCharStrings = false;
  let charset = 0;
  while (d.offset < d.length) {
    spend(cff.budget, 1);
    const op = token(d, operands);
    if (op < 0) continue;
    const n = operands.length;
    const last = operands[n - 1] as Operand;
    const one = (): void => {
      if (n !== 1) refuse(`CFF DICT operator ${op} needs exactly one operand`);
    };
    switch (op) {
      case 0:
      case 1:
      case 2:
      case 3:
      case 4:
      case ESC + 0:
      case ESC + 21:
      case ESC + 22:
      case ESC + 38:
        one();
        sid(cff, last);
        break;
      case 5:
      case 14:
      case ESC + 7:
      case ESC + 23:
        if (n === 0) refuse(`CFF DICT operator ${op} needs operands`);
        break;
      case 13:
      case ESC + 2:
      case ESC + 3:
      case ESC + 4:
      case ESC + 5:
      case ESC + 8:
      case ESC + 20:
        one();
        break;
      case ESC + 31:
      case ESC + 32:
      case ESC + 33:
      case ESC + 34:
      case ESC + 35:
        one();
        if (format !== 'cid') refuse('a CID operator appears in a CFF font that does not start with ROS');
        break;
      case ESC + 6:
        one();
        if (last.real || last.value !== 2) refuse('CFF charstrings are not Type 2');
        break;
      case ESC + 1:
        one();
        if (last.real || last.value >= 2) refuse('CFF isFixedPitch is not 0 or 1');
        break;
      case 15:
        one();
        if (last.value <= 2) break;
        offsetOperand(cff, last);
        if (charset) refuse('a CFF DICT has two charsets');
        charset = last.value;
        break;
      case 16: {
        one();
        if (last.value <= 1) break;
        t.offset = offsetOperand(cff, last);
        if (t.u8() & 0x80) refuse('CFF supplemental encodings are not supported');
        break;
      }
      case 17: {
        if (kind !== 'top') refuse('CharStrings outside the CFF Top DICT');
        one();
        t.offset = offsetOperand(cff, last);
        const index = readIndex(t, cff.budget);
        cff.charStrings = index;
        if (index.count < 2) refuse('CFF CharStrings holds fewer than 2 glyphs');
        if (haveCharStrings) refuse('the CFF Top DICT has two CharStrings');
        haveCharStrings = true;
        if (index.count !== cff.glyphs) refuse('CFF CharStrings and maxp count different numbers of glyphs');
        break;
      }
      case ESC + 36: {
        if (kind !== 'top') refuse('FDArray outside the CFF Top DICT');
        one();
        t.offset = offsetOperand(cff, last);
        const fds = readIndex(t, cff.budget);
        dicts(cff, fds, 'fd');
        if (cff.fontDicts !== 0) refuse('the CFF Top DICT has two FDArrays');
        cff.fontDicts = fds.count;
        break;
      }
      case ESC + 37:
        if (kind !== 'top') refuse('FDSelect outside the CFF Top DICT');
        one();
        t.offset = offsetOperand(cff, last);
        fdSelect(cff);
        break;
      case 18: {
        if (n !== 2 || last.real || (operands[0] as Operand).real) refuse('a CFF Private DICT entry is not two integers');
        const at = last.value;
        const length = (operands[0] as Operand).value;
        if (at > t.length || length >= t.length || at + length > t.length) refuse('a CFF Private DICT runs past the end of the table');
        privateDict(cff, at, length, kind);
        break;
      }
      case ESC + 30:
        if (format !== 'unknown') refuse('CFF ROS is not the first Top DICT operator');
        format = 'cid';
        if (n !== 3) refuse('CFF ROS needs three operands');
        sid(cff, operands[1] as Operand);
        sid(cff, operands[0] as Operand);
        if (ros) refuse('a CFF DICT has two ROS operators');
        ros = true;
        break;
      default:
        refuse(`CFF ${kind === 'top' ? 'Top' : 'Font'} DICT operator ${op >= ESC ? `12 ${op - ESC}` : op} is not allowed`);
    }
    operands.length = 0;
    if (format === 'unknown') format = 'other';
  }
  if (charset) checkCharset(cff, charset, ros);
}

function checkCharset(cff: Cff, at: number, ros: boolean): void {
  const { t, glyphs } = cff;
  t.offset = at;
  const format = t.u8();
  const check = (): void => {
    spend(cff.budget, 1);
    if (t.u16() > cff.sidMax && !ros) refuse('a CFF charset names a string that does not exist');
  };
  if (format === 0) {
    for (let g = 1; g < glyphs; g++) check();
  } else if (format === 1 || format === 2) {
    for (let total = 1; total < glyphs; ) {
      check();
      total += (format === 1 ? t.u8() : t.u16()) + 1;
    }
  } else refuse(`CFF charset format ${format} is unknown`);
}

function fdSelect(cff: Cff): void {
  const { t, glyphs, fdSelect: map } = cff;
  const format = t.u8();
  const insert = (from: number, to: number, fd: number): void => {
    spend(cff.budget, to - from);
    for (let g = from; g < to; g++) {
      if (map[g] !== -1) refuse('CFF FDSelect maps a glyph twice');
      map[g] = fd;
      cff.fdMapped++;
    }
  };
  if (format === 0) {
    spend(cff.budget, glyphs);
    for (let g = 0; g < glyphs; g++) {
      if (map[g] === -1) cff.fdMapped++;
      map[g] = t.u8();
    }
  } else if (format === 3) {
    const ranges = t.u16();
    if (ranges === 0) refuse('CFF FDSelect has no ranges');
    let last = 0;
    let fd = 0;
    for (let j = 0; j < ranges; j++) {
      const first = t.u16();
      if (j === 0 && first !== 0) refuse('CFF FDSelect does not start at glyph 0');
      if (j !== 0 && last >= first) refuse('CFF FDSelect ranges are not in increasing order');
      if (first >= glyphs) refuse('a CFF FDSelect range starts past the last glyph');
      if (j !== 0) insert(last, first, fd);
      fd = t.u8();
      last = first;
    }
    const sentinel = t.u16();
    if (last >= sentinel || sentinel > glyphs) refuse('the CFF FDSelect sentinel is out of range');
    insert(last, sentinel, fd);
  } else refuse(`CFF FDSelect format ${format} is unknown`);
}

function privateDict(cff: Cff, at: number, length: number, kind: Kind): void {
  const { t } = cff;
  const d = t.sub(at, length);
  if (kind === 'fd') cff.localPerFont.push(EMPTY_INDEX);
  const operands: Operand[] = [];
  while (d.offset < d.length) {
    spend(cff.budget, 1);
    const op = token(d, operands);
    if (op < 0) continue;
    const n = operands.length;
    const last = operands[n - 1] as Operand;
    switch (op) {
      case 6:
      case 7:
      case 8:
      case 9:
        if (n % 2 !== 0) refuse('a CFF blue zone list has an odd number of values');
        break;
      case ESC + 12:
      case ESC + 13:
        if (n === 0) refuse('a CFF stem snap list is empty');
        break;
      case 10:
      case 11:
      case 20:
      case 21:
      case ESC + 9:
      case ESC + 10:
      case ESC + 11:
      case ESC + 17:
      case ESC + 18:
      case ESC + 19:
        if (n !== 1) refuse(`CFF Private DICT operator ${op} needs exactly one operand`);
        break;
      case 19: {
        if (n !== 1 || last.real || last.value >= 1 << 30 || last.value + at >= t.length) refuse('the CFF local Subrs offset is out of range');
        t.offset = last.value + at;
        if (kind === 'top' && cff.local !== null) refuse('the CFF Top DICT has two local Subrs');
        const index = readIndex(t, cff.budget);
        if (kind === 'fd') cff.localPerFont[cff.localPerFont.length - 1] = index;
        else cff.local = index;
        break;
      }
      case ESC + 14:
        if (n !== 1 || last.real || last.value >= 2) refuse('CFF ForceBold is not 0 or 1');
        break;
      default:
        refuse(`CFF Private DICT operator ${op >= ESC ? `12 ${op - ESC}` : op} is not allowed`);
    }
    operands.length = 0;
  }
}

function localSubrs(cff: Cff, glyph: number): CffIndex {
  if (cff.fdMapped > 0 && cff.localPerFont.length > 0) {
    const fd = cff.fdSelect[glyph] ?? -1;
    if (fd < 0 || fd >= cff.localPerFont.length) refuse(`CFF glyph ${glyph} has no Font DICT`);
    return cff.localPerFont[fd] as CffIndex;
  }
  return cff.local ?? EMPTY_INDEX;
}
