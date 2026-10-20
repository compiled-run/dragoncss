// The multicol family (css/properties/multicol.ts), which Dragon accepts at its initial values alone: any other computed value is
// refused on every target, once per element, as the scroll and containment families are (analysis/scroll-containment.ts).
import { MULTICOL_INITIAL, MULTICOL_LONGHANDS } from '../css/properties/multicol.ts';
import type { MulticolFaults } from '../faults/multicol.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement } from './resolve.ts';
import type { InitialOnlyFamily } from './scroll-containment.ts';
import { refuseNonInitial } from './scroll-containment.ts';

// css-multicol-1: a column-width or column-count other than auto makes the box a multi-column container, column-span: all spans
// one, column-fill changes how its content is balanced, and a column rule is drawn between its columns; Dragon builds none of it
// yet. At the initial values no box is a multi-column container, so the rule and fill longhands change nothing either.
const MULTICOL: InitialOnlyFamily = { id: 'multicol', longhands: MULTICOL_LONGHANDS, initial: MULTICOL_INITIAL, reason: 'Dragon implements no multi-column layout yet' };

/** Refuses the element's first non-initial multicol longhand; the planted fault accepts it. */
export function checkMulticol(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: MulticolFaults): void {
  if (!faults.multicolAccepted) refuseNonInitial(el, targets, diagnostics, reported, MULTICOL);
}
