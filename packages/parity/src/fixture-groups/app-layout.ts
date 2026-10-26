// APP-LAYOUT: the layout contexts the five app screens (examples/real-pages) use without a proof: a sticky header (one a flex
// row) over a list and a fixed tab bar, with their padding, borders and border-box sizing. Both environment directions.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout } from './define.ts';

export const APP_LAYOUT: readonly FixtureSpec[] = [
  both('app-bars'),
  both('app-flex-text'),
  both('app-boxes'),
  layout('app-row-ellipsis'),
];
