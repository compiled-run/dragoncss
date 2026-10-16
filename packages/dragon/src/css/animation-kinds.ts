// How each Dragon longhand animates in Chrome 145 (T065 R13): its interpolation kind, as data. `discrete` agrees with Chrome's
// `interpolable: false` (packages/dragon/test/data/chrome-145-interpolable.json, animation-kinds.test.ts); `smooth-unadmitted`
// interpolates in Chrome and has no rt kind or runtime writer yet. A transition or keyframe may name a property only if its
// kind is admitted on every target.
// Each family's kinds live in animation-kinds/<family>.ts, spread here one line per family, sorted by family id.
import type { Longhand } from './properties.ts';
import type { AnimationKind } from './animation-kinds/kinds.ts';
import { BACKGROUND_ANIMATION } from './animation-kinds/background.ts';
import { BACKGROUND_LAYERS_ANIMATION } from './animation-kinds/background-layers.ts';
import { BORDER_ANIMATION } from './animation-kinds/border.ts';
import { BOX_ANIMATION } from './animation-kinds/box.ts';
import { CLIP_RECT_ANIMATION } from './animation-kinds/clip-rect.ts';
import { EFFECTS_ANIMATION } from './animation-kinds/effects.ts';
import { FLEX_ANIMATION } from './animation-kinds/flex.ts';
import { FLOAT_ANIMATION } from './animation-kinds/float.ts';
import { FONT_FEATURES_ANIMATION } from './animation-kinds/font-features.ts';
import { FONT_STRETCH_ANIMATION } from './animation-kinds/font-stretch.ts';
import { FONT_TUNING_ANIMATION } from './animation-kinds/font-tuning.ts';
import { FONT_VARIANT_ANIMATION } from './animation-kinds/font-variant.ts';
import { GRID_ANIMATION } from './animation-kinds/grid.ts';
import { INLINE_ANIMATION } from './animation-kinds/inline.ts';
import { LINE_CLAMP_ANIMATION } from './animation-kinds/line-clamp.ts';
import { LISTS_ANIMATION } from './animation-kinds/lists.ts';
import { LOGICAL_ANIMATION } from './animation-kinds/logical.ts';
import { OUTLINE_ANIMATION } from './animation-kinds/outline.ts';
import { OVERFLOW_ANIMATION } from './animation-kinds/overflow.ts';
import { POINTER_ANIMATION } from './animation-kinds/pointer.ts';
import { POSITION_ANIMATION } from './animation-kinds/position.ts';
import { RADIUS_ANIMATION } from './animation-kinds/radius.ts';
import { RESIZE_ANIMATION } from './animation-kinds/resize.ts';
import { SCROLLBAR_ANIMATION } from './animation-kinds/scrollbar.ts';
import { SELECTION_ANIMATION } from './animation-kinds/selection.ts';
import { SHADOW_ANIMATION } from './animation-kinds/shadow.ts';
import { SVG_ANIMATION } from './animation-kinds/svg.ts';
import { TEXT_ANIMATION } from './animation-kinds/text.ts';
import { TEXT_BREAK_ANIMATION } from './animation-kinds/text-break.ts';
import { TEXT_DECORATION_ANIMATION } from './animation-kinds/text-decoration.ts';
import { TEXT_FILL_STROKE_ANIMATION } from './animation-kinds/text-fill-stroke.ts';
import { TEXT_INDENT_ANIMATION } from './animation-kinds/text-indent.ts';
import { TEXT_OVERFLOW_ANIMATION } from './animation-kinds/text-overflow.ts';
import { TEXT_SHADOW_ANIMATION } from './animation-kinds/text-shadow.ts';
import { TEXT_SPACING_ANIMATION } from './animation-kinds/text-spacing.ts';
import { TEXT_TRANSFORM_ANIMATION } from './animation-kinds/text-transform.ts';
import { TOUCH_ACTION_ANIMATION } from './animation-kinds/touch-action.ts';
import { TRANSFORM_ANIMATION } from './animation-kinds/transform.ts';
import { VISIBILITY_ANIMATION } from './animation-kinds/visibility.ts';
import { WRITING_MODE_ANIMATION } from './animation-kinds/writing-mode.ts';

export type { AnimationKind, LengthRange } from './animation-kinds/kinds.ts';

export const ANIMATION_KINDS: { readonly [P in Longhand]: AnimationKind } = {
  ...BACKGROUND_ANIMATION,
  ...BACKGROUND_LAYERS_ANIMATION,
  ...BORDER_ANIMATION,
  ...BOX_ANIMATION,
  ...CLIP_RECT_ANIMATION,
  ...EFFECTS_ANIMATION,
  ...FLEX_ANIMATION,
  ...FLOAT_ANIMATION,
  ...FONT_FEATURES_ANIMATION,
  ...FONT_STRETCH_ANIMATION,
  ...FONT_TUNING_ANIMATION,
  ...FONT_VARIANT_ANIMATION,
  ...GRID_ANIMATION,
  ...INLINE_ANIMATION,
  ...LINE_CLAMP_ANIMATION,
  ...LISTS_ANIMATION,
  ...LOGICAL_ANIMATION,
  ...OUTLINE_ANIMATION,
  ...OVERFLOW_ANIMATION,
  ...POINTER_ANIMATION,
  ...POSITION_ANIMATION,
  ...RADIUS_ANIMATION,
  ...RESIZE_ANIMATION,
  ...SCROLLBAR_ANIMATION,
  ...SELECTION_ANIMATION,
  ...SHADOW_ANIMATION,
  ...SVG_ANIMATION,
  ...TEXT_ANIMATION,
  ...TEXT_BREAK_ANIMATION,
  ...TEXT_DECORATION_ANIMATION,
  ...TEXT_FILL_STROKE_ANIMATION,
  ...TEXT_INDENT_ANIMATION,
  ...TEXT_OVERFLOW_ANIMATION,
  ...TEXT_SHADOW_ANIMATION,
  ...TEXT_SPACING_ANIMATION,
  ...TEXT_TRANSFORM_ANIMATION,
  ...TOUCH_ACTION_ANIMATION,
  ...TRANSFORM_ANIMATION,
  ...VISIBILITY_ANIMATION,
  ...WRITING_MODE_ANIMATION,
};

/** ANIM-b1 admits colour and length (R1, R13): kinds with an rt interpolator and a runtime writer on every target. */
export function admitted(kind: AnimationKind): boolean {
  return kind.kind === 'color' || kind.kind === 'length';
}

export function animationKind(p: Longhand): AnimationKind {
  return ANIMATION_KINDS[p];
}
