// Host primitives of the translated harness. This file is never translated: each emitter maps these four functions to prelude
// helpers (emit-swift.ts, emit-kotlin.ts). The TypeScript bodies here are the reference the helpers must equal.

const view = new DataView(new ArrayBuffer(8));

/** The IEEE 754 bit pattern of a double as 16 lowercase hex digits. */
export function bitsHex(x: number): string {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
}

export function hexBits(s: string): number {
  if (!/^[0-9a-f]{16}$/.test(s)) throw new Error('bad bit pattern');
  view.setBigUint64(0, BigInt(`0x${s}`));
  return view.getFloat64(0);
}

/** A JSON number token, as JSON.parse reads it. */
export function parseNumber(s: string): number {
  if (!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(s)) throw new Error('bad number');
  return Number(s);
}

export function fromCodePoints(cps: readonly number[]): string {
  let out = '';
  for (const cp of cps) out += String.fromCodePoint(cp);
  return out;
}
