// Fixture group phrasing-blockified (INL-BF, notes/T044-inl-spec.md §3): span, a (without href) and label as blockified boxes,
// that is flex items and absolutely positioned boxes (css-display-3 §2.7), and the refusals of the inline-level ones.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const PHRASING_BLOCKIFIED: readonly FixtureSpec[] = [
  both('phrasing-blockified-flex-row'),
  both('phrasing-blockified-flex-column'),
  both('phrasing-blockified-abspos'),
  both('phrasing-blockified-inline-flex'),
  both('phrasing-blockified-inline-flex-blocks'),
  both('phrasing-blockified-inline-block'),
  reject('reject-phrasing-inline-span', 'DRAGON_UNSUPPORTED_VALUE', '<span data-dragon-id="s">XX</span>', 'display: inline on <span> s makes it an inline-level box'),
  reject('reject-phrasing-a-href', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<a data-dragon-id="a" href="https://example.com/">', 'attribute href on a is not supported'),
  reject('reject-phrasing-inline-block', 'DRAGON_UNPROVEN_CONTEXT', 'inline-block', null),
];
