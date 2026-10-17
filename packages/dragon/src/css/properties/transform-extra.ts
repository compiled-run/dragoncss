// The transform family's 3D rendering and reference-box longhands (css-transforms-2 §6 and §7, css-transforms-1 §2): backface-visibility
// (visible | hidden, initial visible), transform-style (flat | preserve-3d, initial flat) and transform-box (content-box | border-box |
// fill-box | stroke-box | view-box, initial view-box), none inherited, each one keyword computed as specified (Chrome 145
// css_properties.json5 field_template keyword). Only the initial values are accepted, where each changes nothing Dragon draws: a flat
// box makes no 3D rendering context, Dragon's transforms are 2D (properties/transform.ts), and view-box is the border box of a CSS
// box. computed-checks refuses every other value on every target (checkTransformExtra): hidden gives the box a paint layer of its own
// in Blink, which moves it in the paint order, and hides it (and its text) once it faces away; preserve-3d makes a
// stacking context and a 3D rendering context; another reference box moves a transform's origin. The grammar is webref's, which
// lists exactly Chrome 145's keywords, so a value Chrome drops is dropped and every value it keeps is kept, then refused.
import type { CssValue } from '../values.ts';
import type { PropertyAspect } from '../properties.ts';

export const TRANSFORM_EXTRA_LONGHANDS = ['backface-visibility', 'transform-style', 'transform-box'] as const;
export const TRANSFORM_EXTRA_SHORTHANDS = [] as const;
export const TRANSFORM_EXTRA_INHERITED: readonly (typeof TRANSFORM_EXTRA_LONGHANDS)[number][] = [];
export const TRANSFORM_EXTRA_CONTAINER: readonly (typeof TRANSFORM_EXTRA_LONGHANDS)[number][] = [];
export const TRANSFORM_EXTRA_TEXT_ROLE: readonly (typeof TRANSFORM_EXTRA_LONGHANDS)[number][] = [];

export const TRANSFORM_EXTRA_ASPECTS: { readonly [P in (typeof TRANSFORM_EXTRA_LONGHANDS)[number]]: PropertyAspect } = {
  'backface-visibility': { layout: false, paint: true },
  'transform-style': { layout: false, paint: true },
  'transform-box': { layout: false, paint: true },
};

/** Each longhand's initial value, the only one Dragon accepts (Chrome 145 css_properties.json5 default_value). */
export const TRANSFORM_EXTRA_INITIAL: { readonly [P in (typeof TRANSFORM_EXTRA_LONGHANDS)[number]]: string } = {
  'backface-visibility': 'visible',
  'transform-style': 'flat',
  'transform-box': 'view-box',
};

/** Whether a computed value of one of the family's longhands is its initial keyword. */
export const isInitialTransformExtra = (p: (typeof TRANSFORM_EXTRA_LONGHANDS)[number], v: CssValue): boolean => v.kind === 'keyword' && v.value === TRANSFORM_EXTRA_INITIAL[p];
