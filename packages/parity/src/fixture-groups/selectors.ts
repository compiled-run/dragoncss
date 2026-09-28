// Fixture group selectors: selectors provable at build time (docs/decisions.md "Selectors and scrollbars"), one fixture per
// selector family, specificity ordering (the planted :is() specificity fault fails selectors-specificity), state-dependent
// structure (tree-selectors-state, which also proves the Chrome deviation empty-counts-whitespace), and precise refusals.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject, tree } from './define.ts';

export const SELECTORS: readonly FixtureSpec[] = [
  layout('selectors-universal-root'),
  layout('selectors-attribute'),
  layout('selectors-sibling'),
  layout('selectors-nth-child'),
  layout('selectors-nth-of-type'),
  layout('selectors-logical'),
  layout('selectors-has'),
  layout('selectors-specificity'),
  tree('tree-selectors-state'),
  reject('reject-selector-pseudo-element', 'DRAGON_UNSUPPORTED_SELECTOR', '::before'),
  reject('reject-selector-hover', 'DRAGON_UNSUPPORTED_SELECTOR', ':hover'),
  reject('reject-selector-s-flag', 'DRAGON_UNSUPPORTED_SELECTOR', '[ui-kind="a" s]'),
  reject('reject-selector-nested-has', 'DRAGON_UNSUPPORTED_SELECTOR', ':has(.b)'),
];
