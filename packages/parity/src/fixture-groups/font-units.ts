// Fixture group font-units (FONT-UNITS, css-values-4 §6.1.1): ex, ch and cap in an element's own layout lengths, in Ahem (ex and
// cap 0.8em, ch 1em), both directions. font-units-ahem reads them at 10, 13, 15, 16, 17 and 20px font sizes, fractional and
// negative, in width, height, min-width, max-width, margins, padding (a logical one too), relative and absolute insets, flex-basis
// through flex and alone, flex and grid gaps, through var() on two font sizes, and on an inline box in wrapped text. The rejects:
// a font-metric letter-spacing (inherited text spacing), a child that takes a ch width with inherit (Chrome measures it against
// the parent's font), a ch keyframe, and the root-relative rch.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const FONT_UNITS: readonly FixtureSpec[] = [
  layout('font-units-ahem', ['ltr', 'rtl']),
  reject('reject-font-units-letter-spacing', 'DRAGON_UNSUPPORTED_VALUE', '1ch', 'letter-spacing: 1ch is unsupported: Dragon resolves ex, ch and cap from the element\'s own font'),
  reject('reject-font-units-inherit', 'DRAGON_UNSUPPORTED_VALUE', 'inherit', 'width: inherit on <div> s takes 6ch from its parent'),
  reject('reject-font-units-keyframes', 'DRAGON_UNSUPPORTED_VALUE', '2ch', 'width: 2ch in @keyframes grow is unsupported'),
  reject('reject-font-units-root', 'DRAGON_UNSUPPORTED_VALUE', '3rch', 'width: 3rch is unsupported: it is measured from the primary font'),
];
