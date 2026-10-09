// PNT1-shadow: the harness decoders of the paint:shadow cases refuse a malformed flag or count (the native decoders are
// translated from the same code), so a vector line can never pass a 2 as a fault flag or loop over a fractional shadow count.
import { describe, expect, it } from 'vitest';
import { runUnitsCase } from '../harness/harness.ts';

const view = new DataView(new ArrayBuffer(8));
const b = (x: number): string => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};
const SQUARE = [0, 0, 0, 0, 0, 0, 0, 0];
const run = (name: string, args: readonly number[]): string => runUnitsCase(JSON.stringify([`paint:shadow:${name}`, ...args.map(b)]));
const outer = (opaque: number, count: number, inset: number, faults: readonly number[]): string =>
  run('outerShadowLayer', [4, 4, 16, 12, ...SQUARE, opaque, count, inset, 1, 2, 2, 0, 0, 0, 0, 128, 1, ...faults]);

describe('paint:shadow harness decoders', () => {
  it('run a well-formed case', () => {
    expect(outer(1, 1, 0, [0, 0, 0])).toMatch(/^\["ok",/);
    expect(outer(1, 1, 0, [1, 0, 0])).toMatch(/^\["ok",/);
  });
  it('refuse a flag that is not 0 or 1', () => {
    expect(outer(2, 1, 0, [0, 0, 0])).toMatch(/^\["harness-error","argument 13: flag/);
    expect(outer(1, 1, 0.5, [0, 0, 0])).toMatch(/^\["harness-error","argument 15: flag/);
    expect(outer(1, 1, 0, [0, -1, 0])).toMatch(/^\["harness-error","argument 26: flag/);
  });
  it('refuse a shadow or fill count that is not a whole number within the line', () => {
    expect(outer(1, 0.5, 0, [0, 0, 0])).toMatch(/^\["harness-error","argument 14: count/);
    expect(outer(1, -1, 0, [0, 0, 0])).toMatch(/^\["harness-error","argument 14: count/);
    expect(outer(1, 1e9, 0, [0, 0, 0])).toMatch(/^\["harness-error","argument 14: count/);
    expect(run('backdropAt', [1.5, 5, 5])).toMatch(/^\["harness-error","argument 1: count/);
    expect(run('backdropAt', [0, 5, 5])).toMatch(/^\["ok",/);
  });
});
