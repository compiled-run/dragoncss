// Fixture group inline (INL1a, notes/T044-inl-spec.md §3): the inline formatting core. Soft wrap opportunities come from UAX #14
// as Blink's break iterator applies it (INL-P family 3), and a line fits with Blink's one-LayoutUnit epsilon (linefit.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout } from './define.ts';

export const INLINE: readonly FixtureSpec[] = [
  // Punctuation and digits are refused in rtl (bidi-neutral), so the break-class fixtures run ltr only.
  layout('inline-breaks-hyphen'),
  layout('inline-breaks-no-break'),
  both('inline-breaks-fit'),
];
