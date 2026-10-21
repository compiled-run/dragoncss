// Fixture group text-wrap (css-text-4 §5.1): the text-wrap shorthand and text-wrap-style in Ahem, both directions: nowrap, wrap,
// stable, auto, both longhands at once, inherited, after white-space in the cascade, and on a flex row. The reject: balance,
// which Chrome lays out with its own line-breaking pass and Dragon refuses until that pass is ported.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_WRAP: readonly FixtureSpec[] = [
  layout('text-wrap-ahem', ['ltr', 'rtl']),
  reject('reject-text-wrap-balance', 'DRAGON_UNSUPPORTED_VALUE', 'balance', 'text-wrap: balance is unsupported'),
];
