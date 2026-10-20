// The SVG properties of what Dragon does not build yet, and the SVG rendering hints, each with its Chrome 145 initial value and
// inheritance (css_properties.json5): stop-opacity (1) of a gradient <stop>; flood-opacity (1) of <feFlood> and <feDropShadow>;
// mask-type (luminance) of a <mask>; text-anchor (start), dominant-baseline (auto), alignment-baseline (auto, where webref says
// baseline) and baseline-shift (0) of SVG text; and shape-rendering (auto), color-interpolation (srgb), color-interpolation-filters
// (linearrgb), color-rendering (auto) and buffered-rendering (auto), the hints. text-anchor, dominant-baseline, shape-rendering and
// the colour hints are inherited. None changes an HTML box or a shape Dragon draws at its initial value: Dragon draws no gradient,
// filter, mask or SVG text, and draws its shapes antialiased in sRGB, as auto and srgb ask. So it accepts the initial values alone
// and refuses every other value (analysis/scroll-containment.ts); shape-rendering: crispEdges would change how a shape is drawn.
// Rows are proven by the computed value, as no layout lane reads them. A spelling Chrome 145 computes to the initial value is that
// value: stop-opacity and flood-opacity from 1 or 100% up (Chrome clamps them to [0, 1]), and baseline-shift: baseline or a zero
// length or zero length calculation (0em, calc(1px - 1px)); packages/parity/test/render-anchor-parse.test.ts pins each against Chrome.
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import { BLINK_MATH_FUNCTIONS, foldScaled, parseMath } from '../math.ts';
import type { MathNode } from '../math.ts';
import type { PropertyAspect } from '../properties.ts';
import { unitEntry } from '../units.ts';
import type { CssValue } from '../values.ts';
import { numberCalc } from './effects.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial, nonInitial, numInitial, ZERO_LENGTH } from './initial-only.ts';

export const SVG_EXTRA_LONGHANDS = ['stop-opacity', 'flood-opacity', 'mask-type', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'baseline-shift', 'shape-rendering', 'color-interpolation', 'color-interpolation-filters', 'color-rendering', 'buffered-rendering'] as const;
export const SVG_EXTRA_SHORTHANDS = [] as const;
export const SVG_EXTRA_INHERITED: readonly (typeof SVG_EXTRA_LONGHANDS)[number][] = ['text-anchor', 'dominant-baseline', 'shape-rendering', 'color-interpolation', 'color-interpolation-filters', 'color-rendering'];
export const SVG_EXTRA_CONTAINER: readonly (typeof SVG_EXTRA_LONGHANDS)[number][] = [];
export const SVG_EXTRA_TEXT_ROLE: readonly (typeof SVG_EXTRA_LONGHANDS)[number][] = [];

type SvgExtraLonghand = (typeof SVG_EXTRA_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const SVG_EXTRA_ASPECTS = Object.fromEntries(SVG_EXTRA_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in SvgExtraLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const SVG_EXTRA_INITIAL: { readonly [P in SvgExtraLonghand]: CssValue } = {
  'stop-opacity': numInitial(1),
  'flood-opacity': numInitial(1),
  'mask-type': kwInitial('luminance'),
  'text-anchor': kwInitial('start'),
  'dominant-baseline': kwInitial('auto'),
  'alignment-baseline': kwInitial('auto'),
  'baseline-shift': ZERO_LENGTH,
  'shape-rendering': kwInitial('auto'),
  'color-interpolation': kwInitial('srgb'),
  'color-interpolation-filters': kwInitial('linearrgb'),
  'color-rendering': kwInitial('auto'),
  'buffered-rendering': kwInitial('auto'),
};

/**
 * stop-opacity and flood-opacity are one <number> or <percentage>, or a calc() of numbers (SVG 2 §13.3.3, filter-effects-1 §9.2), as
 * opacity is (effects.ts parseOpacityValue); Chrome clamps the computed value to [0, 1], so from 1 or 100% up it is the initial 1.
 */
function opacityLonghand(property: 'stop-opacity' | 'flood-opacity'): InitialOnlyParser {
  return (tokens, base) => {
    const t = tokens[0];
    if (tokens.length !== 1 || t === undefined) return { kind: 'invalid', reason: `${property} is one number or percentage` };
    let v: number;
    if (t.type === 'Number') v = Number(t['value']);
    else if (t.type === 'Percentage') v = Number(t['value']) / 100;
    else {
      const calc = numberCalc(property, t, base, `Write ${property} as a number or a percentage, or a calc() of numbers.`);
      if (calc === null) return { kind: 'invalid', reason: `${property} is one number or percentage` };
      if (!('value' in calc)) return calc;
      v = calc.value;
    }
    return { kind: 'ok', longhands: [{ property, value: v >= 1 ? SVG_EXTRA_INITIAL[property] : nonInitial(tokens), explicit: true }] };
  };
}

/** Whether a calculation is a zero length whatever the font and viewport: no percentage, and zero under two unrelated unit scales. */
function zeroLengthCalc(t: CssNode): boolean {
  if (t.type !== 'Function' || !BLINK_MATH_FUNCTIONS.has(asciiLower(String(t['name'])))) return false;
  const parsed = parseMath(generate(t), { type: 'length', percent: true });
  if (!parsed.ok) return false;
  const percent = (n: MathNode): boolean => (n.t === 'lit' ? n.unit === '%' : n.args.some(percent));
  if (percent(parsed.node)) return false;
  const scale = (salt: number) => (unit: string): number => (unit === 'px' || unit === '' ? 1 : 1 + [...unit].reduce((h, c) => (h * 31 + c.charCodeAt(0) * salt) % 9973, 7) / 997);
  return foldScaled(parsed.node, scale(3)) === 0 && foldScaled(parsed.node, scale(11)) === 0;
}

/**
 * baseline-shift: baseline, a zero number or length in any registered unit (0em computes to 0px) and a zero length calculation
 * compute to the initial 0px in Chrome 145; a zero percentage computes to 0%, which is kept and refused, as is any other value.
 */
const parseBaselineShift: InitialOnlyParser = (tokens) => {
  const t = tokens[0];
  if (t === undefined) return { kind: 'invalid', reason: 'baseline-shift needs a value' };
  const zero = tokens.length === 1 && ((t.type === 'Identifier' && asciiLower(String(t['name'])) === 'baseline') || (t.type === 'Number' && Number(t['value']) === 0)
    || (t.type === 'Dimension' && Number(t['value']) === 0 && unitEntry(asciiLower(String(t['unit']))) !== null) || zeroLengthCalc(t));
  return { kind: 'ok', longhands: [{ property: 'baseline-shift', value: zero ? ZERO_LENGTH : nonInitial(tokens), explicit: true }] };
};

export const SVG_EXTRA_VALUE_PARSERS = {
  ...Object.fromEntries(SVG_EXTRA_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, SVG_EXTRA_INITIAL[p])])),
  'stop-opacity': opacityLonghand('stop-opacity'),
  'flood-opacity': opacityLonghand('flood-opacity'),
  'baseline-shift': parseBaselineShift,
} as { readonly [P in SvgExtraLonghand]: InitialOnlyParser };
