// The compiler's hit facts (notes/T047-runtime-spec.md RT-9, SELD-R1b): per element, its pointer-events as hit testing reads it (none when not visible), whether that
// value was inherited, whether it carries an activation handler, whether it makes a stacking context, its transform and its z-index. The hit table itself is built from the laid-out engine
// input by packages/layout/src/rt-hit.ts hitTableOf, the same function on the host and, translated, on the device.

import type { RadiusLengthValue } from '../../lower/paint/radius.ts';
import type { TransformOp, TransformOrigin } from '@dragon/layout';

export const HIT_FACTS_VERSION = 'dragon.hit-facts/5';

/** One element's hit facts (rt-hit.ts HitFact). */
export type HitFact = {
  readonly pointerEvents: 'auto' | 'none';
  readonly inherited: boolean;
  readonly activation: boolean;
  /** The eight border-radius components when any corner is rounded (rt-hit.ts tests the rounded border box), else empty. */
  readonly radii: readonly RadiusLengthValue[];
  /** A stacking context in the z-index 0 layer (opacity below 1, a transform), and the transform functions (none when empty) and origin. */
  readonly context: boolean;
  /** What else makes it a stacking context, as a message names it (containment, a filter, isolation and the like), or ''. */
  readonly otherContext: string;
  readonly transform: readonly TransformOp[];
  readonly origin: TransformOrigin;
  /** The computed z-index, null for auto; rt-hit.ts applies it where paint does (a positioned box, or a flex or grid item). */
  readonly z: number | null;
};
