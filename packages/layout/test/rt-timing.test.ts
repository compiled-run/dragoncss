// The rt timing model against Chrome 145 (rt-oracle/timing.json and hold.json): progress and currentIteration bit-equal over
// every delay, duration, iteration count, direction and fill combination and their phase and iteration boundaries.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EasingSpec } from '../src/rt-easing.ts';
import { easingFromSpec, LINEAR, NO_RT_FAULTS } from '../src/rt-easing.ts';
import type { EffectTimingSpec, FillMode, PlaybackDirection } from '../src/rt-timing.ts';
import { animationTiming, computeTiming, msToSeconds, pauseAt, seekPaused } from '../src/rt-timing.ts';

type Combo = { readonly delayMs: number; readonly endDelayMs: number; readonly durationMs: number; readonly iterations: number | 'Infinity'; readonly iterationStart: number; readonly direction: PlaybackDirection; readonly fill: FillMode; readonly easing: EasingSpec };
type TimingOracle = { readonly combos: readonly Combo[]; readonly records: readonly (readonly [number, number, string | null, string | null])[] };
const load = (name: string): TimingOracle => JSON.parse(readFileSync(new URL(`../rt-oracle/${name}`, import.meta.url), 'utf8')) as TimingOracle;
const timing = load('timing.json');
const hold = load('hold.json');

function bits(v: number | null): string | null {
  if (v === null) return null;
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return b.toString('hex');
}

function specOf(c: Combo): EffectTimingSpec {
  return { ...c, iterations: c.iterations === 'Infinity' ? Infinity : c.iterations, easing: easingFromSpec(c.easing) };
}

function mismatches(o: TimingOracle, elapsedSeconds: number): string[] {
  const out: string[] = [];
  for (const [i, t, progress, iteration] of o.records) {
    const c = o.combos[i];
    if (c === undefined) throw new Error(`combo ${i}`);
    const r = animationTiming(specOf(c), seekPaused(t, 0, 1), elapsedSeconds, NO_RT_FAULTS);
    if (bits(r.progress) !== progress || bits(r.currentIteration) !== iteration) out.push(`combo ${i} t=${t}: chrome ${progress}/${iteration}, reference ${bits(r.progress)}/${bits(r.currentIteration)}`);
  }
  return out;
}

describe('rt timing: Chrome oracle', () => {
  it('derives its grid from every combination and boundary', () => {
    const fills = new Set(timing.combos.map((c) => c.fill));
    const directions = new Set(timing.combos.map((c) => c.direction));
    expect([...fills].sort()).toEqual(['auto', 'backwards', 'both', 'forwards', 'none']);
    expect([...directions].sort()).toEqual(['alternate', 'alternate-reverse', 'normal', 'reverse']);
    expect(timing.combos.some((c) => c.delayMs < 0)).toBe(true);
    expect(timing.combos.some((c) => c.iterations === 'Infinity')).toBe(true);
    expect(timing.combos.some((c) => c.durationMs === 0)).toBe(true);
    expect(timing.records.length).toBeGreaterThan(30000);
    expect(hold.records.length).toBeGreaterThan(500);
  });

  it('equals Chrome bit for bit at every sample', () => {
    const f = mismatches(timing, 0);
    expect(f.slice(0, 10)).toEqual([]);
    expect(f.length).toBe(0);
  });

  it('a paused animation holds its time while the timeline advances (hold.json, read three frames later)', () => {
    const f = mismatches(hold, 0.05);
    expect(f.slice(0, 10)).toEqual([]);
    expect(f.length).toBe(0);
  });
});

describe('rt timing: the demo animations', () => {
  const spin: EffectTimingSpec = { delayMs: 0, endDelayMs: 0, durationMs: 20000, iterations: Infinity, iterationStart: 0, direction: 'normal', fill: 'none', easing: LINEAR };

  it('album-spin at 5000 ms is a quarter turn, and pausing there keeps it at 6000 ms (T014)', () => {
    expect(computeTiming(spin, msToSeconds(5000), NO_RT_FAULTS).progress).toBe(0.25);
    const running = { holdTime: null, heldAt: 0, startTime: 0, playbackRate: 1 };
    const paused = pauseAt(running, 5, NO_RT_FAULTS);
    expect(animationTiming(spin, paused, 6, NO_RT_FAULTS).progress).toBe(0.25);
    expect(animationTiming(spin, running, 6, NO_RT_FAULTS).progress).toBe(0.3);
  });

  it('an infinite animation reports its iteration and never finishes', () => {
    const r = computeTiming(spin, msToSeconds(45000), NO_RT_FAULTS);
    expect(r.phase).toBe('active');
    expect(r.currentIteration).toBe(2);
    expect(r.progress).toBe(0.25);
  });
});
