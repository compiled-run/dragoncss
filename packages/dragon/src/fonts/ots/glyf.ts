// Ported from OTS's src/glyf.cc (third_party/ots/src, at the revision Chrome 145 pins), under this notice:
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
import { refuse } from './reader.ts';
import type { OtsFont, Reader } from './reader.ts';

const ARGS_ARE_WORDS = 1;
const HAS_SCALE = 8;
const MORE_COMPONENTS = 0x20;
const HAS_XY_SCALE = 0x40;
const HAS_2X2 = 0x80;
const HAS_INSTRUCTIONS = 0x100;

type Parsed = { readonly points: number; readonly components: readonly number[] | null };

/** OTS's glyf check: every glyph's header, contours, flags, coordinates and components, and the points composites add up to. */
export function checkGlyf(t: Reader, font: OtsFont): void {
  const loca = font.loca;
  if (loca === null || !font.kept.has('head')) refuse('glyf needs loca and head');
  const offsets = loca as readonly number[];
  const n = font.numGlyphs;
  if (offsets.length !== n + 1) refuse('loca does not list one offset more than there are glyphs');
  const parsed: Parsed[] = [];
  for (let i = 0; i < n; i++) {
    const at = offsets[i] as number;
    const length = (offsets[i + 1] as number) - at;
    if (length === 0) {
      parsed.push({ points: 0, components: null });
      continue;
    }
    if (at >= t.length) refuse(`glyph ${i} starts past the end of glyf`);
    if (at + length > t.length) refuse(`glyph ${i} runs past the end of glyf`);
    parsed.push(glyph(t.sub(at, length), i, n));
  }
  const total = new Map<number, number>();
  for (let i = 0; i < n; i++) if ((parsed[i] as Parsed).components !== null && compositePoints(parsed, i, total) > 0xffff) refuse(`composite glyph ${i} has more than 65535 points`);
}

type Frame = { readonly glyph: number; next: number; sum: number };

/** The points a composite adds up to, its components followed to the leaves (capped at 65536); OTS refuses a cycle once it nests 65536 deep. */
function compositePoints(parsed: readonly Parsed[], root: number, total: Map<number, number>): number {
  const known = total.get(root);
  if (known !== undefined) return known;
  const visiting = new Set([root]);
  const stack: Frame[] = [{ glyph: root, next: 0, sum: 0 }];
  for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
    const components = (parsed[top.glyph] as Parsed).components as readonly number[];
    if (top.next < components.length) {
      const c = components[top.next++] as number;
      const p = parsed[c] as Parsed;
      const known = p.components === null ? p.points : total.get(c);
      if (known !== undefined) top.sum = Math.min(top.sum + known, 0x10000);
      else if (visiting.has(c)) refuse(`composite glyph ${root} contains itself`);
      else {
        visiting.add(c);
        stack.push({ glyph: c, next: 0, sum: 0 });
      }
      continue;
    }
    stack.pop();
    visiting.delete(top.glyph);
    total.set(top.glyph, top.sum);
    const parent = stack.at(-1);
    if (parent !== undefined) parent.sum = Math.min(parent.sum + top.sum, 0x10000);
  }
  return total.get(root) as number;
}

function glyph(g: Reader, i: number, numGlyphs: number): Parsed {
  const contours = g.s16();
  let xMin = g.s16();
  let yMin = g.s16();
  let xMax = g.s16();
  let yMax = g.s16();
  if (contours <= -2) refuse(`glyph ${i} has ${contours} contours`);
  if (xMin === 32767 && xMax === -32767 && yMin === 32767 && yMax === -32767) xMin = yMin = xMax = yMax = 0;
  if (xMin > xMax || yMin > yMax) refuse(`glyph ${i} has an inverted bounding box`);
  if (contours === 0) return { points: 0, components: null };
  return contours > 0 ? { points: simple(g, contours, i), components: null } : { points: 0, components: composite(g, i, numGlyphs) };
}

function simple(g: Reader, contours: number, i: number): number {
  let flags = 0;
  for (let c = 0; c < contours; c++) {
    const end = g.u16();
    if (end === 0xffff) refuse(`glyph ${i} has a contour ending at point 65535`);
    if (c > 0 && end + 1 <= flags) refuse(`glyph ${i} has contour ends that do not increase`);
    flags = end + 1;
  }
  g.skip(g.u16());
  let coordinates = 0;
  for (let p = 0; p < flags; p++) {
    const flag = g.u8();
    let delta = flag & 2 ? 1 : flag & 16 ? 0 : 2;
    delta += flag & 4 ? 1 : flag & 32 ? 0 : 2;
    if (flag & 64 && p !== 0) refuse(`glyph ${i} sets flag bit 6 after its first point`);
    if (flag & 8) {
      if (p + 1 >= flags) refuse(`glyph ${i} repeats a flag past its last point`);
      const repeat = g.u8();
      if (repeat === 0) refuse(`glyph ${i} repeats a flag 0 times`);
      delta += delta * repeat;
      p += repeat;
      if (p >= flags) refuse(`glyph ${i} repeats a flag past its last point`);
    }
    if (flag & 128) refuse(`glyph ${i} sets reserved flag bit 7`);
    coordinates += delta;
    if (g.length < coordinates) refuse(`glyph ${i} has more coordinates than bytes`);
  }
  g.skip(coordinates);
  return flags;
}

function composite(g: Reader, i: number, numGlyphs: number): number[] {
  const components: number[] = [];
  let flags: number;
  do {
    flags = g.u16();
    const component = g.u16();
    if (component >= numGlyphs) refuse(`composite glyph ${i} uses glyph ${component}, past the last glyph`);
    g.skip(flags & ARGS_ARE_WORDS ? 4 : 2);
    if (flags & HAS_SCALE) g.skip(2);
    else if (flags & HAS_XY_SCALE) g.skip(4);
    else if (flags & HAS_2X2) g.skip(8);
    components.push(component);
  } while (flags & MORE_COMPONENTS);
  if (flags & HAS_INSTRUCTIONS) g.skip(g.u16());
  return components;
}
