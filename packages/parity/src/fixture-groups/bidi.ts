// Fixture group bidi (css-writing-modes-4 §2.2): unicode-bidi where Chrome reorders nothing, so every target lays it out.
// unicode-bidi-ltr: every value on ltr blocks, inline boxes, a flex row and its items and atomic inlines, over Latin text with
// digits and punctuation, and the UA isolate of a div made inline with spaces at its edges, in one direction and never in another
// inline box (an inline value or an override in an rtl context reorders the Latin words and neutrals, the UA isolate of an inline
// div there orders its edge spaces inside it, and an inline box's level splits the inline box around it into fragments; native
// refuses all three). unicode-bidi-blocks: normal, embed and isolate on blocks and flex items, the UA isolate of div and p, and a
// div made inline (UA isolate, no edge spaces), in both directions; native refuses that inline div in rtl, so the rtl case is
// lane-only there. The native-only refusals are proven in packages/dragon/test/unicode-bidi.test.ts, as a reject fixture needs a
// refusal that blocks the web output too.
// SEL-dir: bidi-dir-attribute, dir's direction hint (losing to an author direction, under revert and revert-layer, mapping
// flow-relative sides and a ul's padding) and html.css's isolate on blocks and on an inline span in an ltr paragraph;
// bidi-dir-attribute-inline, the isolate of a <span dir=rtl>, which native refuses (analysis/bidi.ts), so it proves web rows only.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const BIDI: readonly FixtureSpec[] = [
  layout('unicode-bidi-ltr'),
  both('unicode-bidi-blocks'),
  both('bidi-dir-attribute'),
  both('bidi-dir-attribute-inline'),
  reject('reject-dir-auto', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<div data-dragon-id="a" class="a" dir="auto">', 'attribute dir="auto" on a is not supported'),
  reject('reject-dir-invalid-value', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<div data-dragon-id="a" class="a" dir="foo">', 'attribute dir="foo" on a is not supported'),
  reject('reject-dir-untrimmed', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<div data-dragon-id="a" class="a" dir=" rtl">', 'attribute dir=" rtl" on a is not supported'),
  reject('reject-dir-root', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<html data-dragon-id="html" dir="rtl">', 'attribute dir on html is not supported'),
];
