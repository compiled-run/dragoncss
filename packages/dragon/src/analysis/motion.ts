// The motion path family (css/properties/motion.ts), which Dragon accepts at its initial values alone: any other computed value is
// refused on every target, once per element, as the multicol and containment families are (analysis/scroll-containment.ts).
import { MOTION_INITIAL, MOTION_LONGHANDS } from '../css/properties/motion.ts';
import type { MotionFaults } from '../faults/motion.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement } from './resolve.ts';
import type { InitialOnlyFamily } from './scroll-containment.ts';
import { refuseNonInitial } from './scroll-containment.ts';

// css-motion-1 §2: an offset-path other than none moves the box along the path (an offset transform before transform), makes a
// stacking context and a containing block for fixed descendants, and offset-distance, offset-position, offset-anchor and
// offset-rotate place and turn it there. Dragon composes none of it yet; at the initial values no box moves.
const MOTION: InitialOnlyFamily = { id: 'motion', longhands: MOTION_LONGHANDS, initial: MOTION_INITIAL, reason: 'Dragon composes no motion path offset transform yet' };

/** Refuses the element's first non-initial motion longhand; the planted fault accepts it. */
export function checkMotion(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: MotionFaults): void {
  if (!faults.motionAccepted) refuseNonInitial(el, targets, diagnostics, reported, MOTION);
}
