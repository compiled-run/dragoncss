// Easing functions as Chrome 145 (145.0.7632.6) evaluates them: a double-precision port of gfx::CubicBezier and
// gfx::StepsTimingFunction (ui/gfx/geometry/cubic_bezier.cc, ui/gfx/animation/keyframe/timing_function.cc). No tolerance.

/** Planted faults for the rt reference (T047 §3.1); the oracle comparison must catch each one. */
export type RtFaults = {
  readonly newtonIterations3: boolean;
  readonly epsilon1e6: boolean;
  readonly noSplineGuess: boolean;
  readonly stepsIgnoreBeforeFlag: boolean;
  readonly rotateViaMatrix: boolean;
  readonly colorUnpremultiplied: boolean;
  readonly holdTimeLost: boolean;
  readonly heldTimeShortcut: boolean;
  readonly noReversalShortening: boolean;
  readonly perKeyframeEasingIgnored: boolean;
  readonly nameChangeKeepsAnimation: boolean;
  readonly pauseLosesPhase: boolean;
  readonly pauseClockRuns: boolean;
  readonly nonNegativeUnclamped: boolean;
};

export const NO_RT_FAULTS: RtFaults = {
  newtonIterations3: false,
  epsilon1e6: false,
  noSplineGuess: false,
  stepsIgnoreBeforeFlag: false,
  rotateViaMatrix: false,
  colorUnpremultiplied: false,
  holdTimeLost: false,
  heldTimeShortcut: false,
  noReversalShortening: false,
  perKeyframeEasingIgnored: false,
  nameChangeKeepsAnimation: false,
  pauseLosesPhase: false,
  pauseClockRuns: false,
  nonNegativeUnclamped: false,
};

export const INFINITY = 1 / 0;

// The rt modules' only Math rounding calls (T038 item 21 keeps rounding in audited numerics modules: units.ts and this one).

/** Math.floor. */
export function floorOf(v: number): number {
  return Math.floor(v);
}

/** Math.trunc (C++ static_cast<int> for in-range values). */
export function truncOf(v: number): number {
  return Math.trunc(v);
}

/** Math.round: half toward +infinity, equal to C round for v >= 0. */
export function roundOf(v: number): number {
  return Math.round(v);
}

/** Math.fround: the nearest float, as C++ narrows a double to float. */
export function froundOf(v: number): number {
  return Math.fround(v);
}
const DBL_MAX = 1.7976931348623157e308;
const SPLINE_SAMPLES = 11;

/** gfx::CubicBezier's precomputed state: polynomial coefficients, end gradients and the 11-sample x spline. */
export type CubicBezier = {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly ax: number;
  readonly bx: number;
  readonly cx: number;
  readonly ay: number;
  readonly by: number;
  readonly cy: number;
  readonly startGradient: number;
  readonly endGradient: number;
  readonly spline: readonly number[];
};

export type StepPosition = 'jump-start' | 'jump-end' | 'jump-none' | 'jump-both' | 'start' | 'end';

/** A timing function. `bezier` is set only for kind 'cubic-bezier'; `steps` and `position` only for kind 'steps'. */
export type Easing = {
  readonly kind: 'linear' | 'cubic-bezier' | 'steps';
  readonly bezier: CubicBezier | null;
  readonly steps: number;
  readonly position: StepPosition;
};

function toFinite(v: number): number {
  if (v === INFINITY) return DBL_MAX;
  if (v === -INFINITY) return -DBL_MAX;
  return v;
}

function absLess(v: number, eps: number): boolean {
  return v < eps && v > -eps;
}

function sampleCurveX(b: CubicBezier, t: number): number {
  return ((b.ax * t + b.bx) * t + b.cx) * t;
}

function sampleCurveY(b: CubicBezier, t: number): number {
  return toFinite(((b.ay * t + b.by) * t + b.cy) * t);
}

function sampleCurveDerivativeX(b: CubicBezier, t: number): number {
  return (3.0 * b.ax * t + 2.0 * b.bx) * t + b.cx;
}

function startGradientOf(p1x: number, p1y: number, p2x: number, p2y: number): number {
  if (p1x > 0) return p1y / p1x;
  if (p1y === 0 && p2x > 0) return p2y / p2x;
  if (p1y === 0 && p2y === 0) return 1;
  return 0;
}

function endGradientOf(p1x: number, p1y: number, p2x: number, p2y: number): number {
  if (p2x < 1) return (p2y - 1) / (p2x - 1);
  if (p2y === 1 && p1x < 1) return (p1y - 1) / (p1x - 1);
  if (p2y === 1 && p1y === 1) return 1;
  return 0;
}

/** gfx::CubicBezier(p1x, p1y, p2x, p2y). */
export function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number): CubicBezier {
  const cx = 3.0 * p1x;
  const bx = 3.0 * (p2x - p1x) - cx;
  const ax = 1.0 - cx - bx;
  const cy = toFinite(3.0 * p1y);
  const by = toFinite(3.0 * (p2y - p1y) - cy);
  const ay = toFinite(1.0 - cy - by);
  const partial: CubicBezier = { x1: p1x, y1: p1y, x2: p2x, y2: p2y, ax, bx, cx, ay, by, cy, startGradient: 0, endGradient: 0, spline: [] };
  const deltaT = 1.0 / (SPLINE_SAMPLES - 1);
  const spline: number[] = [];
  for (let i = 0; i < SPLINE_SAMPLES; i++) spline.push(sampleCurveX(partial, i * deltaT));
  return { x1: p1x, y1: p1y, x2: p2x, y2: p2y, ax, bx, cx, ay, by, cy, startGradient: startGradientOf(p1x, p1y, p2x, p2y), endGradient: endGradientOf(p1x, p1y, p2x, p2y), spline };
}

function splineAt(b: CubicBezier, i: number): number {
  const v = b.spline[i];
  if (v === undefined) throw new Error(`spline sample ${i} out of range`);
  return v;
}

/** CubicBezier::SolveCurveX: the parametric t for x in [0, 1]. */
export function solveCurveX(b: CubicBezier, x: number, epsilon: number, faults: RtFaults): number {
  const bezierEpsilon = faults.epsilon1e6 ? 1e-6 : 1e-7;
  const maxNewton = faults.newtonIterations3 ? 3 : 4;
  // Chrome leaves t0 and t1 uninitialised when no spline sample bounds x; that path returns from Newton in practice.
  let t0 = 0;
  let t1 = 1;
  let t2 = x;
  let x2 = 0;
  const deltaT = 1.0 / (SPLINE_SAMPLES - 1);
  if (!faults.noSplineGuess) {
    for (let i = 1; i < SPLINE_SAMPLES; i++) {
      if (x <= splineAt(b, i)) {
        t1 = deltaT * i;
        t0 = t1 - deltaT;
        t2 = t0 + ((t1 - t0) * (x - splineAt(b, i - 1))) / (splineAt(b, i) - splineAt(b, i - 1));
        break;
      }
    }
  }
  const newtonEpsilon = bezierEpsilon < epsilon ? bezierEpsilon : epsilon;
  for (let i = 0; i < maxNewton; i++) {
    x2 = sampleCurveX(b, t2) - x;
    if (absLess(x2, newtonEpsilon)) return t2;
    const d2 = sampleCurveDerivativeX(b, t2);
    if (absLess(d2, bezierEpsilon)) break;
    t2 = t2 - x2 / d2;
  }
  if (absLess(x2, epsilon)) return t2;
  while (t0 < t1) {
    x2 = sampleCurveX(b, t2);
    if (absLess(x2 - x, epsilon)) return t2;
    if (x > x2) t0 = t2;
    else t1 = t2;
    t2 = (t1 + t0) * 0.5;
  }
  return t2;
}

/** CubicBezier::Solve: y at x, extrapolating with the end gradients outside [0, 1]. */
export function solveBezier(b: CubicBezier, x: number, faults: RtFaults): number {
  if (x < 0.0) return toFinite(0.0 + b.startGradient * x);
  if (x > 1.0) return toFinite(1.0 + b.endGradient * (x - 1.0));
  const epsilon = faults.epsilon1e6 ? 1e-6 : 1e-7;
  return sampleCurveY(b, solveCurveX(b, x, epsilon, faults));
}

function jumpsOf(steps: number, position: StepPosition): number {
  if (position === 'jump-both') return steps + 1;
  if (position === 'jump-none') return steps - 1;
  return steps;
}

function startOffsetOf(position: StepPosition): number {
  return position === 'jump-both' || position === 'jump-start' || position === 'start' ? 1 : 0;
}

/** StepsTimingFunction::GetValue; `before` is the LEFT limit direction (css-easing-1 §3.4 before flag). */
export function evaluateSteps(steps: number, position: StepPosition, t: number, before: boolean, faults: RtFaults): number {
  let currentStep = floorOf(steps * t + startOffsetOf(position));
  if (before && !faults.stepsIgnoreBeforeFlag && steps * t - floorOf(steps * t) === 0) currentStep -= 1;
  const jumps = jumpsOf(steps, position);
  if (t >= 0 && currentStep < 0) currentStep = 0;
  if (t <= 1 && currentStep > jumps) currentStep = jumps;
  return currentStep / jumps;
}

/** TimingFunction::Evaluate(x, limit_direction). */
export function evaluateEasing(e: Easing, x: number, before: boolean, faults: RtFaults): number {
  if (e.kind === 'linear') return x;
  if (e.kind === 'steps') return evaluateSteps(e.steps, e.position, x, before, faults);
  const b = e.bezier;
  if (b === null) throw new Error('cubic-bezier easing without a curve');
  return solveBezier(b, x, faults);
}

export const LINEAR: Easing = { kind: 'linear', bezier: null, steps: 0, position: 'end' };

export function cubicBezierEasing(x1: number, y1: number, x2: number, y2: number): Easing {
  return { kind: 'cubic-bezier', bezier: cubicBezier(x1, y1, x2, y2), steps: 0, position: 'end' };
}

/** steps(n, position); jump-none needs n > 1 and every other position n > 0, as the CSS grammar requires. */
export function stepsEasing(n: number, position: StepPosition): Easing {
  if (!Number.isInteger(n) || n < 1 || (position === 'jump-none' && n < 2)) throw new Error(`steps(${n}, ${position}) is invalid`);
  return { kind: 'steps', bezier: null, steps: n, position };
}

export const EASE: Easing = cubicBezierEasing(0.25, 0.1, 0.25, 1.0);
export const EASE_IN: Easing = cubicBezierEasing(0.42, 0.0, 1.0, 1.0);
export const EASE_OUT: Easing = cubicBezierEasing(0.0, 0.0, 0.58, 1.0);
export const EASE_IN_OUT: Easing = cubicBezierEasing(0.42, 0.0, 0.58, 1);
export const STEP_START: Easing = stepsEasing(1, 'start');
export const STEP_END: Easing = stepsEasing(1, 'end');

/** The easing named by a CSS keyword, or null. */
export function easingKeyword(name: string): Easing | null {
  if (name === 'linear') return LINEAR;
  if (name === 'ease') return EASE;
  if (name === 'ease-in') return EASE_IN;
  if (name === 'ease-out') return EASE_OUT;
  if (name === 'ease-in-out') return EASE_IN_OUT;
  if (name === 'step-start') return STEP_START;
  if (name === 'step-end') return STEP_END;
  return null;
}

/** A timing function as plain data: `kind` picks which fields apply (the rt vectors and oracle use this form). */
export type EasingSpec = {
  readonly kind: 'linear' | 'cubic-bezier' | 'steps';
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly steps: number;
  readonly position: StepPosition;
};

export function easingFromSpec(s: EasingSpec): Easing {
  if (s.kind === 'linear') return LINEAR;
  if (s.kind === 'steps') return stepsEasing(s.steps, s.position);
  return cubicBezierEasing(s.x1, s.y1, s.x2, s.y2);
}
