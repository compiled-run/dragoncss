// SELD-R2a (notes/T047-runtime-spec.md §3.4 and Amendment T064J): the interaction fixtures, in both directions. interaction-hover
// covers hover on a subject (paint), hover on an element affecting its next sibling, hover on an ancestor affecting a
// descendant (layout), .selected against :hover at equal specificity, and a hover that changes height; interaction-focus covers
// :focus and :focus-visible, which no supported element can take from a pointer, so only their forced cases reach them, and a
// hover chain beside them. Transformed and z-index hits are SELD-R2b. :active stays refused, and so does direction in a rule
// that tests an interaction pseudo-class.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const INTERACTION: readonly FixtureSpec[] = [
  both('interaction-hover'),
  both('interaction-focus'),
  reject('reject-interaction-direction', 'DRAGON_UNSUPPORTED_SELECTOR', 'direction: rtl', 'direction in a rule that tests :hover'),
  reject('reject-interaction-active', 'DRAGON_UNSUPPORTED_SELECTOR', ':active', ':active depends on user interaction'),
];

/**
 * The fixtures whose interaction states get forced cases (Amendment T064J): one case per partition state but none, its Chrome
 * reference taken with CSS.forcePseudoState through the capture's prepare hook. Kept outside FixtureSpec, so no existing case or
 * count moves.
 */
export const INTERACTION_FORCED: ReadonlySet<string> = new Set(['interaction-hover', 'interaction-focus']);
