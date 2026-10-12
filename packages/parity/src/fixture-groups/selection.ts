// Fixture group selection (T154, css-ui-4 §6.1): user-select none on blocks, text, flex items and positioned boxes, through the
// -webkit- alias, any case, var() and inherit (user-select-none, web and native); auto, text, all, initial, unset and the alias,
// and the cascade between user-select and -webkit-user-select (user-select-values: web rows only, since native refuses every
// value but none until P6c, so the lanes run that case lane-only there). The native-only refusals are proven in
// packages/dragon/test/user-select.test.ts, as a reject fixture needs a refusal that blocks the web output too.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const SELECTION: readonly FixtureSpec[] = [
  both('user-select-none'),
  both('user-select-values'),
];
