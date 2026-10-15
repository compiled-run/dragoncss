// Fixture group text-shadow (TXT-FX): text-shadow: none in Ahem, both directions, on a block, inherited by a child, in another ASCII
// case and on a flex row, so every target proves none. The reject: a shadow list, which no target draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_SHADOW: readonly FixtureSpec[] = [
  layout('text-shadow-none', ['ltr', 'rtl']),
  reject('reject-text-shadow-list', 'DRAGON_UNSUPPORTED_VALUE', '0 1px 2px rgba(0, 0, 0, 0.5)', 'text-shadow: rgba(0, 0, 0, 0.5) 0px 1px 2px'),
];
