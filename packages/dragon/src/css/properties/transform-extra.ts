// The transform family's 3D rendering, perspective and reference-box longhands (css-transforms-2 §5, §6 and §7, css-transforms-1 §2):
// backface-visibility (visible | hidden, initial visible), transform-style (flat | preserve-3d, initial flat), transform-box
// (content-box | border-box | fill-box | stroke-box | view-box, initial view-box), perspective (none | <length [0,∞]>, initial none) and
// perspective-origin (<position>, initial 50% 50%), none inherited. The keywords compute as specified (Chrome 145 css_properties.json5
// field_template keyword); perspective-origin parses and computes as object-position (longhands_custom.cc PerspectiveOrigin and
// ObjectPosition::ParseSingleValue both call ConsumePosition with no three-value feature). backface-visibility, transform-style and
// transform-box are accepted at their initial values alone, where each changes nothing Dragon draws: a flat box makes no 3D rendering
// context, Dragon's transforms are 2D (properties/transform.ts), and view-box is the border box of a CSS box. computed-checks refuses
// every other value of those on every target (checkTransformExtra), but hidden on a box whose will-change names transform, which
// already has the layers hidden adds: elsewhere hidden gives the box a paint layer and a composited layer of its own in Blink, which
// move it in the paint order and change its raster, and hides it (and its text) once it faces away; preserve-3d makes a stacking
// context and a 3D rendering context; another reference box moves a transform's origin. perspective and perspective-origin are
// accepted at any value: over 2D transforms a perspective is an identity transform, a stacking context and containing block like a
// transform, refused where a transform is (paint-values/transform.ts). The keyword grammars are webref's, which list exactly Chrome
// 145's keywords, so a value Chrome drops is dropped and every value it keeps is kept, then refused.
import type { CssValue, PositionOffset } from '../values.ts';
import type { PropertyAspect } from '../properties.ts';

export const TRANSFORM_EXTRA_LONGHANDS = ['backface-visibility', 'transform-style', 'transform-box', 'perspective', 'perspective-origin'] as const;
export const TRANSFORM_EXTRA_SHORTHANDS = [] as const;
export const TRANSFORM_EXTRA_INHERITED: readonly (typeof TRANSFORM_EXTRA_LONGHANDS)[number][] = [];
export const TRANSFORM_EXTRA_CONTAINER: readonly (typeof TRANSFORM_EXTRA_LONGHANDS)[number][] = [];
export const TRANSFORM_EXTRA_TEXT_ROLE: readonly (typeof TRANSFORM_EXTRA_LONGHANDS)[number][] = [];

export const TRANSFORM_EXTRA_ASPECTS: { readonly [P in (typeof TRANSFORM_EXTRA_LONGHANDS)[number]]: PropertyAspect } = {
  'backface-visibility': { layout: false, paint: true },
  'transform-style': { layout: false, paint: true },
  'transform-box': { layout: false, paint: true },
  perspective: { layout: false, paint: true },
  'perspective-origin': { layout: false, paint: true },
};

/** Each longhand's initial value, the only one Dragon accepts (Chrome 145 css_properties.json5 default_value). */
export const TRANSFORM_EXTRA_INITIAL: { readonly [P in (typeof TRANSFORM_EXTRA_LONGHANDS)[number]]: string } = {
  'backface-visibility': 'visible',
  'transform-style': 'flat',
  'transform-box': 'view-box',
  perspective: 'none',
  'perspective-origin': '50% 50%',
};

const isCenter = (o: PositionOffset): boolean => o.unit === '%' && o.value === 50;

/** Whether a computed value of one of the family's longhands is its initial value: the keyword, or 50% 50% for perspective-origin. */
export const isInitialTransformExtra = (p: (typeof TRANSFORM_EXTRA_LONGHANDS)[number], v: CssValue): boolean =>
  p === 'perspective-origin' ? v.kind === 'position' && isCenter(v.x) && isCenter(v.y) : v.kind === 'keyword' && v.value === TRANSFORM_EXTRA_INITIAL[p];
