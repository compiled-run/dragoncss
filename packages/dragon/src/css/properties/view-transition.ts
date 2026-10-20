// css-view-transitions-2: view-transition-name and view-transition-class (initial none) and view-transition-group (normal), none
// inherited (Chrome 145 css_properties.json5). They take part only in a view transition, which Dragon does not run: a name captures
// the box into a transition's pseudo-element tree, and the class and group style and nest those pseudo-elements. So Dragon accepts
// the initial values, where Chrome renders the box as with the properties absent, and the UA sheet's view-transition-name: root on
// the root element, which names it only for a transition, and refuses every other value (analysis/scroll-containment.ts). Rows are proven by the computed value, as no layout lane reads them.
import type { PropertyAspect } from '../properties.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial } from './initial-only.ts';

export const VIEW_TRANSITION_LONGHANDS = ['view-transition-name', 'view-transition-class', 'view-transition-group'] as const;
export const VIEW_TRANSITION_SHORTHANDS = [] as const;
export const VIEW_TRANSITION_INHERITED: readonly (typeof VIEW_TRANSITION_LONGHANDS)[number][] = [];
export const VIEW_TRANSITION_CONTAINER: readonly (typeof VIEW_TRANSITION_LONGHANDS)[number][] = [];
export const VIEW_TRANSITION_TEXT_ROLE: readonly (typeof VIEW_TRANSITION_LONGHANDS)[number][] = [];

type ViewTransitionLonghand = (typeof VIEW_TRANSITION_LONGHANDS)[number];

const PAINT_ONLY: PropertyAspect = { layout: false, paint: true };
export const VIEW_TRANSITION_ASPECTS = Object.fromEntries(VIEW_TRANSITION_LONGHANDS.map((p) => [p, PAINT_ONLY])) as { readonly [P in ViewTransitionLonghand]: PropertyAspect };

/** Each longhand's initial value, the only one Dragon accepts. */
export const VIEW_TRANSITION_INITIAL: { readonly [P in ViewTransitionLonghand]: CssValue } = {
  'view-transition-name': kwInitial('none'),
  'view-transition-class': kwInitial('none'),
  'view-transition-group': kwInitial('normal'),
};

export const VIEW_TRANSITION_VALUE_PARSERS = Object.fromEntries(VIEW_TRANSITION_LONGHANDS.map((p) => [p, initialOnlyLonghand(p, VIEW_TRANSITION_INITIAL[p])])) as { readonly [P in ViewTransitionLonghand]: InitialOnlyParser };
