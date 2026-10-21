// Fixture group field-sizing (css-ui-4 §7.5): fixed and content in Ahem, both directions, on bordered and padded blocks with
// backgrounds, a width-constrained box, another ASCII case, var(), the CSS-wide keywords, inherit, a flex row, a grid and an
// absolutely positioned box, where Chrome sizes nothing differently (it applies content to form controls alone). The reject:
// content on an svg, a replaced element.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const FIELD_SIZING: readonly FixtureSpec[] = [
  both('field-sizing-values'),
  reject('reject-field-sizing-svg', 'DRAGON_UNSUPPORTED_VALUE', 'content', 'field-sizing: content on <svg> s is unsupported'),
];
