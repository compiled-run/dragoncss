// The transform family's 3D rendering, perspective and reference-box longhands (css-transforms-2 §5, §6 and §7, css-transforms-1 §2):
// backface-visibility (visible | hidden, initial visible), transform-style (flat | preserve-3d, initial flat), transform-box
// (content-box | border-box | fill-box | stroke-box | view-box, initial view-box), perspective (none | <length [0,∞]>, initial none) and
// perspective-origin (<position>, initial 50% 50%), none inherited. The keywords compute as specified (Chrome 145 css_properties.json5
// field_template keyword); perspective-origin parses and computes as object-position (longhands_custom.cc PerspectiveOrigin and
// ObjectPosition::ParseSingleValue both call ConsumePosition with no three-value feature). The initial values are accepted, where
// each changes nothing Dragon draws: a flat box with no perspective makes no 3D rendering context, Dragon's transforms are 2D
// (properties/transform.ts), view-box is the border box of a CSS box, and perspective-origin moves nothing without a perspective.
// backface-visibility: hidden is accepted too: no 2D transform turns a box away, so it hides nothing, and the paint layer of its own
// that Blink gives the box is drawn in the paint order (lower/paint/stacking.ts, a normal-flow layer). computed-checks refuses every
// other value on every target (checkTransformExtra), and hidden on an inline box: preserve-3d and a perspective make a stacking
// context and a 3D rendering context; another reference box moves a transform's origin; another perspective-origin moves the
// vanishing point. The keyword grammars are webref's, which list exactly Chrome 145's keywords, so a value Chrome drops is dropped and
// every value it keeps is kept, then checked.
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

/** Each longhand's initial value (Chrome 145 css_properties.json5 default_value). */
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

/** Whether an element's computed backface-visibility is hidden, which gives its box a paint layer of its own (lower/paint/stacking.ts). */
export const backfaceHidden = (el: { readonly props: ReadonlyMap<string, { readonly value: CssValue }> }): boolean => {
  const v = el.props.get('backface-visibility')?.value;
  return v !== undefined && v.kind === 'keyword' && v.value === 'hidden';
};
