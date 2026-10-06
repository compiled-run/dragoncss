// PNT1 shadow sample inputs: the shadow facts a program carries are checked before they drive the sample points and the host
// measurement; a malformed shadow is an error naming the node, never a silently skipped box.
import { describe, expect, it } from 'vitest';
import type { NativeProgram } from 'dragon';
import { shadowInputs } from '../src/paint-samples/shadow.ts';

const program = (facts: Record<string, unknown>): NativeProgram => ({ nodes: [{ id: 'a', facts }] }) as unknown as NativeProgram;
const good = { inset: false, x: 1, y: 2, blur: 3, spread: 4, color: { r: 1, g: 2, b: 3, alpha: 128 } };

describe('shadowInputs', () => {
  it('reads each shadow as a ShadowInput, and a node without shadow facts as none', () => {
    expect(shadowInputs(program({ shadow: { shadows: [good] } }), 'a')).toEqual([{ inset: false, x: 1, y: 2, blur: 3, spread: 4, r: 1, g: 2, b: 3, a: 128 }]);
    expect(shadowInputs(program({}), 'a')).toBeNull();
  });
  it('rejects facts without a shadow list and shadows with a missing, non-finite or negative-blur field', () => {
    expect(() => shadowInputs(program({ shadow: {} }), 'a')).toThrow(/a: shadow facts hold no shadow list/);
    expect(() => shadowInputs(program({ shadow: { shadows: [] } }), 'a')).toThrow(/no shadow list/);
    for (const bad of [{ ...good, inset: 1 }, { ...good, x: Number.NaN }, { ...good, blur: -1 }, { ...good, color: { r: 1, g: 2, b: 3 } }, { ...good, spread: '2' }]) {
      expect(() => shadowInputs(program({ shadow: { shadows: [good, bad] } }), 'a'), JSON.stringify(bad)).toThrow(/a: shadow 1 of the facts is malformed/);
    }
  });
});
