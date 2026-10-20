// Fixture group selection (T154, css-ui-4 §6.1): user-select none on blocks, text, flex items and positioned boxes, through the
// -webkit- alias, any case, var() and inherit, and (slice 1) auto, and text under the default, whose used value is the default's
// (user-select-none, web and native rows). Native refuses the values that change what Chrome selects (text or all where the default
// differs) until P6c builds selection; packages/dragon/test/user-select.test.ts proves the refusals and
// packages/parity/test/user-select-noop.test.ts proves against Chrome that the compiled values select as native stands for.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const SELECTION: readonly FixtureSpec[] = [
  both('user-select-none'),
];
