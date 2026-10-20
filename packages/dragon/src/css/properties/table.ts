// The table properties (CSS2 §17, css-tables-3): border-collapse, the border-spacing shorthand of Blink's two spacing longhands
// (Blink BorderSpacing), caption-side, empty-cells and table-layout, in css_properties.json5 order. Each applies
// only to a table, table cell or table caption box, and Dragon builds none (display: table* and the table tags are refused), so on
// every box Dragon compiles they change nothing and every value Chrome parses is accepted. All but table-layout are inherited.
import type { PropertyAspect } from '../properties.ts';

export const TABLE_LONGHANDS = ['border-collapse', '-webkit-border-horizontal-spacing', '-webkit-border-vertical-spacing', 'caption-side', 'empty-cells', 'table-layout'] as const;
export const TABLE_SHORTHANDS = ['border-spacing'] as const;
export const TABLE_INHERITED: readonly (typeof TABLE_LONGHANDS)[number][] = ['border-collapse', '-webkit-border-horizontal-spacing', '-webkit-border-vertical-spacing', 'caption-side', 'empty-cells'];
export const TABLE_CONTAINER: readonly (typeof TABLE_LONGHANDS)[number][] = [];
export const TABLE_TEXT_ROLE: readonly (typeof TABLE_LONGHANDS)[number][] = [];

export const TABLE_ASPECTS: { readonly [P in (typeof TABLE_LONGHANDS)[number]]: PropertyAspect } = {
  'border-collapse': { layout: false, paint: false },
  '-webkit-border-horizontal-spacing': { layout: false, paint: false },
  '-webkit-border-vertical-spacing': { layout: false, paint: false },
  'caption-side': { layout: false, paint: false },
  'empty-cells': { layout: false, paint: false },
  'table-layout': { layout: false, paint: false },
};
