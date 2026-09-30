// Fixture group units: css-values-4 §6 length units computed by the compiler (absolute units, em and rem), and the precise
// refusals of units and math functions that V1 of the engine value model does not support.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const UNITS: readonly FixtureSpec[] = [
  layout('units-absolute'),
  layout('units-em'),
  layout('units-rem'),
  layout('units-rem-root'),
  both('units-rem-positioned'),
  // V1 of the value model (fixture group values) supports vw and calc(): these two keep their reject coverage on values it still refuses.
  reject('reject-unit-vw', 'DRAGON_UNSUPPORTED_VALUE', '50svw', 'width: 50svw is unsupported: small, large and dynamic viewport units'),
  reject('reject-unit-ex', 'DRAGON_UNSUPPORTED_VALUE', '3ex', 'height: 3ex is unsupported: it is measured from the primary font'),
  reject('reject-unit-lh', 'DRAGON_UNSUPPORTED_VALUE', '2lh', 'height: 2lh is unsupported: it is the used line height'),
  reject('reject-unit-calc', 'DRAGON_UNSUPPORTED_VALUE', 'round(10px, 3px)', 'width: round(10px,3px) is unsupported: round() is a css-values-4 stepped-value function'),
];
