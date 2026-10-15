// Fixture group text-tab-size (TXT2-c3 first slice, notes/T149-txt2-spec.md R16): tab-size in Ahem, both directions, as a number,
// 0, a fraction, px and em, inherited, under white-space: pre with no tab, and on a flex row. No case holds a preserved tab, which
// stays refused ('tab-stop') until the tab stops are ported. The reject: a calculation, which Chrome folds and Dragon refuses.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const TEXT_TAB_SIZE: readonly FixtureSpec[] = [
  layout('text-tab-size-ahem', ['ltr', 'rtl']),
  reject('reject-text-tab-size-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(2 * 3)', 'tab-size: a calculation is not supported yet'),
];
