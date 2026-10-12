// CSS animation keyframes as Blink 145 (145.0.7632.6) samples them: the property-specific keyframe group with its synthetic
// neutral ends and redundant-keyframe removal (keyframe_effect_model.cc EnsureKeyframeGroups, AddSyntheticKeyframeIfRequired,
// RemoveRedundantKeyframes, EnsureInterpolationEffectPopulated) and the segment lookup of interpolation_effect.cc
// GetActiveInterpolations. A neutral keyframe takes the element's current underlying value (css_keyframe_effect_model.cc).
import type { Easing, RtFaults } from './rt-easing.ts';
import { evaluateEasing, INFINITY, LINEAR } from './rt-easing.ts';
import type { AnimatedValue, InterpolatedValue, ValueRange } from './rt-interpolate.ts';
import { interpolateValueInRange } from './rt-interpolate.ts';
import type { SecondsTiming } from './rt-timing.ts';
import { computeSecondsTiming } from './rt-timing.ts';

/** One property-specific keyframe; a `neutral` one ignores `value` and takes the underlying value when sampled. */
export type PropertyKeyframe = {
  readonly offset: number;
  readonly value: AnimatedValue;
  readonly neutral: boolean;
  readonly easing: Easing;
};

/**
 * One property's keyframes as an @keyframes rule gives them: the keyframes that set the property, stably sorted by offset, and
 * the easing of the last keyframe at offset 0 of the whole rule (any property), else the animation's timing function.
 */
export type KeyframeGroup = {
  readonly keyframes: readonly PropertyKeyframe[];
  readonly zeroOffsetEasing: Easing;
};

/** One interpolation record: keyframes[startIndex] to keyframes[endIndex], applied for fractions in [applyFrom, applyTo). */
export type KeyframeSegment = {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly applyFrom: number;
  readonly applyTo: number;
};

function neutralAt(offset: number, easing: Easing, like: AnimatedValue): PropertyKeyframe {
  return { offset, value: like, neutral: true, easing };
}

function keyframeAt(list: readonly PropertyKeyframe[], i: number): PropertyKeyframe {
  const k = list[i];
  if (k === undefined) throw new Error(`keyframe ${i} out of range`);
  return k;
}

/** AddSyntheticKeyframeIfRequired, then RemoveRedundantKeyframes: the group's keyframes as the effect samples them. */
export function completeKeyframes(group: KeyframeGroup): PropertyKeyframe[] {
  const first = keyframeAt(group.keyframes, 0);
  const out: PropertyKeyframe[] = [];
  if (first.offset > 0) out.push(neutralAt(0, group.zeroOffsetEasing, first.value));
  for (const k of group.keyframes) out.push(k);
  const last = keyframeAt(out, out.length - 1);
  if (last.offset < 1) out.push(neutralAt(1, LINEAR, last.value));
  const kept: PropertyKeyframe[] = [];
  for (let i = 0; i < out.length; i++) {
    const offset = keyframeAt(out, i).offset;
    const interior = i > 0 && i < out.length - 1;
    if (interior && keyframeAt(out, i - 1).offset === offset && keyframeAt(out, i + 1).offset === offset) continue;
    kept.push(keyframeAt(out, i));
  }
  return kept;
}

/** KeyframeEffectModelBase::EnsureInterpolationEffectPopulated for one property's completed keyframes. */
export function keyframeSegments(keyframes: readonly PropertyKeyframe[]): KeyframeSegment[] {
  const out: KeyframeSegment[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    let startIndex = i;
    let endIndex = i + 1;
    const startOffset = keyframeAt(keyframes, startIndex).offset;
    const endOffset = keyframeAt(keyframes, endIndex).offset;
    let applyFrom = startOffset;
    let applyTo = endOffset;
    if (i === 0) {
      applyFrom = -INFINITY;
      if (endOffset === 0.0) endIndex = startIndex;
    }
    if (i === keyframes.length - 2) {
      applyTo = INFINITY;
      if (startOffset === 1.0) startIndex = endIndex;
    }
    if (applyFrom !== applyTo) out.push({ startIndex, endIndex, applyFrom, applyTo });
  }
  return out;
}

function valueOf(k: PropertyKeyframe, underlying: AnimatedValue): AnimatedValue {
  return k.neutral ? underlying : k.value;
}

/**
 * GetActiveInterpolations for one property at an iteration fraction: the last segment whose range holds the fraction, its local
 * fraction eased by the start keyframe's easing with the effect's limit direction (`before`: the before phase), then the
 * interpolation clamped to the property's value range. Null when no segment applies.
 */
export function sampleKeyframes(keyframes: readonly PropertyKeyframe[], underlying: AnimatedValue, fraction: number, before: boolean, range: ValueRange, faults: RtFaults): InterpolatedValue | null {
  let result: InterpolatedValue | null = null;
  for (const s of keyframeSegments(keyframes)) {
    if (!(fraction >= s.applyFrom && fraction < s.applyTo)) continue;
    const a = keyframeAt(keyframes, s.startIndex);
    const b = keyframeAt(keyframes, s.endIndex);
    const length = b.offset - a.offset;
    let local = length !== 0 ? (fraction - a.offset) / length : 0.0;
    if (!faults.perKeyframeEasingIgnored) local = evaluateEasing(a.easing, local, before, faults);
    result = interpolateValueInRange(valueOf(a, underlying), valueOf(b, underlying), local, range, faults);
  }
  return result;
}

/**
 * A CSS animation's value for one property at `seconds` of current time: the effect timing is linear (the animation's timing
 * function is the default keyframe easing, css_animations.cc CalculateAnimationUpdate). Null when the effect has no progress
 * (outside the active interval without a fill), so the underlying value shows.
 */
export function sampleKeyframeEffect(timing: SecondsTiming, seconds: number, group: KeyframeGroup, underlying: AnimatedValue, range: ValueRange, faults: RtFaults): InterpolatedValue | null {
  const t = computeSecondsTiming({ delay: timing.delay, duration: timing.duration, iterations: timing.iterations, direction: timing.direction, fill: timing.fill, easing: LINEAR }, seconds, faults);
  if (t.progress === null) return null;
  return sampleKeyframes(completeKeyframes(group), underlying, t.progress, t.phase === 'before', range, faults);
}

/** One block of an @keyframes rule: its offset, its own animation-timing-function if it has one, and the property's value. */
export type RuleKeyframe = {
  readonly offset: number;
  readonly hasEasing: boolean;
  readonly easing: Easing;
  /** False when the block does not set the property (it still counts for the zero-offset easing). */
  readonly sets: boolean;
  readonly value: AnimatedValue;
};

/**
 * The property's keyframe group from a rule's blocks in source order (css_animations.cc CreateKeyframeEffectModel step 6 and
 * keyframe_effect_model.cc EnsureKeyframeGroups). Blocks are stably sorted by offset and walked in reverse; a block merges
 * into a later block with the same offset and easing, and gives it the property only if no later block at that offset set it;
 * an unmerged block keeps its own value. The zero-offset easing is the last offset-0 block's. A block's easing defaults to the
 * animation's timing function.
 */
export function groupFromRule(rule: readonly RuleKeyframe[], defaultEasing: Easing): KeyframeGroup {
  // A stable sort by offset: each distinct offset in ascending order, its blocks in source order.
  const sorted: RuleKeyframe[] = [];
  let last = -INFINITY;
  while (sorted.length < rule.length) {
    let next = INFINITY;
    for (const k of rule) if (k.offset > last && k.offset < next) next = k.offset;
    for (const k of rule) if (k.offset === next) sorted.push(k);
    if (next === INFINITY) throw new Error('keyframe offsets must be finite');
    last = next;
  }
  const easings: Easing[] = [];
  for (const k of sorted) easings.push(k.hasEasing ? k.easing : defaultEasing);
  let zeroOffsetEasing = defaultEasing;
  const keyframes: PropertyKeyframe[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const k = ruleAt(sorted, i);
    const easing = easingAt(easings, i);
    if (mergesLater(sorted, easings, i)) continue;
    if (k.offset === 0) zeroOffsetEasing = easing;
    if (k.sets) {
      keyframes.push({ offset: k.offset, value: k.value, neutral: false, easing });
      continue;
    }
    // The last block at this offset that sets the property gives it to this keyframe if it merged here.
    const setter = lastSetterAt(sorted, k.offset);
    if (setter >= 0 && setter < i && easingsEqual(easingAt(easings, setter), easing)) keyframes.push({ offset: k.offset, value: ruleAt(sorted, setter).value, neutral: false, easing });
  }
  return { keyframes, zeroOffsetEasing };
}

function ruleAt(list: readonly RuleKeyframe[], i: number): RuleKeyframe {
  const k = list[i];
  if (k === undefined) throw new Error(`rule keyframe ${i} out of range`);
  return k;
}

function easingAt(list: readonly Easing[], i: number): Easing {
  const e = list[i];
  if (e === undefined) throw new Error(`keyframe easing ${i} out of range`);
  return e;
}

/** FindIndexOfMatchingKeyframe: a later block with the same offset and easing absorbs this one. */
function mergesLater(sorted: readonly RuleKeyframe[], easings: readonly Easing[], i: number): boolean {
  for (let j = i + 1; j < sorted.length; j++) if (ruleAt(sorted, j).offset === ruleAt(sorted, i).offset && easingsEqual(easingAt(easings, j), easingAt(easings, i))) return true;
  return false;
}

/** The index of the last block at the offset that sets the property, or -1. */
function lastSetterAt(sorted: readonly RuleKeyframe[], offset: number): number {
  let found = -1;
  for (let j = 0; j < sorted.length; j++) if (ruleAt(sorted, j).offset === offset && ruleAt(sorted, j).sets) found = j;
  return found;
}

/** Timing-function equality, as FindIndexOfMatchingKeyframe compares keyframe easings. */
export function easingsEqual(a: Easing, b: Easing): boolean {
  if (a.kind !== b.kind || a.steps !== b.steps || a.position !== b.position) return false;
  const x = a.bezier;
  const y = b.bezier;
  if (x === null) return y === null;
  if (y === null) return false;
  return x.x1 === y.x1 && x.y1 === y.y1 && x.x2 === y.x2 && x.y2 === y.y2;
}
