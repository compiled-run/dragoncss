// The SVG properties of what Dragon does not build yet, and the SVG rendering hints, each with its Chrome 145 initial value and
// inheritance (css_properties.json5): stop-opacity (1) of a gradient <stop>; flood-opacity (1) of <feFlood> and <feDropShadow>;
// mask-type (luminance) of a <mask>; text-anchor (start), dominant-baseline (auto), alignment-baseline (auto, where webref says
// baseline) and baseline-shift (0) of SVG text; and shape-rendering (auto), color-interpolation (srgb), color-interpolation-filters
// (linearrgb), color-rendering (auto) and buffered-rendering (auto), the hints. text-anchor, dominant-baseline, shape-rendering and
// the colour hints are inherited. None changes an HTML box or a shape Dragon draws at its initial value: Dragon draws no gradient,
// filter, mask or SVG text, and draws its shapes antialiased in sRGB, as auto and srgb ask. So it accepts the initial values alone
// and refuses every other value (analysis/scroll-containment.ts); shape-rendering: crispEdges would change how a shape is drawn.
// Rows are proven by the computed value, as no layout lane reads them.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial, numInitial, ZERO_LENGTH } from './initial-only.ts';

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

export const SVG_EXTRA_VALUE_PARSERS = Object.fromEntries(SVG_EXTRA_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, SVG_EXTRA_INITIAL[p])])) as { readonly [P in SvgExtraLonghand]: InitialOnlyParser };
