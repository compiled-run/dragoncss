// css-values-5 §8.2 and scroll-animations-1 §4.2: interpolate-size (initial numeric-only), inherited, and timeline-scope (none), not
// inherited (Chrome 145 css_properties.json5). interpolate-size: allow-keywords lets a transition or animation interpolate to and from
// an intrinsic size keyword, and timeline-scope widens where a named scroll or view timeline can be found. Neither changes a box that
// is not animating, but Dragon interpolates no intrinsic size keyword and has no scroll-driven timelines, so it accepts the initial
// values alone, where Chrome animates as with the properties absent, and refuses every other value
// (analysis/scroll-containment.ts). Rows are proven by the computed value, as no layout lane reads them.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial } from './initial-only.ts';

export const ANIMATION_EXTRA_LONGHANDS = ['interpolate-size', 'timeline-scope'] as const;
export const ANIMATION_EXTRA_SHORTHANDS = [] as const;
export const ANIMATION_EXTRA_INHERITED: readonly (typeof ANIMATION_EXTRA_LONGHANDS)[number][] = ['interpolate-size'];
export const ANIMATION_EXTRA_CONTAINER: readonly (typeof ANIMATION_EXTRA_LONGHANDS)[number][] = [];
export const ANIMATION_EXTRA_TEXT_ROLE: readonly (typeof ANIMATION_EXTRA_LONGHANDS)[number][] = [];

type AnimationExtraLonghand = (typeof ANIMATION_EXTRA_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const ANIMATION_EXTRA_ASPECTS = Object.fromEntries(ANIMATION_EXTRA_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in AnimationExtraLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const ANIMATION_EXTRA_INITIAL: { readonly [P in AnimationExtraLonghand]: CssValue } = {
  'interpolate-size': kwInitial('numeric-only'),
  'timeline-scope': kwInitial('none'),
};

export const ANIMATION_EXTRA_VALUE_PARSERS = Object.fromEntries(ANIMATION_EXTRA_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, ANIMATION_EXTRA_INITIAL[p])])) as { readonly [P in AnimationExtraLonghand]: InitialOnlyParser };
