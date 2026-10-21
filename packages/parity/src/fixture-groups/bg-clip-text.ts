// Fixture group bg-clip-text (BG2, background-clip-text.ts): background-clip: text over a background colour in Ahem, both directions.
// The fill boxes clip a colour to transparent text, through the -webkit- alias, var(), !important, upper case, a two-item list, a flex
// box, a losing padding-box and a translucent colour, which native draws as the glyphs in that colour, and unwrapped
// glyphs past the box, which Chrome does not paint and native clips to the box. The keep boxes compile the clip where
// it changes nothing (a transparent colour, over child elements too) or loses (a later declaration, the background shorthand).
// The reject: a gradient clipped to text, refused on every target. The native-only refusals are proven in
// packages/dragon/test/background-clip-text.test.ts.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const BG_CLIP_TEXT: readonly FixtureSpec[] = [
  both('bg-clip-text'),
  reject('reject-bg-clip-text-image', 'DRAGON_UNSUPPORTED_VALUE', 'text', 'background-clip: text on s'),
];
