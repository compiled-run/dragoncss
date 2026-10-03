// The transition update port (T065 R5, R6, R7) on hand-built cases; the Chrome oracle comparison is in rt-faults.test.ts.
import { describe, expect, it } from 'vitest';
import { cubicBezierEasing, EASE, LINEAR, NO_RT_FAULTS } from '../src/rt-easing.ts';
import type { AnimatedValue } from '../src/rt-interpolate.ts';
import { legacyColorFromCss, lengthPx, serializeValue, TRANSPARENT, ZERO_PX } from '../src/rt-interpolate.ts';
import { advanceHeld, HELD_ZERO, heldFinished } from '../src/rt-timing.ts';
import type { RunningTransition, TransitionChange, TransitionListing } from '../src/rt-transition.ts';
import { advanceTransition, runTransitionScript, sampleTransition, transitionFinished, UNLISTED, updateTransition, valuesEqual } from '../src/rt-transition.ts';

const BASE: AnimatedValue = { kind: 'opacity', number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
const op = (n: number): AnimatedValue => ({ ...BASE, number: Math.fround(n) });
const px = (n: number): AnimatedValue => ({ ...BASE, kind: 'length', length: lengthPx(n) });
const listed = (duration: number, delay = 0, easing = LINEAR): TransitionListing => ({ mode: 'listed', delay, duration, easing });
const show = (v: AnimatedValue): string => serializeValue(v, 100, 100, { sin: Math.sin, cos: Math.cos });
const bits = (v: number): string => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(v);
  return b.toString('hex');
};

function change(oldBase: AnimatedValue, after: AnimatedValue, listing: TransitionListing, extra: Partial<TransitionChange> = {}): TransitionChange {
  return { hasOldStyle: true, oldBase, after, smooth: true, listing, range: 'all', ...extra };
}

function run(t: RunningTransition, ms: number): RunningTransition {
  return advanceTransition(t, ms, NO_RT_FAULTS);
}

describe('updateTransition', () => {
  it('reproduces M5: the reversal at 250 ms starts from 0.802403 with duration bits 4079133a25178c38', () => {
    const open = updateTransition(null, change(op(0), op(1), listed(0.5, 0, EASE)), NO_RT_FAULTS);
    expect(open).not.toBeNull();
    const mid = run(open as RunningTransition, 250);
    expect(show(sampleTransition(mid, 'all', NO_RT_FAULTS)?.value as AnimatedValue)).toBe('0.802403');
    const back = updateTransition(mid, change(op(1), op(0), listed(0.5, 0, EASE)), NO_RT_FAULTS) as RunningTransition;
    expect(bits(back.timing.duration * 1000)).toBe('4079133a25178c38');
    expect(show(back.from)).toBe('0.802403');
    expect(valuesEqual(back.reversingAdjustedStart, op(1))).toBe(true);
    expect(back.shorteningFactor).toBe(0.8024033910598437);
  });

  it('noReversalShortening keeps the full duration', () => {
    const mid = run(updateTransition(null, change(op(0), op(1), listed(0.5, 0, EASE)), NO_RT_FAULTS) as RunningTransition, 250);
    expect(updateTransition(mid, change(op(1), op(0), listed(0.5, 0, EASE)), { ...NO_RT_FAULTS, noReversalShortening: true })?.timing.duration).toBe(0.5);
  });

  it('keeps a running transition whose end is the after-change value, even under the initial listing', () => {
    const t = run(updateTransition(null, change(px(0), px(100), listed(1)), NO_RT_FAULTS) as RunningTransition, 300);
    expect(updateTransition(t, change(px(100), px(100), listed(2)), NO_RT_FAULTS)).toBe(t);
    expect(updateTransition(t, change(px(100), px(100), { ...UNLISTED, mode: 'initial' }), NO_RT_FAULTS)).toBe(t);
    expect(updateTransition(t, change(px(100), px(50), { ...UNLISTED, mode: 'initial' }), NO_RT_FAULTS)).toBeNull();
  });

  it('cancels when unlisted (M23), and starts nothing on a first style, a discrete pair, an equal pair or delay + duration <= 0', () => {
    const t = updateTransition(null, change(px(0), px(100), listed(1)), NO_RT_FAULTS) as RunningTransition;
    expect(updateTransition(t, change(px(100), px(100), UNLISTED), NO_RT_FAULTS)).toBeNull();
    expect(updateTransition(null, change(px(0), px(100), listed(1), { hasOldStyle: false }), NO_RT_FAULTS)).toBeNull();
    expect(updateTransition(null, change(px(0), px(100), listed(1), { smooth: false }), NO_RT_FAULTS)).toBeNull();
    expect(updateTransition(null, change(px(5), px(5), listed(1)), NO_RT_FAULTS)).toBeNull();
    expect(updateTransition(null, change(px(0), px(100), listed(0.5, -0.5)), NO_RT_FAULTS)).toBeNull();
    expect(updateTransition(null, change(px(0), px(100), listed(0.5, -0.25)), NO_RT_FAULTS)).not.toBeNull();
  });

  it('interrupts to a third value from the displayed value with the full duration (M22)', () => {
    const t = run(updateTransition(null, change(op(0), op(1), listed(1)), NO_RT_FAULTS) as RunningTransition, 250);
    const n = updateTransition(t, change(op(1), op(0.5), listed(1)), NO_RT_FAULTS) as RunningTransition;
    expect(show(n.from)).toBe('0.25');
    expect(n.timing.duration).toBe(1);
    expect(n.shorteningFactor).toBe(1);
  });

  it('scales a negative delay on reversal and leaves a positive one', () => {
    const neg = run(updateTransition(null, change(op(0), op(1), listed(1, -0.5)), NO_RT_FAULTS) as RunningTransition, 100);
    const r = updateTransition(neg, change(op(1), op(0), listed(1, -0.5)), NO_RT_FAULTS) as RunningTransition;
    expect(r.timing.delay).toBe(-0.5 * r.shorteningFactor);
    const pos = run(updateTransition(null, change(op(0), op(1), listed(1, 0.5)), NO_RT_FAULTS) as RunningTransition, 600);
    expect((updateTransition(pos, change(op(1), op(0), listed(1, 0.5)), NO_RT_FAULTS) as RunningTransition).timing.delay).toBe(0.5);
  });

  it('fills backwards during a positive delay (M19) and clamps the shortening factor of an overshooting easing', () => {
    const t = run(updateTransition(null, change(op(0), op(1), listed(1, 0.5)), NO_RT_FAULTS) as RunningTransition, 250);
    expect(show(sampleTransition(t, 'all', NO_RT_FAULTS)?.value as AnimatedValue)).toBe('0');
    const overshoot = cubicBezierEasing(0.5, -1, 0.5, 2);
    const o = run(updateTransition(null, change(px(2), px(50), listed(1, 0, overshoot)), NO_RT_FAULTS) as RunningTransition, 100);
    const back = updateTransition(o, change(px(50), px(2), listed(1, 0, overshoot)), NO_RT_FAULTS) as RunningTransition;
    expect(back.shorteningFactor).toBe(0);
    expect(back.timing.duration).toBe(0);
  });

  it('treats a finished transition as none: a later reversal is not shortened', () => {
    const t = run(updateTransition(null, change(op(0), op(1), listed(0.5)), NO_RT_FAULTS) as RunningTransition, 1000);
    expect(transitionFinished(t)).toBe(true);
    expect(run(t, 10)).toBe(t);
    expect(updateTransition(t, change(op(1), op(0), listed(0.5)), NO_RT_FAULTS)?.shorteningFactor).toBe(1);
  });
});

describe('held time and scripts', () => {
  it('advanceHeld is Blink\'s ms round trip: 60 steps of 1000/60 give 999.9999999999991 ms (M2); heldTimeShortcut differs', () => {
    let h = HELD_ZERO;
    for (let i = 0; i < 60; i++) h = advanceHeld(h, 1000 / 60, NO_RT_FAULTS);
    expect(h.seconds * 1000).toBe(999.9999999999991);
    let tenth = HELD_ZERO;
    let cut = HELD_ZERO;
    let differs = 0;
    for (let i = 0; i < 100; i++) {
      tenth = advanceHeld(tenth, 0.1, NO_RT_FAULTS);
      cut = advanceHeld(cut, 0.1, { ...NO_RT_FAULTS, heldTimeShortcut: true });
      if (cut.seconds !== tenth.seconds) differs++;
    }
    expect(differs).toBeGreaterThan(0);
    expect(heldFinished(h.seconds, 1)).toBe(true);
    expect(heldFinished(0.998, 1)).toBe(false);
  });

  it('one step equals N steps where the sums are exact', () => {
    let quarters = HELD_ZERO;
    for (let i = 0; i < 4; i++) quarters = advanceHeld(quarters, 250, NO_RT_FAULTS);
    expect(quarters.seconds).toBe(advanceHeld(HELD_ZERO, 1000, NO_RT_FAULTS).seconds);
  });

  it('a script reads the state value with no transition, and refuses a state index outside its states', () => {
    const states = [{ value: px(0), listing: listed(1) }, { value: px(100), listing: listed(1) }];
    const r = runTransitionScript(states, 'all', [{ kind: 'advance', state: 0, deltaMs: 10 }, { kind: 'state', state: 1, deltaMs: 0 }], NO_RT_FAULTS);
    expect(r.map((x) => [show(x.value), x.durationMs])).toEqual([['0px', null], ['0px', 1000]]);
    expect(() => runTransitionScript(states, 'all', [{ kind: 'state', state: 2, deltaMs: 0 }], NO_RT_FAULTS)).toThrow(/outside its 2 states/);
  });

  it('valuesEqual compares kind and every field', () => {
    expect(valuesEqual(px(1), op(1))).toBe(false);
    const red = { ...BASE, kind: 'color' as const, color: legacyColorFromCss(255, 0, 0, 1) };
    expect(valuesEqual(red, { ...red, color: legacyColorFromCss(255, 0, 0, 0.5) })).toBe(false);
    expect(valuesEqual(red, { ...red })).toBe(true);
  });
});
