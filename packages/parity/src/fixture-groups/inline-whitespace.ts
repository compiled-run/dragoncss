// WS-INL: whitespace-only text between inline-level boxes (`<span>a</span> <b>b</b>`), which Chrome lays out as a space advance
// between them that collapses with the spaces beside it and at line ends, and which generates no box directly in a flex or grid
// container (Blink Text::TextLayoutObjectIsNeeded), even under white-space: pre.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout } from './define.ts';

export const INLINE_WHITESPACE: readonly FixtureSpec[] = [
  both('inline-whitespace'),
  // ltr only: in rtl an atomic inline with no letter beside it is refused (DRAGON_UNSUPPORTED_BIDI, analysis/bidi.ts).
  layout('inline-whitespace-atomic'),
];
