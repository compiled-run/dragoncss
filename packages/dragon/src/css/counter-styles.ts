// The text of a list marker in the predefined counter styles GEN-c draws (T151 R14), ported from Chrome 145's
// third_party/blink/renderer/core/css/counter_style.cc:121-219 (the cyclic, numeric, alphabetic and additive algorithms) and
// :832-1012 (RangeContains, NeedsNegativeSign, GenerateFallbackRepresentation, GenerateRepresentation,
// GenerateInitialRepresentation, IndexesToString), and the UA rules in third_party/blink/renderer/core/css/ua_counter_style_map.cc:33-41,
// 170-180, 208-224 and 267-285 (both BSD, "The Chromium Authors").
// Every style here is a UA style: none has a fallback other than decimal (counter_style.h: fallback_name_ is decimal), so a value
// outside a style's range is written in decimal, and decimal's own range is every integer. Author @counter-style rules and the other
// UA styles are GEN-d1's.
// Measured against Chrome by test/markers-text.test.ts, which reads the GEN-P probe (docs/research/gen-spike/probe/family5-markers.json).
import type { GenCFaults } from '../faults/gen-c.ts';
import { GEN_C_FAULTS } from '../faults/gen-c.ts';

/** css/counter_style.cc: kCounterLengthLimit. A representation longer than this falls back. */
const COUNTER_LENGTH_LIMIT = 120;

type System = 'cyclic' | 'numeric' | 'alphabetic' | 'additive';

type CounterStyle = {
  readonly system: System;
  /** The symbols, or for additive the symbols of additiveWeights, in the same order. */
  readonly symbols: readonly string[];
  /** Additive only: the weights, strictly decreasing (CSS Counter Styles 3 §3.1.7). */
  readonly additiveWeights: readonly number[];
  /** An explicit range (inclusive bounds); null is the system's auto range (RangeContains). */
  readonly range: readonly [number, number] | null;
  /** pad: the minimum length in grapheme clusters, and the symbol that pads. */
  readonly pad: { readonly length: number; readonly symbol: string } | null;
  readonly prefix: string;
  readonly suffix: string;
};

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const LOWER = [...'abcdefghijklmnopqrstuvwxyz'];
const UPPER = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const ROMAN_WEIGHTS = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
const LOWER_ROMAN = ['m', 'cm', 'd', 'cd', 'c', 'xc', 'l', 'xl', 'x', 'ix', 'v', 'iv', 'i'];

/** counter_style.h defaults: prefix "", suffix ". ", negative "-", no pad, auto range. */
const style = (system: System, symbols: readonly string[], extra: Partial<CounterStyle> = {}): CounterStyle => ({
  system,
  symbols,
  additiveWeights: [],
  range: null,
  pad: null,
  prefix: '',
  suffix: '. ',
  ...extra,
});

const roman = (symbols: readonly string[]): CounterStyle => style('additive', symbols, { additiveWeights: ROMAN_WEIGHTS, range: [1, 3999] });

/**
 * The predefined counter styles of R14, as ua_counter_style_map.cc defines them. `extends` resolves as
 * CounterStyle::ResolveExtends does: the extending style takes every descriptor it does not set (decimal-leading-zero sets pad,
 * lower-latin and upper-latin set nothing).
 */
const DECIMAL = style('numeric', DIGITS);
const LOWER_ALPHA = style('alphabetic', LOWER);
const UPPER_ALPHA = style('alphabetic', UPPER);
export const COUNTER_STYLES = {
  decimal: DECIMAL,
  'decimal-leading-zero': { ...DECIMAL, pad: { length: 2, symbol: '0' } },
  'lower-alpha': LOWER_ALPHA,
  'lower-latin': LOWER_ALPHA,
  'upper-alpha': UPPER_ALPHA,
  'upper-latin': UPPER_ALPHA,
  'lower-roman': roman(LOWER_ROMAN),
  'upper-roman': roman(LOWER_ROMAN.map((s) => s.toUpperCase())),
  // The symbol markers: cyclic, suffix " ". GEN-c paints them as shapes (list_marker.cc), so their text is the marker's
  // accessible text only (GEN-d5).
  disc: style('cyclic', ['\u2022'], { suffix: ' ' }),
  circle: style('cyclic', ['\u25e6'], { suffix: ' ' }),
  // Chrome draws U+25A0 where the spec has U+25FE (ua_counter_style_map.cc:280).
  square: style('cyclic', ['\u25a0'], { suffix: ' ' }),
} as const satisfies Record<string, CounterStyle>;

export type CounterStyleName = keyof typeof COUNTER_STYLES;

export function isCounterStyleName(name: string): name is CounterStyleName {
  return Object.hasOwn(COUNTER_STYLES, name);
}

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

/** C++ unsigned integer division of two non-negative integers; exact in a double for 32-bit values. */
const quotient = (a: number, b: number): number => (a - (a % b)) / b;

/** CyclicAlgorithm. C++ % truncates toward zero, as JavaScript's does. */
function cyclic(value: number, n: number): number[] {
  let v = (value % n) - 1;
  if (v < 0) v += n;
  return [v];
}

/** NumericAlgorithm: 0 is the first symbol. */
function numeric(value: number, n: number): number[] {
  if (value === 0) return [0];
  const out: number[] = [];
  for (let v = value; v > 0; v = quotient(v, n)) out.push(v % n);
  return out.reverse();
}

/** AlphabeticAlgorithm: bijective base n; 0 has no representation (the range excludes it). */
function alphabetic(value: number, n: number): number[] {
  const out: number[] = [];
  for (let v = value; v > 0; ) {
    v -= 1;
    out.push(v % n);
    v = quotient(v, n);
  }
  return out.reverse();
}

/** AdditiveAlgorithm: null when the weights cannot sum to the value or the result is over the length limit. */
function additive(value: number, weights: readonly number[]): number[] | null {
  if (value === 0) return weights[weights.length - 1] === 0 ? [weights.length - 1] : null;
  const out: number[] = [];
  let v = value;
  for (let i = 0; v > 0 && i < weights.length && (weights[i] as number) > 0; i++) {
    const w = weights[i] as number;
    const repetitions = quotient(v, w);
    if (out.length + repetitions > COUNTER_LENGTH_LIMIT) return null;
    for (let r = 0; r < repetitions; r++) out.push(i);
    v %= w;
  }
  return v === 0 ? out : null;
}

/** RangeContains with an auto range for the four systems here. */
function rangeContains(s: CounterStyle, value: number, faults: GenCFaults): boolean {
  if (s.range !== null && !faults.romanNoFallback) return value >= s.range[0] && value <= s.range[1];
  switch (s.system) {
    case 'cyclic':
    case 'numeric':
      return true;
    case 'alphabetic':
      return value >= 1;
    case 'additive':
      return value >= 0;
  }
}

/** NeedsNegativeSign: every system here but cyclic. */
const needsNegativeSign = (s: CounterStyle, value: number): boolean => value < 0 && s.system !== 'cyclic';

/** GenerateInitialRepresentation: null when the value is outside the range or the algorithm has no representation. */
function initialRepresentation(s: CounterStyle, value: number, faults: GenCFaults): string | null {
  if (!rangeContains(s, value, faults)) return null;
  const abs = Math.abs(value); // unsigned in Chrome; INT_MIN's magnitude is exact in a double.
  const n = s.symbols.length;
  let indexes: number[] | null;
  switch (s.system) {
    case 'cyclic':
      indexes = cyclic(value, n);
      break;
    case 'numeric':
      indexes = numeric(abs, n);
      break;
    case 'alphabetic':
      indexes = alphabetic(abs, n);
      break;
    case 'additive':
      indexes = additive(abs, s.additiveWeights);
      break;
  }
  // IndexesToString: an empty index list is a null string, which falls back.
  if (indexes === null || indexes.length === 0) return null;
  return indexes.map((i) => s.symbols[i] as string).join('');
}

/** NumGraphemeClusters. Every symbol of the styles here is one code point that is its own grapheme cluster. */
const graphemeCount = (text: string): number => [...text].length;

/** GenerateRepresentation: the counter's text without prefix and suffix. The value is a C++ int. */
export function counterRepresentation(name: CounterStyleName, value: number, faults: GenCFaults = GEN_C_FAULTS): string {
  if (!Number.isInteger(value) || value < INT_MIN || value > INT_MAX) throw new Error(`counter value ${value} is not a 32-bit integer`);
  const s: CounterStyle = COUNTER_STYLES[name];
  const initial = initialRepresentation(s, value, faults);
  // GenerateFallbackRepresentation: every style here falls back to decimal, whose range is every integer.
  if (initial === null) return counterRepresentation('decimal', value, faults);
  const negative = needsNegativeSign(s, value);
  const length = graphemeCount(initial) + (negative ? 1 : 0);
  const pad = s.pad === null || faults.leadingZeroUnpadded ? '' : s.pad.symbol.repeat(Math.max(0, s.pad.length - length));
  return `${negative ? '-' : ''}${pad}${initial}`;
}

/**
 * The marker text of a list item (list_marker.cc ListMarker::MarkerText, kWithPrefixSuffix): the counter style's prefix,
 * representation and suffix; a symbol style takes the value 0 (kSymbol), a `<string>` list-style-type is its own text (kStaticString).
 */
export type ListStyleType = { readonly kind: 'style'; readonly name: CounterStyleName } | { readonly kind: 'string'; readonly text: string };

export function markerText(type: ListStyleType, ordinal: number, faults: GenCFaults = GEN_C_FAULTS): string {
  if (type.kind === 'string') return type.text;
  const s: CounterStyle = COUNTER_STYLES[type.name];
  const value = s.system === 'cyclic' ? 0 : ordinal;
  return `${s.prefix}${counterRepresentation(type.name, value, faults)}${s.suffix}`;
}
