// The animation list update (T065 R11), play state on held time (R2) and the effect stack order on hand-built cases; the
// Chrome oracle comparison is in rt-faults.test.ts.
import { describe, expect, it } from 'vitest';
import type { AnimationEntry, KeyframesRule, RunningAnimation } from '../src/rt-animations.ts';
import { advanceAnimation, animationFinished, repeatedPaused, runAnimationScript, stackOrder, updateAnimations } from '../src/rt-animations.ts';
import { LINEAR, NO_RT_FAULTS } from '../src/rt-easing.ts';
import type { AnimatedValue } from '../src/rt-interpolate.ts';
import { lengthPx, serializeValue, TRANSPARENT, ZERO_PX } from '../src/rt-interpolate.ts';
import type { SecondsTiming } from '../src/rt-timing.ts';
import type { ScriptStep } from '../src/rt-transition.ts';

const BASE: AnimatedValue = { kind: 'length', number: 0, length: ZERO_PX, color: TRANSPARENT, ops: [] };
const px = (n: number): AnimatedValue => ({ ...BASE, length: lengthPx(n) });
const timing = (duration: number, iterations = Infinity): SecondsTiming => ({ delay: 0, duration, iterations, direction: 'normal', fill: 'both', easing: LINEAR });
const entry = (name: string, duration: number, paused = false, iterations = Infinity): AnimationEntry => ({ name, hasKeyframes: true, paused, timing: timing(duration, iterations) });
const ms = (list: readonly RunningAnimation[]): number[] => list.map((a) => a.held.seconds * 1000);
const adv = (list: readonly RunningAnimation[], d: number, faults = NO_RT_FAULTS): RunningAnimation[] => list.map((a) => advanceAnimation(a, d, faults));

describe('updateAnimations', () => {
  it('restarts on a name change (M17) and keeps the held time on an in-place timing change (M15)', () => {
    const a = adv(updateAnimations([], [entry('up', 1)], NO_RT_FAULTS), 300);
    expect(ms(updateAnimations(a, [entry('up', 4)], NO_RT_FAULTS))).toEqual([300]);
    expect(updateAnimations(a, [entry('up', 4)], NO_RT_FAULTS)[0]?.event).toBe('updated');
    expect(ms(updateAnimations(a, [entry('down', 1)], NO_RT_FAULTS))).toEqual([0]);
    expect(ms(updateAnimations(a, [entry('down', 1)], { ...NO_RT_FAULTS, nameChangeKeepsAnimation: true }))).toEqual([300]);
  });

  it('keeps the phase across pause and resume (M25: 5000 kept, 6000 after 1000 more, held while paused)', () => {
    let list = updateAnimations([], [entry('spin', 20, true)], NO_RT_FAULTS);
    list = adv(list, 1000);
    expect(ms(list)).toEqual([0]);
    list = adv(updateAnimations(list, [entry('spin', 20)], NO_RT_FAULTS), 5000);
    list = updateAnimations(list, [entry('spin', 20, true)], NO_RT_FAULTS);
    expect(ms(adv(list, 1000))).toEqual([5000]);
    expect(ms(adv(list, 1000, { ...NO_RT_FAULTS, pauseClockRuns: true }))).toEqual([6000]);
    expect(ms(adv(updateAnimations(list, [entry('spin', 20)], NO_RT_FAULTS), 1000))).toEqual([6000]);
    expect(ms(updateAnimations(list, [entry('spin', 20)], { ...NO_RT_FAULTS, pauseLosesPhase: true }))).toEqual([0]);
  });

  it('matches by name and occurrence, and skips none and names without keyframes', () => {
    const list = adv(updateAnimations([], [entry('up', 1), entry('down', 2), entry('up', 3)], NO_RT_FAULTS), 400);
    const next = updateAnimations(list, [entry('down', 2), { ...entry('nosuch', 1), hasKeyframes: false }, entry('none', 1), entry('up', 3)], NO_RT_FAULTS);
    expect(next.map((a) => [a.name, a.nameIndex, a.listIndex, a.held.seconds, a.timing.duration])).toEqual([['down', 0, 0, 0.4, 2], ['up', 0, 3, 0.4, 3]]);
  });

  it('does not move a finished animation, and reads the play-state list it last updated from', () => {
    const done = adv(updateAnimations([], [entry('up', 1, false, 2)], NO_RT_FAULTS), 2100);
    expect(animationFinished(done[0] as RunningAnimation)).toBe(true);
    expect(ms(adv(done, 100))).toEqual([2100]);
    expect(repeatedPaused([true, false], 3)).toBe(false);
    expect(repeatedPaused([true, false], 2)).toBe(true);
    expect(repeatedPaused([], 0)).toBe(false);
  });

  it('puts started and then updated animations on top right after a style change event, else keeps list order', () => {
    const list = adv(updateAnimations([], [entry('a', 1), entry('b', 1, true), entry('c', 1)], NO_RT_FAULTS), 100);
    const next = updateAnimations(list, [entry('a', 1), entry('b', 1), entry('c', 1), entry('d', 1)], NO_RT_FAULTS);
    expect(stackOrder(next, true).map((a) => a.name)).toEqual(['a', 'c', 'd', 'b']);
    expect(stackOrder(next, false).map((a) => a.name)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('runAnimationScript', () => {
  const rule = (name: string, from: number, to: number): KeyframesRule => ({ name, keyframes: [{ offset: 0, hasEasing: false, easing: LINEAR, sets: true, value: px(from) }, { offset: 1, hasEasing: false, easing: LINEAR, sets: true, value: px(to) }] });
  const rules = [rule('up', 0, 100)];
  const show = (v: AnimatedValue): string => serializeValue(v, 100, 100, { sin: Math.sin, cos: Math.cos });
  const step = (kind: ScriptStep['kind'], n: number): ScriptStep => (kind === 'state' ? { kind, state: n, deltaMs: 0 } : { kind, state: 0, deltaMs: n });

  it('keeps the last value when an advance changes no iteration or fraction (KeyframeEffectModelBase::Sample)', () => {
    const states = [{ base: px(5), entries: [entry('up', 1), entry('down', 1, true)] }, { base: px(5), entries: [entry('up', 1, true), entry('down', 1, true)] }];
    const r = runAnimationScript(states, [...rules, rule('down', 100, 0)], 'all', [step('advance', 250), step('state', 1), step('advance', 100)], NO_RT_FAULTS);
    // List order puts down (100px) on top; the event that pauses up puts up (25px) on top, and nothing moves after it.
    expect(r.map((x) => show(x.value))).toEqual(['100px', '25px', '25px']);
  });

  it('refuses a state index outside its states', () => {
    expect(() => runAnimationScript([{ base: px(5), entries: [] }], rules, 'all', [step('state', 1)], NO_RT_FAULTS)).toThrow(/outside its 1 states/);
  });
});
