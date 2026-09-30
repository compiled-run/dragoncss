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

function parseStep(s: string | null): Decimal {
  throw new Error('T123 clean-room: not implemented');
}

export function stepRange(attrs: RangeAttributes): StepRange {
  throw new Error('T123 clean-room: not implemented');
}

function roundByStep(r: StepRange, value: Decimal, faults: FormFaults): Decimal {
  throw new Error('T123 clean-room: not implemented');
}

export function clampValue(r: StepRange, value: Decimal, faults: FormFaults = NO_FORM_FAULTS): Decimal {
  throw new Error('T123 clean-room: not implemented');
}

export function defaultValue(r: StepRange, faults: FormFaults = NO_FORM_FAULTS): Decimal {
  throw new Error('T123 clean-room: not implemented');
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
  throw new Error('T123 clean-room: not implemented');
}
