// The pieces of Chrome's font sanitizer (OTS, at the revision Chrome 145 pins) that decide whether a font loads: a bounds-checked
// reader, the two outcomes a table check can end in, and the facts one table's check leaves for the next.
//
// Reader is ported from the Buffer class in OTS's src/ots.h (third_party/ots/src, at the revision Chrome 145 pins), under this notice:
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

/** The sanitizer refuses the whole font. */
export class Refused extends Error {}

/** The sanitizer discards this table and keeps the font. */
export class Dropped extends Error {}

export const refuse = (reason: string): never => {
  throw new Refused(reason);
};

export const drop = (reason: string): never => {
  throw new Dropped(reason);
};

/** OTS's Buffer: reads past the end refuse the font, as nearly every OTS read failure does. */
export class Reader {
  offset = 0;
  readonly d: DataView;
  /** Where the bytes start in d. */
  readonly base: number;
  readonly length: number;

  constructor(d: DataView, base: number, length: number) {
    this.d = d;
    this.base = base;
    this.length = length;
  }

  /** A reader over the bytes from at to at + length (default: to the end), which must lie inside this one. */
  sub(at: number, length = this.length - at): Reader {
    if (at < 0 || length < 0 || at + length > this.length) refuse('a subtable runs past the end of its table');
    return new Reader(this.d, this.base + at, length);
  }

  get remaining(): number {
    return this.length - this.offset;
  }

  has(n: number): boolean {
    return this.offset + n <= this.length;
  }

  skip(n: number): void {
    if (!this.has(n)) refuse('a table is shorter than its fields');
    this.offset += n;
  }

  private at(n: number): number {
    const at = this.offset;
    this.skip(n);
    return this.base + at;
  }

  u8(): number {
    return this.d.getUint8(this.at(1));
  }

  u16(): number {
    return this.d.getUint16(this.at(2));
  }

  s16(): number {
    return this.d.getInt16(this.at(2));
  }

  u24(): number {
    const at = this.at(3);
    return (this.d.getUint8(at) << 16) | this.d.getUint16(at + 1);
  }

  u32(): number {
    return this.d.getUint32(this.at(4));
  }

  s32(): number {
    return this.d.getInt32(this.at(4));
  }

  /** The byte at i from the start, without moving; i must lie inside. */
  byteAt(i: number): number {
    return this.d.getUint8(this.base + i);
  }
}

export type TableRange = { readonly offset: number; readonly length: number };

/** The font as the sanitizer has read it so far: what each check needs from the tables checked before it. */
export type OtsFont = {
  numGlyphs: number;
  headFlags: number;
  indexToLocFormat: number;
  hheaMetrics: number;
  vheaMetrics: number;
  /** The loca offsets (numGlyphs + 1 of them) in bytes from the start of glyf. */
  loca: readonly number[] | null;
  /** Tables checked and kept. */
  readonly kept: Set<string>;
};
