// Fixture group multicol (MULTICOL): column-width, column-count, the column rule longhands, column-span and column-fill at their
// initial values in Ahem, both directions, on bordered and padded boxes with backgrounds: through columns and column-rule in each
// spelling Chrome reads as all initial, every longhand, another ASCII case, a colour change under currentcolor, every -webkit- alias,
// the CSS-wide keywords, inherit and a flex row, so every target proves the initial values. The rejects: a column count, which
// makes a multi-column container, and a drawn column rule; no target lays out columns yet.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const MULTICOL: readonly FixtureSpec[] = [
  both('multicol-initial'),
  reject('reject-multicol-column-count', 'DRAGON_UNSUPPORTED_VALUE', '2', 'column-count: 2 on <div> s is unsupported'),
  reject('reject-multicol-column-rule', 'DRAGON_UNSUPPORTED_VALUE', '1px solid red', 'column-rule-width: 1px solid red on <div> s is unsupported'),
];
