// The web-animations timing model as Blink computes it at Chrome 145 (core/animation/timing_calculations.cc, timing.cc,
// animation_effect.cc, animation.cc). AnimationTimeDelta is a double in seconds there (blink_animation_use_time_delta = false),
// and JS milliseconds convert with ms / 1000.0, so every time here is a double in seconds.
import type { Easing, RtFaults } from './rt-easing.ts';
import { evaluateEasing, floorOf, INFINITY } from './rt-easing.ts';

export type Phase = 'before' | 'active' | 'after' | 'none';
export type FillMode = 'none' | 'forwards' | 'backwards' | 'both' | 'auto';
export type PlaybackDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

/** EffectTiming as script or CSS specifies it; times in milliseconds, iterations may be infinite. */
export type EffectTimingSpec = {
  readonly delayMs: number;
  readonly endDelayMs: number;
  readonly durationMs: number;
  readonly iterations: number;
  readonly iterationStart: number;
  readonly direction: PlaybackDirection;
  readonly fill: FillMode;
  readonly easing: Easing;
};

/** Timing::NormalizedTiming for a monotonic (document) timeline, in seconds. */
export type NormalizedTiming = {
  readonly startDelay: number;
  readonly endDelay: number;
  readonly iterationDuration: number;
  readonly activeDuration: number;
  readonly endTime: number;
};

export type ComputedTiming = {
  readonly phase: Phase;
  /** The local time after boundary snapping, in seconds; null when unresolved. */
  readonly localTime: number | null;
  readonly activeTime: number | null;
  readonly progress: number | null;
  readonly currentIteration: number | null;
};

const TIME_TOLERANCE = 0.000001;
const EPSILON = 2.0 * 2.220446049250313e-16;

export function msToSeconds(ms: number): number {
  return ms / 1000.0;
}

function maxTime(a: number, b: number): number {
  return a < b ? b : a;
}

function minTime(a: number, b: number): number {
  return b < a ? b : a;
}

function isInf(v: number): boolean {
  return v === INFINITY || v === -INFINITY;
}

function withinTolerance(a: number, b: number): boolean {
  if (isInf(a) || isInf(b)) return a === b;
  const d = a >= b ? a - b : b - a;
  return d <= TIME_TOLERANCE;
}

function withinEpsilon(a: number, b: number): boolean {
  const d = a - b;
  return d <= EPSILON && d >= -EPSILON;
}

/** fmod(x, m) for finite x and m > 0, exact as C fmod is. */
export function fmod(x: number, m: number): number {
  if (x < 0) return -fmod(-x, m);
  if (x < m) return x;
  let r = x;
  let d = m;
  while (d <= r / 2) d = d * 2;
  while (d >= m) {
    if (r >= d) r = r - d;
    d = d / 2;
  }
  return r;
}

function multiplyZeroAlwaysGivesZero(x: number, y: number): number {
  return x === 0 || y === 0 ? 0 : x * y;
}

/** AnimationEffect::EnsureNormalizedTiming, monotonic-timeline branch. */
export function normalizeTiming(spec: EffectTimingSpec): NormalizedTiming {
  const startDelay = msToSeconds(spec.delayMs);
  const endDelay = msToSeconds(spec.endDelayMs);
  const iterationDuration = msToSeconds(spec.durationMs);
  const activeDuration = multiplyZeroAlwaysGivesZero(iterationDuration, spec.iterations);
  const endTime = maxTime(startDelay + activeDuration + endDelay, 0);
  return { startDelay, endDelay, iterationDuration, activeDuration, endTime };
}

function resolvedFill(fill: FillMode): FillMode {
  // A KeyframeEffect resolves auto to none.
  return fill === 'auto' ? 'none' : fill;
}

type PhaseAt = {
  readonly phase: Phase;
  readonly localTime: number;
};

/** TimingCalculations::CalculatePhase with forwards animation direction, not boundary aligned, endpoint exclusive. */
function calculatePhase(n: NormalizedTiming, localTime: number): PhaseAt {
  let local = localTime;
  const beforeActive = maxTime(minTime(n.startDelay, n.endTime), 0);
  if (withinTolerance(local, beforeActive)) local = beforeActive;
  if (local < beforeActive) return { phase: 'before', localTime: local };
  const activeAfter = maxTime(minTime(n.startDelay + n.activeDuration, n.endTime), 0);
  if (withinTolerance(local, activeAfter)) local = activeAfter;
  if (local > activeAfter) return { phase: 'after', localTime: local };
  if (local === activeAfter) return { phase: 'after', localTime: local };
  return { phase: 'active', localTime: local };
}

function activeTimeOf(n: NormalizedTiming, fill: FillMode, local: number, phase: Phase): number | null {
  if (phase === 'before') return fill === 'backwards' || fill === 'both' ? maxTime(local - n.startDelay, 0) : null;
  if (phase === 'active') return local - n.startDelay;
  if (phase === 'after') return fill === 'forwards' || fill === 'both' ? maxTime(0, minTime(n.activeDuration, local - n.startDelay)) : null;
  return null;
}

function isEvenIteration(currentIteration: number | null): boolean {
  if (currentIteration === null) return false;
  return isInf(currentIteration) || withinEpsilon(fmod(currentIteration, 2), 0);
}

function directionIsForwards(currentIteration: number | null, direction: PlaybackDirection): boolean {
  if (direction === 'normal') return true;
  if (direction === 'reverse') return false;
  if (direction === 'alternate') return isEvenIteration(currentIteration);
  return !isEvenIteration(currentIteration);
}

/** Timing::CalculateTimings for a KeyframeEffect at a local time in seconds (null when the animation has no current time). */
export function computeTiming(spec: EffectTimingSpec, localTimeSeconds: number | null, faults: RtFaults): ComputedTiming {
  const n = normalizeTiming(spec);
  if (localTimeSeconds === null) return { phase: 'none', localTime: null, activeTime: null, progress: null, currentIteration: null };
  const p = calculatePhase(n, localTimeSeconds);
  const phase = p.phase;
  const activeTime = activeTimeOf(n, resolvedFill(spec.fill), p.localTime, phase);
  if (activeTime === null) return { phase, localTime: p.localTime, activeTime: null, progress: null, currentIteration: null };
  // Overall progress.
  let overall = 0;
  if (withinTolerance(n.iterationDuration, 0)) {
    if (phase !== 'before') overall = spec.iterations;
  } else {
    overall = activeTime / n.iterationDuration;
  }
  overall = overall + spec.iterationStart;
  // Simple iteration progress.
  let simple = isInf(overall) ? fmod(spec.iterationStart, 1.0) : fmod(overall, 1.0);
  if (withinEpsilon(simple, 0.0) && (phase === 'active' || phase === 'after') && withinTolerance(activeTime, n.activeDuration) && !withinEpsilon(spec.iterations, 0.0)) simple = 1.0;
  // Current iteration.
  let currentIteration = 0;
  if (phase === 'after' && isInf(spec.iterations)) currentIteration = INFINITY;
  else if (simple === 1.0) {
    const f = floorOf(overall) - 1;
    currentIteration = f < 0 ? 0 : f;
  } else currentIteration = floorOf(overall);
  const forwards = directionIsForwards(currentIteration, spec.direction);
  let directed = forwards ? simple : 1 - simple;
  // Transformed progress, with the before flag.
  const before = forwards ? phase === 'before' : phase === 'after';
  if (phase === 'after') {
    if (forwards && withinEpsilon(directed, 1)) directed = 1;
    else if (!forwards && withinEpsilon(directed, 0)) directed = 0;
  }
  const progress = evaluateEasing(spec.easing, directed, before, faults);
  return { phase, localTime: p.localTime, activeTime, progress, currentIteration };
}

/**
 * An animation's play state on a document timeline: a hold time while paused, else a start time (seconds). The current time
 * is the hold time when resolved, else (timeline time - start time) * playback rate (Animation::CalculateCurrentTime).
 */
export type PlayState = {
  readonly holdTime: number | null;
  /** The timeline time at which the hold time was set. */
  readonly heldAt: number;
  readonly startTime: number | null;
  readonly playbackRate: number;
};

export function currentTimeAt(s: PlayState, timelineTime: number, faults: RtFaults): number | null {
  const hold = s.holdTime;
  if (hold !== null && !faults.holdTimeLost) return hold;
  const start = s.startTime;
  if (start !== null) return (timelineTime - start) * s.playbackRate;
  // A lost hold time runs the paused animation on from where it was held, as if it had never paused.
  if (hold !== null) return hold + (timelineTime - s.heldAt) * s.playbackRate;
  return null;
}

/** Pausing resolves the hold time to the current time and clears the start time. */
export function pauseAt(s: PlayState, timelineTime: number, faults: RtFaults): PlayState {
  return { holdTime: currentTimeAt(s, timelineTime, faults), heldAt: timelineTime, startTime: null, playbackRate: s.playbackRate };
}

/** Setting currentTime (ms) on a paused animation sets its hold time (Animation::SetCurrentTimeInternal). */
export function seekPaused(ms: number, timelineTime: number, playbackRate: number): PlayState {
  return { holdTime: msToSeconds(ms), heldAt: timelineTime, startTime: null, playbackRate };
}

/** The computed timing of an animation's effect at a timeline time (seconds since the timeline's zero time). */
export function animationTiming(spec: EffectTimingSpec, s: PlayState, timelineTime: number, faults: RtFaults): ComputedTiming {
  return computeTiming(spec, currentTimeAt(s, timelineTime, faults), faults);
}
