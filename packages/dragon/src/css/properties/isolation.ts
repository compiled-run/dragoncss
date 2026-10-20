// isolation (compositing-1 §3.3): auto | isolate, not inherited, initial auto, computed as specified (Chrome 145
// css_properties.json5: a keyword field, auto and isolate, no alias). isolate makes a stacking context on any box, positioned or
// not (Blink ComputedStyle::HasStackingGroupingProperty, which CalculateIsStackingContextWithoutContainment reads), and otherwise
// only scopes mix-blend-mode, which Dragon refuses everywhere (it is no registered property): with no blending descendant Blink
// gives the box no effect node (paint_property_tree_builder.cc NeedsEffectIgnoringClipPathAnd2DScale) and no compositing reason, so
// it paints as opacity below 1 does in the z-index 0 layer, without the group. It makes no containing block. Every value is accepted:
// lower/paint/stacking.ts treats isolate as a stacking context creator. The keyword grammar is webref's, which lists exactly Chrome
// 145's keywords.
import type { CssValue } from '../values.ts';
import type { PropertyAspect } from '../properties.ts';

export const ISOLATION_LONGHANDS = ['isolation'] as const;
export const ISOLATION_SHORTHANDS = [] as const;
export const ISOLATION_INHERITED: readonly (typeof ISOLATION_LONGHANDS)[number][] = [];
export const ISOLATION_CONTAINER: readonly (typeof ISOLATION_LONGHANDS)[number][] = [];
export const ISOLATION_TEXT_ROLE: readonly (typeof ISOLATION_LONGHANDS)[number][] = [];

export const ISOLATION_ASPECTS: { readonly [P in (typeof ISOLATION_LONGHANDS)[number]]: PropertyAspect } = {
  isolation: { layout: false, paint: true },
};

/** Whether a computed isolation is isolate (a stacking context). */
export const isIsolate = (v: CssValue | undefined): boolean => v !== undefined && v.kind === 'keyword' && v.value === 'isolate';
