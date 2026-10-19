// Fixture group appearance (css-ui-4 §7.1): every keyword Dragon accepts, through appearance and its -webkit-appearance alias in
// either order, any case, var(), inherit, initial and unset, on blocks, flex items, positioned boxes and an inline span
// (appearance-values, web and native rows). No supported tag has a native appearance, so each computes as written and paints nothing.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const APPEARANCE: readonly FixtureSpec[] = [
  both('appearance-values'),
];
