// field-sizing (css-ui-4 §7.5): fixed | content, initial fixed, not inherited, one keyword computed as specified (Chrome 145
// css_properties.json5 field_template keyword). content sizes a form control (a text input, textarea or select) to its contents
// instead of its default preferred size; Chrome applies it to those controls alone. Dragon builds no form control yet, so on every
// element it lays out field-sizing changes nothing, and both keywords compile; analysis/field-sizing.ts refuses content on a
// replaced element (img, iframe, svg), whose sizing no case proves it leaves alone. The grammar is webref's, which lists exactly
// Chrome 145's keywords.
import type { ResolvedElement, ResolvedValue } from '../../analysis/resolve.ts';
import type { PropertyAspect } from '../properties.ts';

export const FIELD_SIZING_LONGHANDS = ['field-sizing'] as const;
export const FIELD_SIZING_SHORTHANDS = [] as const;
export const FIELD_SIZING_INHERITED: readonly (typeof FIELD_SIZING_LONGHANDS)[number][] = [];
export const FIELD_SIZING_CONTAINER: readonly (typeof FIELD_SIZING_LONGHANDS)[number][] = [];
export const FIELD_SIZING_TEXT_ROLE: readonly (typeof FIELD_SIZING_LONGHANDS)[number][] = [];

// Without a form control it neither lays out nor paints anything differently.
export const FIELD_SIZING_ASPECTS: { readonly [P in (typeof FIELD_SIZING_LONGHANDS)[number]]: PropertyAspect } = {
  'field-sizing': { layout: false, paint: false },
};

/** Whether an element's computed field-sizing is content. */
export function sizesToContent(el: Pick<ResolvedElement, 'props'>): boolean {
  const v = (el.props.get('field-sizing') as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' && v.value === 'content';
}
