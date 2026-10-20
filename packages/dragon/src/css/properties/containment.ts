// css-contain-2 §2-§5 and css-sizing-4 §5.2: contain (initial none), content-visibility (visible), and contain-intrinsic-width,
// -height, -inline-size and -block-size (none) with the contain-intrinsic-size shorthand of -width and -height, none inherited
// (Chrome 145 css_properties.json5). Dragon does no containment yet: size containment and content-visibility change layout and skip
// painting the contents, and the intrinsic sizes apply only under size containment. So it accepts the initial values alone, where
// Chrome contains nothing, and refuses every other value (analysis/scroll-containment.ts checkContainment). Rows are proven by the
// computed value, as no layout lane reads them.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, initialOnlyShorthand, kwInitial } from './initial-only.ts';

export const CONTAINMENT_LONGHANDS = ['contain', 'content-visibility', 'contain-intrinsic-width', 'contain-intrinsic-height', 'contain-intrinsic-inline-size', 'contain-intrinsic-block-size'] as const;
export const CONTAINMENT_SHORTHANDS = ['contain-intrinsic-size'] as const;
export const CONTAINMENT_INHERITED: readonly (typeof CONTAINMENT_LONGHANDS)[number][] = [];
export const CONTAINMENT_CONTAINER: readonly (typeof CONTAINMENT_LONGHANDS)[number][] = [];
export const CONTAINMENT_TEXT_ROLE: readonly (typeof CONTAINMENT_LONGHANDS)[number][] = [];

type ContainmentLonghand = (typeof CONTAINMENT_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const CONTAINMENT_ASPECTS = Object.fromEntries(CONTAINMENT_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in ContainmentLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const CONTAINMENT_INITIAL: { readonly [P in ContainmentLonghand]: CssValue } = {
  contain: kwInitial('none'),
  'content-visibility': kwInitial('visible'),
  'contain-intrinsic-width': kwInitial('none'),
  'contain-intrinsic-height': kwInitial('none'),
  'contain-intrinsic-inline-size': kwInitial('none'),
  'contain-intrinsic-block-size': kwInitial('none'),
};

export const CONTAINMENT_VALUE_PARSERS: { readonly [P in ContainmentLonghand | (typeof CONTAINMENT_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(CONTAINMENT_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, CONTAINMENT_INITIAL[p])])) as { readonly [P in ContainmentLonghand]: InitialOnlyParser }),
  'contain-intrinsic-size': initialOnlyShorthand('contain-intrinsic-size', ['contain-intrinsic-width', 'contain-intrinsic-height'], kwInitial('none'), 2),
};
