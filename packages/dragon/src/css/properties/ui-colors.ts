// FORM-b (css-ui-4 §6.2, §6.3): caret-color and accent-color, both inherited, initial auto, auto | <color>. caret-color colours the
// insertion caret of editable text, and accent-color the checked parts of checkboxes, radios, ranges and progress bars. No element
// Dragon resolves is editable or a form control, so neither draws anything on a supported element and neither has a layout or paint
// aspect. Chrome 145 computes caret-color: auto to the element's color, which the capture records as a literal colour, so caret-color
// is uncaptured like the text fill colours (ua/uncaptured.ts); accent-color: auto computes as auto. Pinned against Chrome by
// packages/parity/test/ui-colors-parse.test.ts.
import type { PropertyAspect } from '../properties.ts';

export const UI_COLORS_LONGHANDS = ['caret-color', 'accent-color'] as const;
export const UI_COLORS_SHORTHANDS = [] as const;
export const UI_COLORS_INHERITED: readonly (typeof UI_COLORS_LONGHANDS)[number][] = ['caret-color', 'accent-color'];
export const UI_COLORS_CONTAINER: readonly (typeof UI_COLORS_LONGHANDS)[number][] = [];
export const UI_COLORS_TEXT_ROLE: readonly (typeof UI_COLORS_LONGHANDS)[number][] = [];

export const UI_COLORS_ASPECTS: { readonly [P in (typeof UI_COLORS_LONGHANDS)[number]]: PropertyAspect } = {
  'caret-color': { layout: false, paint: false },
  'accent-color': { layout: false, paint: false },
};
