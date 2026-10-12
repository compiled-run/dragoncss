// TREE: selector lists Chrome drops.
import { diagnosticFeature, manual } from '../entry.ts';

export const TREE = diagnosticFeature(
  [
    'DRAGON_SELECTOR_DROPPED',
  ],
  {
    DRAGON_SELECTOR_DROPPED: { severity: 'warning', message: 'This rule is dropped: Chrome does not parse one of its selectors.', why: 'A selector list with one selector the browser does not parse invalidates the whole style rule (Selectors-4 §3.1), so Chrome never applies it; Dragon drops it too, so every target agrees.', computedWhy: null, fix: manual('Remove the dropped rule or its invalid selector', 'Delete the rule, or remove the selector Chrome does not parse (for example a -moz- pseudo-element) so the rest of the list applies.') },
  },
);
