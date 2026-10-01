// CSS Logical Properties Level 1 in horizontal-tb (packages/dragon/src/css/shorthands/logical.ts, analysis/logical.ts): logical
// and physical declarations of one group interleaved in both orders, on ltr and rtl elements, with inherited and declared
// direction, in both environment directions. vertical writing modes and the logical border-radius corners stay refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const LOGICAL_PROPS: readonly FixtureSpec[] = [
  both('logical-margin-padding'),
  both('logical-border'),
  both('logical-inset'),
  both('logical-sizes'),
  both('logical-wide-keywords'),
  reject('reject-writing-mode', 'DRAGON_UNSUPPORTED_VALUE', 'vertical-rl', 'writing-mode: vertical-rl is unsupported'),
  reject('reject-logical-radius', 'DRAGON_UNSUPPORTED_PROPERTY', 'border-start-start-radius: 4px'),
];
