// The CSS animation list update for one element as Blink 145 (145.0.7632.6) does it: a port of
// CSSAnimations::CalculateAnimationUpdate (core/animation/css/css_animations.cc 1763-2012) with the play-state toggles of
// Animation::pause and Animation::Unpause (animation.cc), on the held-time model of T065 R2.
import type { RtFaults } from './rt-easing.ts';
import { floorOf } from './rt-easing.ts';
import type { AnimatedValue, ValueRange } from './rt-interpolate.ts';
import type { RuleKeyframe } from './rt-keyframes.ts';
import { easingsEqual, groupFromRule, sampleKeyframeEffect } from './rt-keyframes.ts';
import type { HeldTime, SecondsTiming } from './rt-timing.ts';
import { advanceHeld, computeSecondsTiming, HELD_ZERO, heldFinished, normalizeSeconds } from './rt-timing.ts';
import type { ScriptStep } from './rt-transition.ts';

/** One entry of the element's animation-name list, with its repeated longhands resolved (CSSTimingData::GetRepeated). */
export type AnimationEntry = {
  /** The animation name; 'none' entries start nothing. */
  readonly name: string;
  /** False when no @keyframes rule has the name: the entry starts nothing and cancels a running match. */
  readonly hasKeyframes: boolean;
  readonly paused: boolean;
  /** The specified timing; its easing is the animation-timing-function (the default keyframe easing). */
  readonly timing: SecondsTiming;
};

/**
 * A running CSS animation. `playStates` is the play-state list it last updated from (RunningAnimation::play_state_list);
 * `event` says what the last style change event did to it.
 */
export type RunningAnimation = {
  readonly event: 'kept' | 'started' | 'updated';
  readonly name: string;
  readonly nameIndex: number;
  readonly listIndex: number;
  readonly timing: SecondsTiming;
  readonly paused: boolean;
  readonly playStates: readonly boolean[];
  readonly held: HeldTime;
};

/** Timing equality (Timing::operator==) over the fields CSS sets. */
export function timingsEqual(a: SecondsTiming, b: SecondsTiming): boolean {
  return a.delay === b.delay && a.duration === b.duration && a.iterations === b.iterations && a.direction === b.direction && a.fill === b.fill && easingsEqual(a.easing, b.easing);
}

/** Finished: the held time at or within the time tolerance of the effect end (Animation::Limited at rate 1). */
export function animationFinished(a: RunningAnimation): boolean {
  return heldFinished(a.held.seconds, normalizeSeconds(a.timing).endTime);
}

/** CSSTimingData::GetRepeated: the list repeats to cover the index. */
export function repeatedPaused(list: readonly boolean[], i: number): boolean {
  if (list.length === 0) throw new Error('an animation play-state list is never empty');
  const k = i - floorOf(i / list.length) * list.length;
  const v = list[k];
  return v === undefined ? false : v;
}

function pausedList(entries: readonly AnimationEntry[]): boolean[] {
  const out: boolean[] = [];
  for (const e of entries) out.push(e.paused);
  return out;
}

function findRunning(running: readonly RunningAnimation[], name: string, nameIndex: number, listIndex: number, faults: RtFaults): RunningAnimation | null {
  for (const r of running) {
    if (faults.nameChangeKeepsAnimation ? r.listIndex === listIndex : r.name === name && r.nameIndex === nameIndex) return r;
  }
  return null;
}

/**
 * The element's running animations after a style change event, in animation-name order: each entry with keyframes keeps the
 * running animation of the same name and occurrence (updating its timing and play state in place, keeping its held time) or
 * starts a new one at time 0; every running animation no entry kept is cancelled.
 */
export function updateAnimations(running: readonly RunningAnimation[], entries: readonly AnimationEntry[], faults: RtFaults): RunningAnimation[] {
  const out: RunningAnimation[] = [];
  const playStates = pausedList(entries);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e === undefined) throw new Error(`animation entry ${i} out of range`);
    if (e.name === 'none' || !e.hasKeyframes) continue;
    let nameIndex = 0;
    for (let j = 0; j < i; j++) {
      const o = entries[j];
      if (o !== undefined && o.name === e.name) nameIndex++;
    }
    const existing = findRunning(running, e.name, nameIndex, i, faults);
    if (existing === null) {
      out.push({ event: 'started', name: e.name, nameIndex, listIndex: i, timing: e.timing, paused: e.paused, playStates, held: HELD_ZERO });
      continue;
    }
    const wasPaused = repeatedPaused(existing.playStates, i);
    let toggle = false;
    if (e.paused !== wasPaused) toggle = existing.paused ? !e.paused : e.paused;
    const changed = !timingsEqual(existing.timing, e.timing) || e.paused !== wasPaused || existing.name !== e.name;
    if (!changed) {
      out.push({ event: 'kept', name: existing.name, nameIndex: existing.nameIndex, listIndex: i, timing: existing.timing, paused: existing.paused, playStates: existing.playStates, held: existing.held });
      continue;
    }
    const paused = toggle ? !existing.paused : existing.paused;
    const held = toggle && faults.pauseLosesPhase ? HELD_ZERO : existing.held;
    out.push({ event: 'updated', name: e.name, nameIndex, listIndex: i, timing: e.timing, paused, playStates, held });
  }
  return out;
}

/** One lane step for an animation: only a running, unfinished animation moves (the pauseClockRuns plant moves paused ones). */
export function advanceAnimation(a: RunningAnimation, deltaMs: number, faults: RtFaults): RunningAnimation {
  if ((a.paused && !faults.pauseClockRuns) || animationFinished(a)) return a;
  return { event: a.event, name: a.name, nameIndex: a.nameIndex, listIndex: a.listIndex, timing: a.timing, paused: a.paused, playStates: a.playStates, held: advanceHeld(a.held, deltaMs, faults) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Scripts (T065 R2, R4): style change events and advances on one element's animation list.

/** An @keyframes rule as one property sees it. */
export type KeyframesRule = {
  readonly name: string;
  readonly keyframes: readonly RuleKeyframe[];
};

/** One state of an animation script: the animation list and the property's base value. */
export type AnimationState = {
  readonly entries: readonly AnimationEntry[];
  readonly base: AnimatedValue;
};

/** What a script reads after each step: the relevant animations in composite order, and the property's computed value. */
export type AnimationReading = {
  readonly names: readonly string[];
  readonly currentTimesMs: readonly number[];
  readonly playStates: readonly string[];
  readonly value: AnimatedValue;
};

function ruleNamed(rules: readonly KeyframesRule[], name: string): KeyframesRule | null {
  let found: KeyframesRule | null = null;
  for (const r of rules) if (r.name === name) found = r;
  return found;
}

/**
 * The effect stack's order: CSS animations by animation-name index (EffectStack::CompareSampledEffects through
 * Animation::HasLowerCompositeOrdering), the list's order. Right after a style change event the started and then the updated
 * animations go on top, in list order, as their inert effects do (CSSAnimations::CalculateAnimationActiveInterpolations).
 */
export function stackOrder(list: readonly RunningAnimation[], afterEvent: boolean): RunningAnimation[] {
  const out: RunningAnimation[] = [];
  for (const a of list) if (!afterEvent || a.event === 'kept') out.push(a);
  if (afterEvent) {
    for (const a of list) if (a.event === 'started') out.push(a);
    for (const a of list) if (a.event === 'updated') out.push(a);
  }
  return out;
}

/** The property's value: each animation in stack order replaces the value below it; a neutral keyframe takes the value below. */
export function composeAnimations(list: readonly RunningAnimation[], rules: readonly KeyframesRule[], base: AnimatedValue, range: ValueRange, afterEvent: boolean, faults: RtFaults): AnimatedValue {
  let value = base;
  for (const a of stackOrder(list, afterEvent)) {
    const rule = ruleNamed(rules, a.name);
    if (rule === null) continue;
    const v = sampleKeyframeEffect(a.timing, a.held.seconds, groupFromRule(rule.keyframes, a.timing.easing), value, range, faults);
    if (v !== null && v.refused) throw new Error(`@keyframes ${a.name} has values that do not interpolate`);
    if (v !== null) value = v.value;
  }
  return value;
}

/** What KeyframeEffectModelBase::Sample compares: the iteration and fraction of every animation (NaN when not in effect). */
function sampleKeys(list: readonly RunningAnimation[], faults: RtFaults): number[] {
  const out: number[] = [];
  for (const a of list) {
    const t = computeSecondsTiming(a.timing, a.held.seconds, faults);
    out.push(t.currentIteration === null ? 0 / 0 : t.currentIteration);
    out.push(t.progress === null ? 0 / 0 : t.progress);
  }
  return out;
}

function sameKeys(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x !== y && !(x !== x && y !== y)) return false;
  }
  return true;
}

/** Relevant (Animation::IsRelevant, what getAnimations returns): in the before or active phase, or in effect. */
export function animationRelevant(a: RunningAnimation, faults: RtFaults): boolean {
  const t = computeSecondsTiming(a.timing, a.held.seconds, faults);
  return t.phase === 'before' || t.phase === 'active' || t.progress !== null;
}

function stateAt(states: readonly AnimationState[], i: number): AnimationState {
  const s = Number.isInteger(i) ? states[i] : undefined;
  if (s === undefined) throw new Error(`animation script state ${i} is outside its ${states.length} states`);
  return s;
}

/**
 * An animation script on one element: first style in states[0] (its animations start at time 0), then the steps. A style
 * change event recomputes the value in event order; an advance recomputes it in list order only when some animation's
 * iteration or fraction changed (KeyframeEffectModelBase::Sample's `changed`), else the last value stays.
 */
export function runAnimationScript(states: readonly AnimationState[], rules: readonly KeyframesRule[], range: ValueRange, steps: readonly ScriptStep[], faults: RtFaults): AnimationReading[] {
  let current = 0;
  let list = updateAnimations([], stateAt(states, 0).entries, faults);
  let keys = sampleKeys(list, faults);
  let value = composeAnimations(list, rules, stateAt(states, 0).base, range, true, faults);
  const out: AnimationReading[] = [];
  for (const step of steps) {
    if (step.kind === 'state') {
      list = updateAnimations(list, stateAt(states, step.state).entries, faults);
      current = step.state;
      keys = sampleKeys(list, faults);
      value = composeAnimations(list, rules, stateAt(states, current).base, range, true, faults);
    } else {
      const moved: RunningAnimation[] = [];
      for (const a of list) moved.push(advanceAnimation(a, step.deltaMs, faults));
      list = moved;
      const now = sampleKeys(list, faults);
      if (!sameKeys(now, keys)) value = composeAnimations(list, rules, stateAt(states, current).base, range, false, faults);
      keys = now;
    }
    const names: string[] = [];
    const currentTimesMs: number[] = [];
    const playStates: string[] = [];
    for (const a of list) {
      if (!animationRelevant(a, faults)) continue;
      names.push(a.name);
      currentTimesMs.push(a.held.seconds * 1000);
      playStates.push(a.paused ? 'paused' : animationFinished(a) ? 'finished' : 'running');
    }
    out.push({ names, currentTimesMs, playStates, value });
  }
  return out;
}
