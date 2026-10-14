// Fixture group line-clamp (TXT2-g, notes/T149-txt2-spec.md R11): Chrome 145's legacy line clamp, display: -webkit-box with
// -webkit-box-orient: vertical, a -webkit-line-clamp and overflow: hidden, left to right in Ahem (U+2026 is one em). The block's own
// lines: more, exactly and fewer than N, padding and border, an overflowing line N, a line N the ellipsis fits after, Tailwind's
// line-clamp-3, forced breaks, a smaller inline box (the ellipsis takes the block's font) and a clamp of 1; and block children one
// level down (the coverage probe's shape), the clamp falling inside a child, at a child's last line, and after a padded child. The
// rejects are what every target refuses: overflow visible, nesting deeper than one level, and a calculated clamp.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const LINE_CLAMP: readonly FixtureSpec[] = [
  layout('line-clamp-lines'),
  layout('line-clamp-nested'),
  reject('reject-line-clamp-overflow', 'DRAGON_UNSUPPORTED_VALUE', '-webkit-box', '-webkit-line-clamp on c needs overflow: hidden'),
  reject('reject-line-clamp-nested', 'DRAGON_UNSUPPORTED_VALUE', '-webkit-box', '-webkit-line-clamp on c holds <div> b'),
  reject('reject-line-clamp-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(1 + 1)', '-webkit-line-clamp: only none or a whole number'),
];
