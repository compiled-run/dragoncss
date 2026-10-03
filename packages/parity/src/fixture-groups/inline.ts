// Fixture group inline (INL1a, notes/T044-inl-spec.md §3): the inline formatting core. Soft wrap opportunities come from UAX #14
// as Blink's break iterator applies it (INL-P family 3), and a line fits with Blink's one-LayoutUnit epsilon (linefit.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const INLINE: readonly FixtureSpec[] = [
  // Punctuation and digits are refused in rtl (bidi-neutral), so the break-class fixtures run ltr only.
  layout('inline-breaks-hyphen'),
  layout('inline-breaks-no-break'),
  both('inline-breaks-fit'),
  // INL1a part C1 refuses what the inline core does not lay out; the contexts that hold inline boxes stay unproven until their
  // fixtures (part C2) prove them.
  reject('reject-inline-padding', 'DRAGON_UNPROVEN_CONTEXT', '2px', 'padding-left:<length-px> on s is used in the inline/ltr context'),
  reject('reject-inline-margin', 'DRAGON_UNPROVEN_CONTEXT', '3px', 'margin-right:<length-px> on s is used in the inline/ltr context'),
  reject('reject-inline-border', 'DRAGON_UNPROVEN_CONTEXT', '1px solid #000', 'border-bottom-width:<length-px> (set by border-bottom: 1px solid #000) on s is used in the inline/ltr context'),
  reject('reject-inline-vertical-align', 'DRAGON_UNSUPPORTED_PROPERTY', 'vertical-align: sub', 'vertical-align is not supported'),
  reject('reject-inline-block-in-inline', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="b">YY</div>', '<div> b is block-level inside the inline box <span> s'),
  reject('reject-inline-mixed-wrap', 'DRAGON_UNSUPPORTED_VALUE', '<div data-dragon-id="d" class="w">aa <span data-dragon-id="s" class="nw">XX YY</span> bb</div>', 'text-wrap-mode wrap (d:text0) and nowrap (s:text0) in one inline formatting context of d'),
  reject('reject-inline-position', 'DRAGON_UNPROVEN_CONTEXT', 'relative', 'position:relative on s is used in the relative-in-inline/ltr context'),
  reject('reject-inline-abspos-beside', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on a beside text in d'),
  reject('reject-inline-lang-zh', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<div data-dragon-id="d" class="w" lang="zh">', 'attribute lang on d is not supported'),
  reject('reject-inline-empty-line', 'DRAGON_UNSUPPORTED_VALUE', '<span data-dragon-id="s" class="f"></span>', 'inline box <span> s starts the empty line after the last <br> of d'),
  reject('reject-inline-white-space', 'DRAGON_UNSUPPORTED_VALUE', '<span data-dragon-id="s" class="pw">XX  YY</span>', 'white-space-collapse: preserve on the inline box <span> s'),
];
