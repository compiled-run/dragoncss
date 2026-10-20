// css-scroll-snap-1 §4-§6: the scroll-padding longhands (initial auto), the scroll-margin longhands (initial 0), each physical and
// flow-relative, their shorthands, and scroll-snap-type (none), scroll-snap-align (none) and scroll-snap-stop (normal), none
// inherited (Chrome 145 css_properties.json5). Dragon does no scroll snapping and no scrollIntoView yet, the only things these
// properties change, so it accepts the initial values alone, where Chrome snaps nothing and offsets no scroll target, and refuses
// every other value (analysis/scroll-containment.ts checkScrollSnap). The flow-relative longhands are kept apart from the physical
// ones: with only initial values accepted, a non-initial value on either name is refused, so mapping them changes no verdict.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, initialOnlyShorthand, kwInitial, ZERO_LENGTH } from './initial-only.ts';

const PADDING = ['scroll-padding-top', 'scroll-padding-right', 'scroll-padding-bottom', 'scroll-padding-left'] as const;
const PADDING_INLINE = ['scroll-padding-inline-start', 'scroll-padding-inline-end'] as const;
const PADDING_BLOCK = ['scroll-padding-block-start', 'scroll-padding-block-end'] as const;
const MARGIN = ['scroll-margin-top', 'scroll-margin-right', 'scroll-margin-bottom', 'scroll-margin-left'] as const;
const MARGIN_INLINE = ['scroll-margin-inline-start', 'scroll-margin-inline-end'] as const;
const MARGIN_BLOCK = ['scroll-margin-block-start', 'scroll-margin-block-end'] as const;

export const SCROLL_SNAP_LONGHANDS = [...PADDING, ...PADDING_INLINE, ...PADDING_BLOCK, ...MARGIN, ...MARGIN_INLINE, ...MARGIN_BLOCK, 'scroll-snap-type', 'scroll-snap-align', 'scroll-snap-stop'] as const;
export const SCROLL_SNAP_SHORTHANDS = ['scroll-padding', 'scroll-padding-inline', 'scroll-padding-block', 'scroll-margin', 'scroll-margin-inline', 'scroll-margin-block'] as const;
export const SCROLL_SNAP_INHERITED: readonly (typeof SCROLL_SNAP_LONGHANDS)[number][] = [];
export const SCROLL_SNAP_CONTAINER: readonly (typeof SCROLL_SNAP_LONGHANDS)[number][] = [];
export const SCROLL_SNAP_TEXT_ROLE: readonly (typeof SCROLL_SNAP_LONGHANDS)[number][] = [];

type ScrollSnapLonghand = (typeof SCROLL_SNAP_LONGHANDS)[number];
type ScrollSnapShorthand = (typeof SCROLL_SNAP_SHORTHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const SCROLL_SNAP_ASPECTS = Object.fromEntries(SCROLL_SNAP_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in ScrollSnapLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const SCROLL_SNAP_INITIAL = Object.fromEntries(SCROLL_SNAP_LONGHANDS.map((p) => [p, p.startsWith('scroll-padding-') ? kwInitial('auto') : p.startsWith('scroll-margin-') ? ZERO_LENGTH : kwInitial(p === 'scroll-snap-stop' ? 'normal' : 'none')])) as { readonly [P in ScrollSnapLonghand]: CssValue };

/** Each shorthand's longhands, in Chrome 145's order, and how many values it takes. */
export const SCROLL_SNAP_SHORTHAND_LONGHANDS: { readonly [S in ScrollSnapShorthand]: readonly ScrollSnapLonghand[] } = {
  'scroll-padding': PADDING,
  'scroll-padding-inline': PADDING_INLINE,
  'scroll-padding-block': PADDING_BLOCK,
  'scroll-margin': MARGIN,
  'scroll-margin-inline': MARGIN_INLINE,
  'scroll-margin-block': MARGIN_BLOCK,
};

export const SCROLL_SNAP_VALUE_PARSERS = {
  ...Object.fromEntries(SCROLL_SNAP_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, SCROLL_SNAP_INITIAL[p])])),
  ...Object.fromEntries(SCROLL_SNAP_SHORTHANDS.map((s) => {
    const longhands = SCROLL_SNAP_SHORTHAND_LONGHANDS[s];
    return [s, initialOnlyShorthand(s, longhands, SCROLL_SNAP_INITIAL[longhands[0] as ScrollSnapLonghand], longhands.length)];
  })),
} as { readonly [P in ScrollSnapLonghand | ScrollSnapShorthand]: InitialOnlyParser };
