// Floats and clearance (CSS2 §9.5): float and clear, with Chrome 145's values (Blink adds inline-start and inline-end). Dragon lays
// out a left or right float in block flow with nothing in flow beside or after it (FLT, layout float.ts; the compiler refuses the
// rest, analysis/computed-checks.ts checkFloats), keyed in the float context. Elsewhere float is proven where Chrome's float has no
// effect: on flex and grid items, which it leaves where they are, and on absolutely positioned boxes, where it computes to none
// (CSS2 §9.7). No in-flow box follows a float, so clear introduces no clearance; clear on a float is refused.
import type { PropertyAspect } from '../properties.ts';

export const FLOAT_LONGHANDS = ['float', 'clear'] as const;
export const FLOAT_SHORTHANDS = [] as const;
export const FLOAT_INHERITED: readonly (typeof FLOAT_LONGHANDS)[number][] = [];
export const FLOAT_CONTAINER: readonly (typeof FLOAT_LONGHANDS)[number][] = [];
export const FLOAT_TEXT_ROLE: readonly (typeof FLOAT_LONGHANDS)[number][] = [];

export const FLOAT_ASPECTS: { readonly [P in (typeof FLOAT_LONGHANDS)[number]]: PropertyAspect } = {
  float: { layout: true, paint: false },
  clear: { layout: true, paint: false },
};
