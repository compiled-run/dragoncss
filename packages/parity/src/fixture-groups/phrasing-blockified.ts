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
  // INL1a lays out a span in a block container (an inline box); one holding a block is block-in-inline, still refused (T058J3 A).
  reject('reject-phrasing-inline-span', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="b">YY</div>', '<div> b is block-level inside the inline box <span> s'),
  // TDEC-a: href on a is a hyperlink Dragon models (a:any-link); target on it stays refused, owned by LINK-RT.
  reject('reject-phrasing-a-href', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<a data-dragon-id="a" href="https://example.com/" target="_blank">', 'attribute target on a is not supported: its rendering effect belongs to the link package LINK-RT'),
  reject('reject-phrasing-inline-block', 'DRAGON_UNPROVEN_CONTEXT', 'inline-block', null),
];
