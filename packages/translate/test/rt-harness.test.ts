// The rt harness operations refuse a non-finite input with a harness error instead of computing on it (Macroscope 4153809247):
// fmod's doubling loop and the timing phases assume finite numbers, so iterationStart = Infinity or an infinite rotation would
// hang the harness. +Infinity iterations stay valid, as Web Animations allows them; NaN and -Infinity iterations are refused.
import { describe, expect, it } from 'vitest';
import { runLibraryCase } from '../harness/harness.ts';
import { bitsHex } from '../harness/host.ts';

const b = (v: number): string => bitsHex(v);
const linear = ['linear', b(0), b(0), b(1), b(1), b(1), 'end'];
const timing = (over: Partial<Record<'delay' | 'endDelay' | 'duration' | 'iterations' | 'iterationStart', number>> = {}): unknown[] => [
  b(over.delay ?? 0), b(over.endDelay ?? 0), b(over.duration ?? 1000), b(over.iterations ?? 1), b(over.iterationStart ?? 0), 'normal', 'both', linear,
];
const len = (px: number): unknown[] => ['px', b(px), b(0)];
const value = (kind: string, n: number, ops: unknown[] = []): unknown[] => [kind, b(n), len(0), [b(0), b(0), b(0), b(1)], ops];
const rotate = (angle: number): unknown[] => ['rotate', len(0), len(0), b(angle), b(1), b(1)];
const run = (c: unknown[]): string => runLibraryCase(JSON.stringify(c));

describe('rt harness inputs must be finite', () => {
  it('computes finite inputs and +Infinity iterations', () => {
    expect(run(['rt-timing', timing(), b(500)])).toMatch(/^\["ok",/);
    expect(run(['rt-timing', timing({ iterations: Number.POSITIVE_INFINITY }), b(2500)])).toMatch(/^\["ok",/);
    expect(run(['rt-interp', value('transform', 0, [rotate(0)]), value('transform', 0, [rotate(360)]), linear, linear, b(250), b(100), b(100)])).toMatch(/^\["ok",/);
  });

  it('refuses an infinite iterationStart, delay, duration or time, and NaN or negative iterations, before computing', () => {
    for (const bad of [{ iterationStart: Number.POSITIVE_INFINITY }, { delay: Number.NaN }, { duration: Number.NEGATIVE_INFINITY }, { iterations: Number.NaN }, { iterations: Number.NEGATIVE_INFINITY }]) {
      expect(run(['rt-timing', timing(bad), b(500)]), JSON.stringify(bad)).toMatch(/^\["harness-error",/);
      expect(run(['rt-hold', timing(bad), b(500), b(0.05)]), JSON.stringify(bad)).toMatch(/^\["harness-error",/);
    }
    expect(run(['rt-timing', timing(), b(Number.POSITIVE_INFINITY)])).toMatch(/^\["harness-error",.*not a finite number/);
    expect(run(['rt-hold', timing(), b(0), b(Number.NaN)])).toMatch(/^\["harness-error",/);
    expect(run(['rt-easing', ['cubic-bezier', b(Number.NaN), b(0), b(1), b(1), b(1), 'end'], b(500)])).toMatch(/^\["harness-error",/);
  });

  it('refuses an infinite rotation, length, colour, number or box size in an interpolation', () => {
    const ok = value('transform', 0, [rotate(0)]);
    const cases: unknown[][] = [
      [value('transform', 0, [rotate(Number.POSITIVE_INFINITY)]), ok, b(100), b(100)],
      [value('length', 0), ['length', b(0), len(Number.NaN), [b(0), b(0), b(0), b(1)], []], b(100), b(100)],
      [value('color', 0), ['color', b(0), len(0), [b(Number.POSITIVE_INFINITY), b(0), b(0), b(1)], []], b(100), b(100)],
      [value('opacity', Number.NaN), value('opacity', 1), b(100), b(100)],
      [ok, value('transform', 0, [rotate(90)]), b(Number.POSITIVE_INFINITY), b(100)],
    ];
    for (const [from, to, w, h] of cases) expect(run(['rt-interp', from, to, linear, linear, b(250), w, h])).toMatch(/^\["harness-error",/);
  });
});
