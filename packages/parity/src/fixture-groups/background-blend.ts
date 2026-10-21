// Fixture group background-blend (BG2, compositing-1 §9.2): background-blend-mode at normal in Ahem, both directions, over a colour,
// one gradient layer and two, in another ASCII case, with !important, through the CSS-wide keywords, var() and inherit, and on a
// flex row, so every target proves normal. The reject: multiply over a gradient, which no target blends yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const BACKGROUND_BLEND: readonly FixtureSpec[] = [
  layout('background-blend-initial', ['ltr', 'rtl']),
  reject('reject-background-blend-multiply', 'DRAGON_UNSUPPORTED_VALUE', 'multiply', 'background-blend-mode: multiply'),
];
