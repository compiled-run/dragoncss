// Fixture group vertical-align (INL2b, notes/T059J-inl2.md ruling 2): every CSS2 §10.8.1 vertical-align value on inline boxes and
// atomic inlines against Chrome, from INL-P family 5 (docs/research/inline-spike/probe/family5-atomic.json, blink-notes.md §6):
// the keywords (sub and super from the parent's font size, middle on half the parent's x-height, text-top and text-bottom on the
// parent's text edges, top and bottom against the line's aligned subtree in a second pass), lengths and percentages of the box's
// own line-height, nesting, the sub and sup tags (their UA font-size: smaller and vertical-align), and Lato. A percentage on an
// atomic inline without inline content has no line-height in the layout input and stays unproven, as -webkit-baseline-middle,
// which Chrome parses, stays refused (fixture-groups/inline.ts reject-inline-vertical-align).
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const VERTICAL_ALIGN: readonly FixtureSpec[] = [
  both('inline-vertical-align-keywords'),
  both('inline-vertical-align-lengths'),
  both('inline-vertical-align-atomic'),
  both('inline-vertical-align-top-bottom'),
  both('inline-vertical-align-tags'),
  both('inline-vertical-align-lato'),
];
