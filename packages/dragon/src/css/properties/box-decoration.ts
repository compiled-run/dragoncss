// css-break-4 §5.4: box-decoration-break (slice | clone, initial slice, not inherited). The keywords compute as specified (Chrome 145
// css_properties.json5 lines 2691-2698, field_template keyword). It only matters where a box is fragmented: slice, the initial value,
// is how Dragon already lays out and paints a box split across lines, so it changes nothing Dragon draws. computed-checks refuses
// clone on every target (analysis/box-decoration.ts): it gives each fragment its own inline-start and inline-end padding and border,
// which moves text, and its own background, radius and shadow, none of which Dragon lays out or draws yet. webref's grammar lists
// exactly Chrome 145's keywords, so a value Chrome drops is dropped and every value it keeps is kept, then refused.
import type { CssValue } from '../values.ts';
import type { PropertyAspect } from '../properties.ts';

export const BOX_DECORATION_LONGHANDS = ['box-decoration-break'] as const;
export const BOX_DECORATION_SHORTHANDS = [] as const;
export const BOX_DECORATION_INHERITED: readonly (typeof BOX_DECORATION_LONGHANDS)[number][] = [];
export const BOX_DECORATION_CONTAINER: readonly (typeof BOX_DECORATION_LONGHANDS)[number][] = [];
export const BOX_DECORATION_TEXT_ROLE: readonly (typeof BOX_DECORATION_LONGHANDS)[number][] = [];

export const BOX_DECORATION_ASPECTS: { readonly [P in (typeof BOX_DECORATION_LONGHANDS)[number]]: PropertyAspect } = {
  'box-decoration-break': { layout: false, paint: true },
};

/** The initial value, the only one Dragon accepts (Chrome 145 css_properties.json5 default_value). */
export const BOX_DECORATION_INITIAL = 'slice';

/** Whether a computed box-decoration-break is slice. */
export const isInitialBoxDecoration = (v: CssValue): boolean => v.kind === 'keyword' && v.value === BOX_DECORATION_INITIAL;
