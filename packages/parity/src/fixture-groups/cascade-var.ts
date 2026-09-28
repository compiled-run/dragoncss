// Fixture group cascade-var: custom properties, var() substitution (inheritance, fallbacks, cycles, invalid at computed-value
// time, shorthands, colours, lengths and flex values, state-dependent values) and !important (css-variables-1, css-cascade-5).
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, tree } from './define.ts';

export const CASCADE_VAR: readonly FixtureSpec[] = [
  // The CSS-wide keywords written literally: an invalid-at-computed-value-time var() behaves as unset (css-variables-1 §3.1).
  layout('css-wide-keywords'),
  layout('var-inheritance'),
  layout('var-fallback'),
  layout('var-cycles'),
  layout('var-invalid-at-computed-time'),
  layout('var-shorthands'),
  layout('var-flex-values'),
  layout('cascade-important'),
  tree('tree-var-state'),
  // unset written literally on direction and each physical side, in both directions: what an invalid var() there computes to.
  both('css-wide-keywords-sides'),
  // Direction and logical properties with var(): custom properties first, then direction, then the flow-relative mappings of
  // that direction (css-variables-1 §3.1, css-logical-1 §3), in both environment directions.
  both('var-direction'),
  both('var-logical'),
];
