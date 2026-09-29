// The value model of input[type=range] as Chrome 145 implements it (HTML range state):
// - range_input_type.cc CreateStepRange: min default 0; max default 100 and raised to min when below it (EnsureMaximum);
//   step default 1, "any" means no stepping, an invalid or non-positive step is the default; step base from InputType::FindStepBase
//   (the min attribute when it parses, else the value attribute, else 0).
// - step_range.cc ClampValue and RoundByStep, step_range.h DefaultValue and ProportionFromValue, in Blink Decimal arithmetic.
// - html_parser_idioms.cc ParseToDecimalForNumberType and SerializeForNumberType.
import { Decimal, dmax, dmin } from './decimal.ts';
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

/** StepRange::ParseStep with kRejectAny (the sanitisation path): NaN for "any". */
function parseStep(s: string | null): Decimal {
  if (s === null || s === '') return Decimal.int(1);
  if (s.toLowerCase() === 'any') return Decimal.nan();
  const step = parseNumber(s, Decimal.nan());
  if (!step.isFinite() || step.le(Decimal.int(0))) return Decimal.int(1);
  return step.mul(Decimal.int(1));
}

export function stepRange(attrs: RangeAttributes): StepRange {
  let stepBase = parseNumber(attrs.min, Decimal.nan());
  if (!stepBase.isFinite()) stepBase = parseNumber(attrs.value, Decimal.int(0));
  const minimum = parseNumber(attrs.min, Decimal.int(0));
  const proposedMax = parseNumber(attrs.max, Decimal.int(100));
  const maximum = proposedMax.ge(minimum) ? proposedMax : minimum;
  const step = parseStep(attrs.step);
  return {
    minimum,
    maximum,
    step: step.isFinite() ? step : Decimal.int(1),
    stepBase: stepBase.isFinite() ? stepBase : Decimal.int(1),
    hasStep: step.isFinite(),
  };
}

function roundByStep(r: StepRange, value: Decimal, faults: FormFaults): Decimal {
  const q = value.sub(r.stepBase).div(r.step);
  let n = q.round();
  if (faults.stepTieDown && !q.negative && n.sub(q).abs().eq(Decimal.fromString('0.5'))) n = n.sub(Decimal.int(1));
  return r.stepBase.add(n.mul(r.step));
}

export function clampValue(r: StepRange, value: Decimal, faults: FormFaults = NO_FORM_FAULTS): Decimal {
  const inRange = dmax(r.minimum, dmin(value, r.maximum));
  if (!r.hasStep) return inRange;
  const rounded = roundByStep(r, inRange, faults);
  const clamped = rounded.gt(r.maximum) ? rounded.sub(r.step) : rounded.lt(r.minimum) ? rounded.add(r.step) : rounded;
  if (clamped.lt(r.minimum) || clamped.gt(r.maximum)) return inRange;
  return clamped;
}

export function defaultValue(r: StepRange, faults: FormFaults = NO_FORM_FAULTS): Decimal {
  return clampValue(r, r.minimum.add(r.maximum).div(Decimal.int(2)), faults);
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

/** HTMLInputElement::RatioValue: the thumb position in [0, 1] as the double layout multiplies by. */
export function rangeRatio(attrs: RangeAttributes, faults: FormFaults = NO_FORM_FAULTS): number {
  const r = stepRange(attrs);
  const value = clampValue(r, parseNumber(rangeValue(attrs, faults), defaultValue(r, faults)), faults);
  if (r.minimum.eq(r.maximum)) return 0;
  return value.sub(r.minimum).div(r.maximum.sub(r.minimum)).toDouble();
}
