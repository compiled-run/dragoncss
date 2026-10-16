// Fixture group filter (FX): filter: none in Ahem, both directions, on bordered boxes with backgrounds, in another ASCII case, through
// -webkit-filter, after a filter list in the same rule from either name, through initial and on a flex row, so every target proves
// none. The reject: opacity(0), a filter that hides text, which no target draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const FILTER: readonly FixtureSpec[] = [
  layout('filter-none', ['ltr', 'rtl']),
  reject('reject-filter-function', 'DRAGON_UNSUPPORTED_VALUE', 'opacity(0)', 'filter: opacity(0)'),
];
