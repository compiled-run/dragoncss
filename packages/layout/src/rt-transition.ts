// The CSS transition update for one (element, property) as Blink 145 (145.0.7632.6) does it: a port of
// CSSAnimations::CalculateTransitionUpdateForPropertyHandle and the cancel loop of CalculateTransitionUpdate
// (core/animation/css/css_animations.cc 2461-2685 and 2765-2868). Times are seconds; a transition's held time moves only
// through advanceHeld (T065 R2).
import type { Easing, RtFaults } from './rt-easing.ts';
import { LINEAR } from './rt-easing.ts';
import type { AnimatedValue, InterpolatedValue, LegacyColor, LengthValue, TransformOp, ValueRange } from './rt-interpolate.ts';
import { interpolateValueInRange } from './rt-interpolate.ts';
import type { ComputedTiming, HeldTime, SecondsTiming } from './rt-timing.ts';
import { advanceHeld, computeSecondsTiming, HELD_ZERO, heldFinished, normalizeSeconds } from './rt-timing.ts';

/**
 * How the after-change style lists the property: 'listed' by a transition entry (the last entry naming it, with its timing),
 * 'unlisted' (a transition-property list that does not name it, `none` included), or 'initial' (no transition declared:
 * the initial `all 0s`, which keeps a running transition to the same end but starts none).
 */
export type TransitionListing = {
  readonly mode: 'listed' | 'unlisted' | 'initial';
  readonly delay: number;
  readonly duration: number;
  readonly easing: Easing;
};

/** A running CSS transition: its keyframes, its reversal record and its timing (fill backwards, one iteration). */
export type RunningTransition = {
  readonly from: AnimatedValue;
  readonly to: AnimatedValue;
  readonly reversingAdjustedStart: AnimatedValue;
  readonly shorteningFactor: number;
  readonly timing: SecondsTiming;
  readonly held: HeldTime;
};

/** One style change event for the property. */
export type TransitionChange = {
  /** False on the element's first style (no old style, or rendering not begun): no transition starts. */
  readonly hasOldStyle: boolean;
  /** The old style's base value: the before-change value when no transition runs. */
  readonly oldBase: AnimatedValue;
  readonly after: AnimatedValue;
  /** False when the pair has no smooth interpolation (a discrete pair starts nothing). */
  readonly smooth: boolean;
  readonly listing: TransitionListing;
  readonly range: ValueRange;
};

function lengthsEqual(a: LengthValue, b: LengthValue): boolean {
  return a.kind === b.kind && a.px === b.px && a.percent === b.percent;
}

function colorsEqual(a: LegacyColor, b: LegacyColor): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.alpha === b.alpha;
}

function opsEqual(a: readonly TransformOp[], b: readonly TransformOp[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (x.fn !== y.fn || !lengthsEqual(x.x, y.x) || !lengthsEqual(x.y, y.y) || x.angle !== y.angle || x.sx !== y.sx || x.sy !== y.sy) return false;
  }
  return true;
}

/** ComputedValuesEqual for one property: the computed values compare field by field. */
export function valuesEqual(a: AnimatedValue, b: AnimatedValue): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'opacity' || a.kind === 'angle') return a.number === b.number;
  if (a.kind === 'length') return lengthsEqual(a.length, b.length);
  if (a.kind === 'color') return colorsEqual(a.color, b.color);
  return opsEqual(a.ops, b.ops);
}

/** The transition's effect timing at its held time. */
export function transitionTiming(t: RunningTransition, faults: RtFaults): ComputedTiming {
  return computeSecondsTiming(t.timing, t.held.seconds, faults);
}

/** Finished: the held time reached the effect end within the time tolerance (Animation::Limited at playback rate 1). */
export function transitionFinished(t: RunningTransition): boolean {
  return heldFinished(t.held.seconds, normalizeSeconds(t.timing).endTime);
}

/** The transition's value now: its keyframes at the eased progress, clamped to the value range; null without progress. */
export function sampleTransition(t: RunningTransition, range: ValueRange, faults: RtFaults): InterpolatedValue | null {
  const p = transitionTiming(t, faults).progress;
  if (p === null) return null;
  return interpolateValueInRange(t.from, t.to, p, range, faults);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * The property's transition after a style change event: the running one kept, a new one started, or null (none, or the running
 * one cancelled, so the after-change value shows). `running` is the transition before the event; a finished one counts as none.
 */
export function updateTransition(running: RunningTransition | null, change: TransitionChange, faults: RtFaults): RunningTransition | null {
  // CalculateTransitionUpdate: without an old style nothing is listed, so every running transition is cancelled (2814-2868).
  if (!change.hasOldStyle || change.listing.mode === 'unlisted') return null;
  const active = running !== null && !transitionFinished(running) ? running : null;
  let interrupted: RunningTransition | null = null;
  let before = change.oldBase;
  if (active !== null) {
    if (valuesEqual(change.after, active.to)) return active;
    if (valuesEqual(change.after, active.reversingAdjustedStart)) interrupted = active;
    // CalculateBeforeChangeStyle: the old base with the running transition sampled at its current time.
    const now = sampleTransition(active, change.range, faults);
    if (now !== null && !now.refused) before = now.value;
  }
  if (change.listing.mode === 'initial') return null;
  if (valuesEqual(before, change.after)) return null;
  if (!change.smooth) return null;
  let delay = change.listing.delay;
  let duration = change.listing.duration;
  if (delay + duration <= 0) return null;
  let reversingAdjustedStart = before;
  let factor = 1;
  if (interrupted !== null && !faults.noReversalShortening) {
    const progress = transitionTiming(interrupted, faults).progress;
    if (progress !== null) {
      reversingAdjustedStart = interrupted.to;
      factor = clamp01(progress * interrupted.shorteningFactor + (1 - interrupted.shorteningFactor));
      duration = duration * factor;
      if (delay < 0) delay = delay * factor;
    }
  }
  const timing: SecondsTiming = { delay, duration, iterations: 1, direction: 'normal', fill: 'backwards', easing: change.listing.easing };
  return { from: before, to: change.after, reversingAdjustedStart, shorteningFactor: factor, timing, held: HELD_ZERO };
}

/** One lane step for a transition: an unfinished transition's held time moves by deltaMs (T065 R2). */
export function advanceTransition(t: RunningTransition, deltaMs: number, faults: RtFaults): RunningTransition {
  if (transitionFinished(t)) return t;
  return { from: t.from, to: t.to, reversingAdjustedStart: t.reversingAdjustedStart, shorteningFactor: t.shorteningFactor, timing: t.timing, held: advanceHeld(t.held, deltaMs, faults) };
}

/** A listing for properties a transition list does not name. */
export const UNLISTED: TransitionListing = { mode: 'unlisted', delay: 0, duration: 0, easing: LINEAR };

// ---------------------------------------------------------------------------------------------------------------------
// Scripts (T065 R2, R4): the rt oracle's and the lanes' step shape. Each 'state' step is one style change event at the
// current time; each 'advance' step moves every running transition by deltaMs.

export type ScriptStep = {
  readonly kind: 'state' | 'advance';
  readonly state: number;
  readonly deltaMs: number;
};

/** One state of a transition script: the property's base value and how the state's transition list names it. */
export type TransitionState = {
  readonly value: AnimatedValue;
  readonly listing: TransitionListing;
};

/** What a script reads after each step: the computed value, and the running transition's duration in ms (null: none). */
export type TransitionReading = {
  readonly value: AnimatedValue;
  readonly durationMs: number | null;
};

function stateAt(states: readonly TransitionState[], i: number): TransitionState {
  const s = Number.isInteger(i) ? states[i] : undefined;
  if (s === undefined) throw new Error(`transition script state ${i} is outside its ${states.length} states`);
  return s;
}

/** A transition script on one element: first style in states[0] (no transition starts), then the steps. */
export function runTransitionScript(states: readonly TransitionState[], range: ValueRange, steps: readonly ScriptStep[], faults: RtFaults): TransitionReading[] {
  let current = 0;
  let running: RunningTransition | null = null;
  const out: TransitionReading[] = [];
  for (const step of steps) {
    if (step.kind === 'state') {
      const next = stateAt(states, step.state);
      running = updateTransition(running, { hasOldStyle: true, oldBase: stateAt(states, current).value, after: next.value, smooth: true, listing: next.listing, range }, faults);
      current = step.state;
    } else if (running !== null) running = advanceTransition(running, step.deltaMs, faults);
    if (running !== null && transitionFinished(running)) running = null;
    let value = stateAt(states, current).value;
    let durationMs: number | null = null;
    if (running !== null) {
      durationMs = running.timing.duration * 1000;
      const now = sampleTransition(running, range, faults);
      if (now !== null && !now.refused) value = now.value;
    }
    out.push({ value, durationMs });
  }
  return out;
}
