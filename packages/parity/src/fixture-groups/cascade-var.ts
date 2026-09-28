// Fixture group cascade-var: custom properties, var() substitution (inheritance, fallbacks, cycles, invalid at computed-value
// time, shorthands, colours, lengths and flex values, state-dependent values) and !important (css-variables-1, css-cascade-5).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, tree } from './define.ts';

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
];
