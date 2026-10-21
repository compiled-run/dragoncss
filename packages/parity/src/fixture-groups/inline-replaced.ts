// Fixture group inline-replaced (RF-INL, notes/T045-repl-form-spec.md P6): img and svg as atomic inlines on the lines of their
// block container (css-display-3 §2.4): sized as block-level replaced boxes are (CSS 2.2 §10.3.2, §10.6.2), with no baseline of
// their own, so the bottom margin edge sits on the baseline and the strut's descent stays below it (CSS2 §10.8.1). Each atomic
// is alone in its paragraph or between letters, so rtl keeps it in logical order (UAX #9 N1-N2).
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const INLINE_REPLACED: readonly FixtureSpec[] = [
  // Alone in a line, beside text, with margins, borders and padding, at its natural size, as inline-block, in a tall line and wrapping.
  both('inline-replaced-img'),
  // An inline svg icon alone, beside text and with padding and margins.
  both('inline-replaced-svg'),
];
