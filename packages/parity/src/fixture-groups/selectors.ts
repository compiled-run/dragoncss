// Fixture group selectors: selectors provable at build time (docs/decisions.md "Selectors and scrollbars"), one fixture per
// selector family, specificity ordering (the planted :is() specificity fault fails selectors-specificity), state-dependent
// structure (tree-selectors-state, which also proves the Chrome deviation empty-counts-whitespace), and precise refusals.
// SEL-dir: :dir() follows the dir attributes, never the environment direction, so every :dir() fixture runs in both directions;
// selectors-dir-drawer puts @markless/ui's drawer rules on fixed boxes inside dir=rtl under an ltr root and the mirror.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject, tree } from './define.ts';

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
  both('selectors-dir'),
  both('selectors-dir-drawer'),
  both('selectors-dir-invalid'),
  tree('tree-selectors-dir-state'),
  reject('reject-selector-pseudo-element', 'DRAGON_UNSUPPORTED_SELECTOR', '::first-line'),
  reject('reject-selector-hover', 'DRAGON_UNSUPPORTED_SELECTOR', ':focus-within'),
  reject('reject-selector-s-flag', 'DRAGON_UNSUPPORTED_SELECTOR', '[ui-kind="a" s]'),
  reject('reject-selector-nested-has', 'DRAGON_UNSUPPORTED_SELECTOR', ':has(.b)'),
  // css-tree reports each :dir() argument it cannot parse at the point it stops, so the span is empty and the message is pinned.
  reject('reject-selector-dir-quoted', 'DRAGON_CSS_PARSE', '', 'CSS parse error: Identifier is expected'),
  reject('reject-selector-dir-two', 'DRAGON_CSS_PARSE', '', 'CSS parse error: ")" is expected'),
  reject('reject-selector-dir-list', 'DRAGON_CSS_PARSE', '', 'CSS parse error: ")" is expected'),
  reject('reject-selector-dir-forgiving', 'DRAGON_CSS_PARSE', '', 'CSS parse error: Identifier is expected'),
  reject('reject-selector-dir-forgiving-empty', 'DRAGON_UNSUPPORTED_SELECTOR', ':dir()', ':dir() is invalid in Chrome 145'),
];
