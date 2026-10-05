// The interpolation kinds of animation-kinds.ts, shared by the per-family files.

/** A length property's value range: Chrome clamps a non-negative property's interpolated px or % at 0 (M26). */
export type LengthRange = 'all' | 'non-negative';

export type AnimationKind =
  | { readonly kind: 'discrete' }
  | { readonly kind: 'length'; readonly range: LengthRange }
  | { readonly kind: 'color' }
  | { readonly kind: 'smooth-unadmitted' };

export const DISCRETE: AnimationKind = { kind: 'discrete' };
export const COLOR: AnimationKind = { kind: 'color' };
export const UNADMITTED: AnimationKind = { kind: 'smooth-unadmitted' };
export const ALL: AnimationKind = { kind: 'length', range: 'all' };
export const NON_NEGATIVE: AnimationKind = { kind: 'length', range: 'non-negative' };
