// Chrome 145 loads a web font only when OTS accepts it: Blink passes some tables through, drops those OTS does not know, checks the rest.
//
// The table lists are ported from OTS's src/ots.cc (third_party/ots/src, at the revision Chrome 145 pins), under this notice:
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
import { checkCff } from './cff.ts';
import { checkCmap } from './cmap.ts';
import { checkGlyf } from './glyf.ts';
import { Dropped, Reader, Refused } from './reader.ts';
import { typefaceRefusal } from './typeface.ts';
import type { OtsFont, TableRange } from './reader.ts';
import {
  checkGasp, checkHdmx, checkHead, checkHhea, checkHmtx, checkInstructions, checkKern, checkLoca, checkLtsh, checkMath, checkMaxp, checkName, checkOs2,
  checkPost, checkVdmx, checkVhea, checkVmtx, checkVorg,
} from './tables.ts';

const REQUIRED = ['maxp', 'head', 'OS/2', 'cmap', 'hhea', 'hmtx', 'name', 'post'];

/** The tables OTS checks, in the order it checks them (ots.cc supported_tables), less those Blink passes through. */
const CHECKS: readonly (readonly [string, (t: Reader, font: OtsFont) => void])[] = [
  ['maxp', checkMaxp],
  ['head', checkHead],
  ['OS/2', checkOs2],
  ['cmap', checkCmap],
  ['hhea', checkHhea],
  ['hmtx', checkHmtx],
  ['name', checkName],
  ['post', checkPost],
  ['loca', checkLoca],
  ['glyf', checkGlyf],
  ['CFF ', checkCff],
  ['VDMX', checkVdmx],
  ['hdmx', checkHdmx],
  ['gasp', checkGasp],
  ['cvt ', (t) => checkInstructions(t, 'cvt ')],
  ['fpgm', (t) => checkInstructions(t, 'fpgm')],
  ['prep', (t) => checkInstructions(t, 'prep')],
  ['LTSH', checkLtsh],
  ['VORG', checkVorg],
  ['kern', checkKern],
  ['vhea', checkVhea],
  ['vmtx', checkVmtx],
  ['MATH', checkMath],
];

/** Tables Blink hands on without OTS checking them (web_font_decoder.cc). */
export const PASSED_THROUGH = new Set(['CBDT', 'CBLC', 'COLR', 'CPAL', 'CFF2', 'sbix', 'STAT', 'avar', 'BASE', 'cvar', 'fvar', 'gvar', 'HVAR', 'MVAR', 'VVAR', 'GDEF', 'GPOS', 'GSUB']);

/** Why Chrome refuses the font, or the tables it keeps. */
export function sanitize(d: DataView, tables: ReadonlyMap<string, TableRange>): { readonly refused: string } | { readonly kept: ReadonlySet<string> } {
  const font: OtsFont = { numGlyphs: 0, headFlags: 0, indexToLocFormat: 0, hheaMetrics: 0, vheaMetrics: 0, loca: null, kept: new Set() };
  for (const [tag, check] of CHECKS) {
    const range = tables.get(tag);
    if (range === undefined) {
      if (REQUIRED.includes(tag)) return { refused: `no ${tag} table` };
      continue;
    }
    try {
      check(new Reader(d, range.offset, range.length), font);
      font.kept.add(tag);
    } catch (e) {
      if (e instanceof Refused) return { refused: `${tag}: ${e.message}` };
      if (!(e instanceof Dropped)) throw e;
    }
  }
  for (const tag of tables.keys()) if (PASSED_THROUGH.has(tag)) font.kept.add(tag);
  const has = (tag: string): boolean => font.kept.has(tag);
  if (!(has('glyf') && has('loca')) && !has('CFF ') && !has('CFF2') && !(has('CBDT') && has('CBLC'))) return { refused: 'no glyf and loca, CFF, CFF2, or CBDT and CBLC table' };
  const typeface = typefaceRefusal(d, tables);
  return typeface === null ? { kept: font.kept } : { refused: typeface };
}
