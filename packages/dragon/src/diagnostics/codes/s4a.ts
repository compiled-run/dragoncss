// S4a: nested style rules and bidirectional text.
import { diagnosticFeature, error, manual } from '../entry.ts';

export const S4A = diagnosticFeature(
  [
    'DRAGON_UNSUPPORTED_NESTED_RULE',
    'DRAGON_UNSUPPORTED_BIDI',
  ],
  {
    DRAGON_UNSUPPORTED_NESTED_RULE: error('This nested style rule is not supported.', 'Dragon resolves a nested rule (css-nesting-1) through & as :is() of its parent selectors, which cannot hold a pseudo-element; a rule nested in a pseudo-element rule would change which declarations apply, so it is never dropped silently.', manual('Un-nest the rule', 'Write the nested rule as its own top-level rule with the full selector; Chrome matches nothing for a rule nested in a pseudo-element rule.')),
    DRAGON_UNSUPPORTED_BIDI: error('This right-to-left text needs bidirectional reordering.', 'In a right-to-left paragraph, digits, punctuation and other neutral characters are reordered by the Unicode bidirectional algorithm (UAX #9), and U+200B at the end takes the paragraph direction; milestone 1 lays out only letters, spaces and U+200B there and never guesses.', manual('Use letters in right-to-left text', 'Use only A-Z, a-z, spaces and U+200B (not at the end) in right-to-left text, or set direction: ltr on its block.')),
  },
);
