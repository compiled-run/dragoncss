// The compiler's hit facts (notes/T047-runtime-spec.md RT-9, SELD-R1b): per element, its computed pointer-events, whether that
// value was inherited, whether it carries an activation handler, whether it makes a stacking context, and its transform. The hit table itself is built from the laid-out engine
// input by packages/layout/src/rt-hit.ts hitTableOf, the same function on the host and, translated, on the device.

import type { TransformOp, TransformOrigin } from '@dragon/layout';

export const HIT_FACTS_VERSION = 'dragon.hit-facts/2';

/** One element's hit facts (rt-hit.ts HitFact). */
export type HitFact = {
  readonly pointerEvents: 'auto' | 'none';
  readonly inherited: boolean;
  readonly activation: boolean;
  readonly context: boolean;
  readonly transform: readonly TransformOp[];
  readonly origin: TransformOrigin;
};
