// Fixture group text-overflow (TXT2-f, notes/T149-txt2-spec.md R9 and R10): text-overflow: ellipsis on the overflowing lines of a
// block container whose overflow is not visible, left to right, in Ahem (U+2026 is one em). Lines that fit, overflow: visible, a
// wrapped long word, forced line breaks, padding, a fractional width, inline boxes in other font sizes (the ellipsis takes the
// block's font), and block children and flex containers (no line of their own to truncate). The rejects are what every target
// refuses: rtl, a string value (Chrome 145 parses clip and ellipsis only), and text beside a block child.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_OVERFLOW: readonly FixtureSpec[] = [
  layout('text-overflow-lines'),
  layout('text-overflow-fonts'),
  layout('text-overflow-blocks'),
  reject('reject-text-overflow-direction', 'DRAGON_UNSUPPORTED_VALUE', 'ellipsis', 'text-overflow: ellipsis on'),
  reject('reject-text-overflow-string', 'DRAGON_CSS_INVALID_VALUE', '"--"'),
  reject('reject-text-overflow-anonymous', 'DRAGON_UNSUPPORTED_VALUE', 'ellipsis', 'text-overflow: ellipsis on'),
];
