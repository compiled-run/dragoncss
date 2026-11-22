// The compiler's hit facts (notes/T047-runtime-spec.md RT-9, SELD-R1b): per element, its computed pointer-events, whether that
// value was inherited, and whether it carries an activation handler. The hit table itself is built from the laid-out engine
// input by packages/layout/src/rt-hit.ts hitTableOf, the same function on the host and, translated, on the device.

import type { RadiusLengthValue } from '../../lower/paint/radius.ts';

export const HIT_FACTS_VERSION = 'dragon.hit-facts/2';

/** One element's hit facts (rt-hit.ts HitFact). */
export type HitFact = {
  readonly pointerEvents: 'auto' | 'none';
  readonly inherited: boolean;
  readonly activation: boolean;
  /** The eight border-radius components when any corner is rounded (rt-hit.ts tests the rounded border box), else empty. */
  readonly radii: readonly RadiusLengthValue[];
};
