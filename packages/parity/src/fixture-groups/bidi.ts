// Fixture group bidi (css-writing-modes-4 §2.2): unicode-bidi where Chrome reorders nothing, so every target lays it out.
// unicode-bidi-ltr: every value on ltr blocks, inline boxes, a flex row and its items and atomic inlines, over Latin text with
// digits and punctuation, in one direction and never in another inline box (an inline value or an override in an rtl context
// reorders the Latin words and neutrals, and an inline box's level splits the inline box around it into fragments; native refuses
// both). unicode-bidi-blocks: normal, embed and isolate on blocks and flex items, the UA isolate of div and p, and a div made
// inline (UA isolate), in both directions. The native-only refusals are proven in packages/dragon/test/unicode-bidi.test.ts, as a
// reject fixture needs a refusal that blocks the web output too.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout } from './define.ts';

export const BIDI: readonly FixtureSpec[] = [
  layout('unicode-bidi-ltr'),
  both('unicode-bidi-blocks'),
];
