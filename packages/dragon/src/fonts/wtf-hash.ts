// The iteration order of a Blink HeapHashMap keyed by FontSelectionCapabilities. FontFaceCache picks the first best capability
// group in that order, so a tie between groups is decided by it. Chromium 145.0.7632.6 sources are cited per function.
//
// rapidhash below is ported from third_party/rapidhash/rapidhash.h in Chromium 145.0.7632.6, under this notice:
//
//   rapidhash - Very fast, high quality, platform-independent hashing algorithm.
//   Copyright (C) 2024 Nicolas De Carli
//
//   Based on 'wyhash', by Wang Yi <godspeed_china@yeah.net>
//
//   BSD 2-Clause License (https://www.opensource.org/licenses/bsd-license.php)
//
//   Redistribution and use in source and binary forms, with or without
//   modification, are permitted provided that the following conditions are
//   met:
//
//      * Redistributions of source code must retain the above copyright
//        notice, this list of conditions and the following disclaimer.
//      * Redistributions in binary form must reproduce the above
//        copyright notice, this list of conditions and the following disclaimer
//        in the documentation and/or other materials provided with the
//        distribution.
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
//
//   You can contact the author at:
//     - rapidhash source repository: https://github.com/Nicoshev/rapidhash

const M64 = (1n << 64n) - 1n;
// third_party/rapidhash/rapidhash.h: RAPID_SEED and rapid_secret.
const RAPID_SEED = 0xbdd89aa982704029n;
const SECRET = [0x2d358dccaa6c78a5n, 0x8bb84b93962eacc9n, 0x4b33a62ed433d4a3n] as const;

/** rapidhash.h rapid_mul128: the 128-bit product as (low, high). */
function mul128(a: bigint, b: bigint): [bigint, bigint] {
  const r = a * b;
  return [r & M64, (r >> 64n) & M64];
}

/** rapidhash.h rapid_mix. */
function mix(a: bigint, b: bigint): bigint {
  const [lo, hi] = mul128(a, b);
  return lo ^ hi;
}

/** rapidhash.h rapidhash_internal with PlainHashReader, for inputs of 4 to 16 bytes (the only length used here is 16). */
export function rapidhash(bytes: Uint8Array): bigint {
  const len = BigInt(bytes.length);
  if (bytes.length < 4 || bytes.length > 16) throw new Error('rapidhash port covers 4 to 16 bytes');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const r32 = (at: number): bigint => BigInt(d.getUint32(at, true));
  let seed = RAPID_SEED ^ mix(RAPID_SEED ^ SECRET[0], SECRET[1]) ^ len;
  const plast = bytes.length - 4;
  let a = (r32(0) << 32n) | r32(plast);
  const delta = (bytes.length & 24) >> (bytes.length >> 3);
  let b = (r32(delta) << 32n) | r32(plast - delta);
  a ^= SECRET[1];
  b ^= seed;
  [a, b] = mul128(a, b);
  seed = mix(a ^ SECRET[0] ^ len, b ^ SECRET[1]);
  return seed;
}

/**
 * font_selection_types.cc FontSelectionCapabilitiesHashTraits::GetHash: StringHasher::HashMemory over
 * {width.UniqueValue(), slope.UniqueValue(), weight.UniqueValue(), is_deleted}, truncated to unsigned.
 */
export function capabilitiesHash(uniqueValues: readonly [number, number, number]): number {
  const bytes = new Uint8Array(16);
  const d = new DataView(bytes.buffer);
  d.setUint32(0, uniqueValues[0] >>> 0, true);
  d.setUint32(4, uniqueValues[1] >>> 0, true);
  d.setUint32(8, uniqueValues[2] >>> 0, true);
  d.setUint32(12, 0, true);
  return Number(rapidhash(bytes) & 0xffffffffn);
}

/**
 * Dragon's model of the slot order of an open-addressed hash table like Chrome's (wtf/hash_table.h): 8 slots to start, keys
 * placed at hash & mask with quadratic (triangular) probing, the table doubled and refilled in old slot order once it is half
 * full. Returns the keys in iteration order (slot order); fonts/units.test.ts "selection ties" checks the result against Chrome.
 */
export function hashTableOrder<K>(keys: readonly K[], hash: (k: K) => number): K[] {
  let size = 0;
  let table: (K | undefined)[] = [];
  let count = 0;
  const place = (t: (K | undefined)[], k: K): void => {
    const mask = t.length - 1;
    let i = hash(k) & mask;
    let probe = 0;
    while (t[i] !== undefined) {
      probe++;
      i = (i + probe) & mask;
    }
    t[i] = k;
  };
  const rehash = (newSize: number): void => {
    const next: (K | undefined)[] = new Array<K | undefined>(newSize).fill(undefined);
    for (const k of table) if (k !== undefined) place(next, k);
    table = next;
    size = newSize;
  };
  for (const k of keys) {
    if (size === 0) rehash(8);
    place(table, k);
    count++;
    if (count * 2 >= size) rehash(size * 2);
  }
  return table.filter((k): k is K => k !== undefined);
}
