// css-overscroll-1 §2 and css-scroll-anchoring-1 §2: overscroll-behavior-x, -y, -inline and -block, the overscroll-behavior
// shorthand of -x and -y, and overflow-anchor, all initial auto and not inherited (Chrome 145 css_properties.json5). They change
// only how a user's scrolling chains to outer scrollers and whether a scroller follows content that moves above it; auto asks for
// the platform scroll view's own behaviour, which every Dragon scroll container has. No target implements the other values yet, so
// they are refused (analysis/scroll-containment.ts checkOverscroll). Rows are proven by the computed value, as for other paint-only
// families, since no layout lane reads them.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, initialOnlyShorthand, kwInitial } from './initial-only.ts';

export const OVERSCROLL_LONGHANDS = ['overscroll-behavior-x', 'overscroll-behavior-y', 'overscroll-behavior-inline', 'overscroll-behavior-block', 'overflow-anchor'] as const;
export const OVERSCROLL_SHORTHANDS = ['overscroll-behavior'] as const;
export const OVERSCROLL_INHERITED: readonly (typeof OVERSCROLL_LONGHANDS)[number][] = [];
export const OVERSCROLL_CONTAINER: readonly (typeof OVERSCROLL_LONGHANDS)[number][] = [];
export const OVERSCROLL_TEXT_ROLE: readonly (typeof OVERSCROLL_LONGHANDS)[number][] = [];

type OverscrollLonghand = (typeof OVERSCROLL_LONGHANDS)[number];

export const OVERSCROLL_ASPECTS: { readonly [P in OverscrollLonghand]: PropertyAspect } = {
  'overscroll-behavior-x': { layout: false, paint: true },
  'overscroll-behavior-y': { layout: false, paint: true },
  'overscroll-behavior-inline': { layout: false, paint: true },
  'overscroll-behavior-block': { layout: false, paint: true },
  'overflow-anchor': { layout: false, paint: true },
};

/** Each longhand's initial value, the only one Dragon accepts. */
export const OVERSCROLL_INITIAL: { readonly [P in OverscrollLonghand]: CssValue } = {
  'overscroll-behavior-x': kwInitial('auto'),
  'overscroll-behavior-y': kwInitial('auto'),
  'overscroll-behavior-inline': kwInitial('auto'),
  'overscroll-behavior-block': kwInitial('auto'),
  'overflow-anchor': kwInitial('auto'),
};

export const OVERSCROLL_VALUE_PARSERS: { readonly [P in OverscrollLonghand | (typeof OVERSCROLL_SHORTHANDS)[number]]: InitialOnlyParser } = {
  ...(Object.fromEntries(OVERSCROLL_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, OVERSCROLL_INITIAL[p])])) as { readonly [P in OverscrollLonghand]: InitialOnlyParser }),
  'overscroll-behavior': initialOnlyShorthand('overscroll-behavior', ['overscroll-behavior-x', 'overscroll-behavior-y'], kwInitial('auto'), 2),
};
