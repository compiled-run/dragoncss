// css-values-5 §8.2 and scroll-animations-1 §4.2: interpolate-size (initial numeric-only), inherited, and timeline-scope (none), not
// inherited (Chrome 145 css_properties.json5). interpolate-size: allow-keywords lets a transition or animation interpolate to and from
// an intrinsic size keyword, and timeline-scope widens where a named scroll or view timeline can be found. Neither changes a box that
// is not animating (measured pixel-identical to the initial values in Chrome 145 at DPR 1, 2, 2.625 and 3). Dragon builds no
// scroll-driven timeline and accepts no animation-timeline but auto, so a timeline-scope name is never looked up, and every value is
// accepted. Native interpolates no intrinsic size keyword, so it refuses allow-keywords where a transition or animation of a sizing
// longhand meets a keyword (analysis/animations.ts refuseKeywordSizeInterpolation); everywhere else both values are accepted. Rows
// are proven by the computed value, as no layout lane reads them.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { dashedIdentListLonghand, keywordLonghand, kwInitial } from './initial-only.ts';

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

export const ANIMATION_EXTRA_VALUE_PARSERS: { readonly [P in AnimationExtraLonghand]: InitialOnlyParser } = {
  // Chrome 145 parses numeric-only and allow-keywords and drops any other value.
  'interpolate-size': (tokens, base) => {
    const parsed = keywordLonghand('interpolate-size', ANIMATION_EXTRA_INITIAL['interpolate-size'], ['numeric-only', 'allow-keywords'])(tokens, base);
    return parsed.kind === 'ok' ? { kind: 'ok', longhands: parsed.longhands.map((lh) => (lh.value.kind === 'keyword' ? lh : { ...lh, value: kwInitial('allow-keywords') })) } : parsed;
  },
  // Chrome 145 parses none and <dashed-ident>#, and drops all.
  'timeline-scope': dashedIdentListLonghand('timeline-scope', ANIMATION_EXTRA_INITIAL['timeline-scope']),
};
