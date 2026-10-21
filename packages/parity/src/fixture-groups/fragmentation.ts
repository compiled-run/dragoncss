// Fixture group fragmentation (css-break-3): break-before, break-after and break-inside at Chrome's keywords, the page-break-* and
// -webkit-column-break-* shorthands, and orphans and widows, in any case, inherited, through var(), inherit, initial and calc(), on
// blocks, flex items and positioned boxes (fragmentation-values, web and native rows). No fragmentation context breaks them, so they
// change nothing on any target.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const FRAGMENTATION: readonly FixtureSpec[] = [both('fragmentation-values')];
