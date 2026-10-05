// The box: inline base direction, box sizing, sizes, the preferred aspect ratio, margins and padding (css-writing-modes-4, css-sizing-3 and 4, css-box-4),
// and how a replaced element's content fills its box (css-images-3 §5.5 object-fit, §5.6 object-position).
import type { PropertyAspect } from '../properties.ts';

export const BOX_LONGHANDS = [
  'direction', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'aspect-ratio',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'object-fit', 'object-position',
] as const;
export const BOX_SHORTHANDS = ['margin', 'padding'] as const;
export const BOX_INHERITED: readonly (typeof BOX_LONGHANDS)[number][] = ['direction'];
/** direction is a container property: the element's own inline flow, text alignment and flex axes read it. */
export const BOX_CONTAINER: readonly (typeof BOX_LONGHANDS)[number][] = ['direction'];
export const BOX_TEXT_ROLE: readonly (typeof BOX_LONGHANDS)[number][] = [];

export const BOX_ASPECTS: { readonly [P in (typeof BOX_LONGHANDS)[number]]: PropertyAspect } = {
  direction: { layout: true, paint: false },
  'box-sizing': { layout: true, paint: false },
  width: { layout: true, paint: false },
  height: { layout: true, paint: false },
  'min-width': { layout: true, paint: false },
  'min-height': { layout: true, paint: false },
  'max-width': { layout: true, paint: false },
  'max-height': { layout: true, paint: false },
  'aspect-ratio': { layout: true, paint: false },
  'margin-top': { layout: true, paint: false },
  'margin-right': { layout: true, paint: false },
  'margin-bottom': { layout: true, paint: false },
  'margin-left': { layout: true, paint: false },
  'padding-top': { layout: true, paint: false },
  'padding-right': { layout: true, paint: false },
  'padding-bottom': { layout: true, paint: false },
  'padding-left': { layout: true, paint: false },
  'object-fit': { layout: false, paint: true },
  'object-position': { layout: false, paint: true },
};
