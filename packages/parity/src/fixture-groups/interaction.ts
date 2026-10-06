// SELD-R2 (notes/T064-seld-r2-spec.md §4): the interaction fixtures, in both directions. interaction-hover covers hover on a
// subject (paint), hover on an element affecting its next sibling, hover on an ancestor affecting a descendant (layout),
// .selected against :hover at equal specificity, and a hover that changes height; interaction-focus covers :focus and
// :focus-visible, which no supported element can take from a pointer or key yet, so only their forced cases reach them (the
// :focus-visible rule sets outline: none, which beats Chrome's UA focus ring; native refuses the ring itself), and a hover chain
// beside them; interaction-active covers the press chain, :active over :hover at equal specificity and .x:active .y;
// interaction-combo covers a hover and a press at once (.a:hover ~ .b:active), :hover:focus and a :focus that changes nothing
// (collapsed to none). Refused: direction in an interaction rule, :focus-within, and more than 256 interaction states in one
// assignment (R7). Transformed and z-index hits are SELD-R2b.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const INTERACTION: readonly FixtureSpec[] = [
  both('interaction-hover'),
  both('interaction-focus'),
  both('interaction-active'),
  both('interaction-combo'),
  reject('reject-interaction-direction', 'DRAGON_UNSUPPORTED_SELECTOR', 'direction: rtl', 'direction in a rule that tests :hover'),
  reject('reject-interaction-focus-within', 'DRAGON_UNSUPPORTED_SELECTOR', ':focus-within', ':focus-within depends on user interaction'),
  reject('reject-interaction-cap', 'DRAGON_UNSUPPORTED_SELECTOR', 'width: 2px', 'more than 256 interaction states'),
];

/**
 * The fixtures whose interaction states get forced cases: one case per distinct state but none, its Chrome reference taken with
 * CSS.forcePseudoState through the capture's prepare hook. Kept outside FixtureSpec, so no existing case or count moves.
 */
export const INTERACTION_FORCED: ReadonlySet<string> = new Set(['interaction-hover', 'interaction-focus', 'interaction-active', 'interaction-combo']);
