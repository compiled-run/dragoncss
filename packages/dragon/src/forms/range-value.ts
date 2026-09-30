// The value model of input[type=range], written from the HTML range state
// (https://html.spec.whatwg.org/multipage/input.html#range-state-(type=range)) and checked against the Chrome 145 captures in
// packages/dragon/test/forms/chrome-145/range-value.json and range-geometry.json. Arithmetic is Blink's Decimal (decimal.ts), so the
// serialised strings match Chrome digit for digit. Number parsing follows html_parser_idioms.cc ParseToDecimalForNumberType.
import { Decimal, dmax } from './decimal.ts';
import { NO_FORM_FAULTS } from './faults.ts';
import type { FormFaults } from './faults.ts';

/** Content attributes of the input; null when absent. */
export type RangeAttributes = {
  readonly min: string | null;
  readonly max: string | null;
  readonly step: string | null;
  readonly value: string | null;
};

export type StepRange = {
  readonly minimum: Decimal;
  readonly maximum: Decimal;
  readonly step: Decimal;
  readonly stepBase: Decimal;
  readonly hasStep: boolean;
};

const DEFAULT_STEP = Decimal.int(1);
const HALF = Decimal.fromString('0.5');
const DOUBLE_MAX = Decimal.fromString('1.7976931348623157e+308');

/** ParseToDecimalForNumberType: HTML's valid floating-point number (no leading '+', no trailing '.'), else the fallback. */
export function parseNumber(s: string | null, fallback: Decimal): Decimal {
  const str = s ?? '';
  const first = str[0] ?? '';
  if (first !== '-' && first !== '.' && !(first >= '0' && first <= '9')) return fallback;
  const value = Decimal.fromString(str);
  if (!value.isFinite()) return fallback;
  if (value.lt(DOUBLE_MAX.neg()) || value.gt(DOUBLE_MAX)) return fallback;
  return value.isZero() ? Decimal.int(0) : value;
}

function parseStep(s: string | null): Decimal {
  // HTML "the step attribute": absent, unparsable or non-positive is the default step (1 x step scale factor 1); "any" is no step.
  if (s === null) return DEFAULT_STEP;
  if (s.toLowerCase() === 'any') return Decimal.nan();
  const step = parseNumber(s, Decimal.nan());
  return step.isNaN() || !step.gt(Decimal.zero()) ? DEFAULT_STEP : step;
}

export function stepRange(attrs: RangeAttributes): StepRange {
  // HTML range state: the default minimum is 0 and the default maximum 100. A maximum below the minimum is treated as the minimum.
  const minimum = parseNumber(attrs.min, Decimal.int(0));
  const maximum = dmax(parseNumber(attrs.max, Decimal.int(100)), minimum);
  const step = parseStep(attrs.step);
  // HTML "step base": the min attribute when it converts to a number, else the value attribute when it does, else 0.
  const stepBase = parseNumber(attrs.min, parseNumber(attrs.value, Decimal.int(0)));
  return { minimum, maximum, step: step.isNaN() ? DEFAULT_STEP : step, stepBase, hasStep: !step.isNaN() };
}

function roundByStep(r: StepRange, value: Decimal, faults: FormFaults): Decimal {
  // The nearest value step base + n x step; on an exact tie HTML picks the one nearer positive infinity.
  const steps = value.sub(r.stepBase).div(r.step);
  let n = steps.round();
  if (steps.sub(n).abs().eq(HALF)) {
    if (!faults.stepTieDown && n.lt(steps)) n = n.add(Decimal.int(1));
    if (faults.stepTieDown && n.gt(steps)) n = n.sub(Decimal.int(1));
  }
  return r.stepBase.add(n.mul(r.step));
}

export function clampValue(r: StepRange, value: Decimal, faults: FormFaults = NO_FORM_FAULTS): Decimal {
  // HTML sanitisation: underflow becomes the minimum, overflow the maximum, then a step mismatch rounds to an allowed value
  // that stays within [minimum, maximum]. A value equal to the minimum becomes the minimum's own Decimal, one equal to the
  // maximum stays as it is (Chrome 145 observation, range-value.json: min=10 step=any value=1e1 gives "10", max=10 gives "1e+1").
  const clamped = value.le(r.minimum) ? r.minimum : value.gt(r.maximum) ? r.maximum : value;
  if (!r.hasStep) return clamped;
  let rounded = roundByStep(r, clamped, faults);
  if (rounded.gt(r.maximum)) rounded = rounded.sub(r.step);
  if (rounded.lt(r.minimum)) rounded = rounded.add(r.step);
  // No step value inside the range: HTML leaves the value unrounded (Chrome 145 observation, range-value.json: max=1 step=10 value=5 gives "1").
  return rounded.gt(r.maximum) ? clamped : rounded;
}

export function defaultValue(r: StepRange, faults: FormFaults = NO_FORM_FAULTS): Decimal {
  // HTML range state: the default value is the minimum plus half the difference between the maximum and the minimum
  // (the maximum is already raised to the minimum, so a reversed range gives the minimum).
  return clampValue(r, r.minimum.add(r.maximum.sub(r.minimum).div(Decimal.int(2))), faults);
}

function serialise(d: Decimal): string {
  if (d.isZero()) return d.negative ? '-0' : '0';
  return d.toString();
}

/** RangeInputType::SanitizeValue applied to the value attribute: the string input.value returns. */
export function rangeValue(attrs: RangeAttributes, faults: FormFaults = NO_FORM_FAULTS): string {
  const r = stepRange(attrs);
  return serialise(clampValue(r, parseNumber(attrs.value, defaultValue(r, faults)), faults));
}

export function rangeRatio(attrs: RangeAttributes, faults: FormFaults = NO_FORM_FAULTS): number {
  // Where the value sits between minimum and maximum, 0 for an empty range (the thumb position of range-geometry.ts).
  const r = stepRange(attrs);
  const span = r.maximum.sub(r.minimum);
  if (!span.gt(Decimal.zero())) return 0;
  const value = clampValue(r, parseNumber(attrs.value, defaultValue(r, faults)), faults);
  return value.sub(r.minimum).div(span).toDouble();
}
