// How each Dragon longhand animates in Chrome 145 (T065 R13): its interpolation kind, as data. `discrete` agrees with Chrome's
// `interpolable: false` (packages/dragon/test/data/chrome-145-interpolable.json, animation-kinds.test.ts); `smooth-unadmitted`
// interpolates in Chrome and has no rt kind or runtime writer yet. A transition or keyframe may name a property only if its
// kind is admitted on every target.
import type { Longhand } from './properties.ts';

/** A length property's value range: Chrome clamps a non-negative property's interpolated px or % at 0 (M26). */
export type LengthRange = 'all' | 'non-negative';

export type AnimationKind =
  | { readonly kind: 'discrete' }
  | { readonly kind: 'length'; readonly range: LengthRange }
  | { readonly kind: 'color' }
  | { readonly kind: 'smooth-unadmitted' };

const DISCRETE: AnimationKind = { kind: 'discrete' };
const COLOR: AnimationKind = { kind: 'color' };
const UNADMITTED: AnimationKind = { kind: 'smooth-unadmitted' };
const ALL: AnimationKind = { kind: 'length', range: 'all' };
const NON_NEGATIVE: AnimationKind = { kind: 'length', range: 'non-negative' };

export const ANIMATION_KINDS: { readonly [P in Longhand]: AnimationKind } = {
  display: DISCRETE,
  position: DISCRETE,
  top: ALL,
  right: ALL,
  bottom: ALL,
  left: ALL,
  'overflow-x': DISCRETE,
  'overflow-y': DISCRETE,
  direction: DISCRETE,
  'box-sizing': DISCRETE,
  width: NON_NEGATIVE,
  height: NON_NEGATIVE,
  'min-width': NON_NEGATIVE,
  'min-height': NON_NEGATIVE,
  'max-width': NON_NEGATIVE,
  'max-height': NON_NEGATIVE,
  'aspect-ratio': UNADMITTED,
  // REPL-a: object-fit is discrete in Chrome; object-position interpolates, and its writer is not built.
  'object-fit': DISCRETE,
  'object-position': UNADMITTED,
  // FORM-a A2: appearance is discrete in Chrome (interpolable: false in the snapshot).
  appearance: DISCRETE,
  'margin-top': ALL,
  'margin-right': ALL,
  'margin-bottom': ALL,
  'margin-left': ALL,
  'padding-top': NON_NEGATIVE,
  'padding-right': NON_NEGATIVE,
  'padding-bottom': NON_NEGATIVE,
  'padding-left': NON_NEGATIVE,
  'border-top-width': UNADMITTED,
  'border-right-width': UNADMITTED,
  'border-bottom-width': UNADMITTED,
  'border-left-width': UNADMITTED,
  'border-top-style': DISCRETE,
  'border-right-style': DISCRETE,
  'border-bottom-style': DISCRETE,
  'border-left-style': DISCRETE,
  'border-top-color': COLOR,
  'border-right-color': COLOR,
  'border-bottom-color': COLOR,
  'border-left-color': COLOR,
  'flex-direction': DISCRETE,
  'flex-wrap': DISCRETE,
  'flex-grow': UNADMITTED,
  'flex-shrink': UNADMITTED,
  'flex-basis': UNADMITTED,
  order: UNADMITTED,
  'justify-content': DISCRETE,
  'align-items': DISCRETE,
  'align-self': DISCRETE,
  'align-content': DISCRETE,
  'row-gap': NON_NEGATIVE,
  'column-gap': NON_NEGATIVE,
  'font-size': UNADMITTED,
  'font-family': DISCRETE,
  'line-height': UNADMITTED,
  'text-align': DISCRETE,
  'white-space-collapse': DISCRETE,
  'text-wrap-mode': DISCRETE,
  color: COLOR,
  'background-color': COLOR,
  'grid-template-columns': UNADMITTED,
  'grid-template-rows': UNADMITTED,
  'grid-template-areas': DISCRETE,
  'grid-auto-columns': DISCRETE,
  'grid-auto-rows': DISCRETE,
  'grid-auto-flow': DISCRETE,
  'grid-row-start': DISCRETE,
  'grid-row-end': DISCRETE,
  'grid-column-start': DISCRETE,
  'grid-column-end': DISCRETE,
  'justify-items': DISCRETE,
  'justify-self': DISCRETE,
  'pointer-events': DISCRETE,
  // PNT2: transform and transform-origin interpolate in Chrome; their writers come with ANIM-b2. will-change is discrete.
  transform: UNADMITTED,
  'transform-origin': UNADMITTED,
  'will-change': DISCRETE,
};

/** ANIM-b1 admits colour and length (R1, R13): kinds with an rt interpolator and a runtime writer on every target. */
export function admitted(kind: AnimationKind): boolean {
  return kind.kind === 'color' || kind.kind === 'length';
}

export function animationKind(p: Longhand): AnimationKind {
  return ANIMATION_KINDS[p];
}
