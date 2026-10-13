// Fixture group selection (T154, css-ui-4 §6.1): user-select none on blocks, text, flex items and positioned boxes, through the
// -webkit- alias, any case, var() and inherit (user-select-none, web and native rows). Native refuses every other value until P6c
// builds selection, and every layout fixture runs on native, so auto, text and all wait for a web-only fixture (as the env() ones)
// to earn web rows. The native-only refusals are proven in packages/dragon/test/user-select.test.ts.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const SELECTION: readonly FixtureSpec[] = [
  both('user-select-none'),
];
