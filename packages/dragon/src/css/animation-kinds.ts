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
import { EFFECTS_ANIMATION } from './animation-kinds/effects.ts';
import { FLEX_ANIMATION } from './animation-kinds/flex.ts';
import { GRID_ANIMATION } from './animation-kinds/grid.ts';
import { LOGICAL_ANIMATION } from './animation-kinds/logical.ts';
import { OUTLINE_ANIMATION } from './animation-kinds/outline.ts';
import { OVERFLOW_ANIMATION } from './animation-kinds/overflow.ts';
import { POINTER_ANIMATION } from './animation-kinds/pointer.ts';
import { POSITION_ANIMATION } from './animation-kinds/position.ts';
import { RADIUS_ANIMATION } from './animation-kinds/radius.ts';
import { SCROLLBAR_ANIMATION } from './animation-kinds/scrollbar.ts';
import { SHADOW_ANIMATION } from './animation-kinds/shadow.ts';
import { TEXT_ANIMATION } from './animation-kinds/text.ts';
import { TRANSFORM_ANIMATION } from './animation-kinds/transform.ts';
import { WRITING_MODE_ANIMATION } from './animation-kinds/writing-mode.ts';

export type { AnimationKind, LengthRange } from './animation-kinds/kinds.ts';

export const ANIMATION_KINDS: { readonly [P in Longhand]: AnimationKind } = {
  ...BACKGROUND_ANIMATION,
  ...BACKGROUND_LAYERS_ANIMATION,
  ...BORDER_ANIMATION,
  ...BOX_ANIMATION,
  ...EFFECTS_ANIMATION,
  ...FLEX_ANIMATION,
  ...GRID_ANIMATION,
  ...LOGICAL_ANIMATION,
  ...OUTLINE_ANIMATION,
  ...OVERFLOW_ANIMATION,
  ...POINTER_ANIMATION,
  ...POSITION_ANIMATION,
  ...RADIUS_ANIMATION,
  ...SCROLLBAR_ANIMATION,
  ...SHADOW_ANIMATION,
  ...TEXT_ANIMATION,
  ...TRANSFORM_ANIMATION,
  ...WRITING_MODE_ANIMATION,
};

/** ANIM-b1 admits colour and length (R1, R13): kinds with an rt interpolator and a runtime writer on every target. */
export function admitted(kind: AnimationKind): boolean {
  return kind.kind === 'color' || kind.kind === 'length';
}

export function animationKind(p: Longhand): AnimationKind {
  return ANIMATION_KINDS[p];
}
