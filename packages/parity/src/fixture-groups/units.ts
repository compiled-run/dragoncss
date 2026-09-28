// Fixture group units: css-values-4 §6 length units computed by the compiler (absolute units, em and rem), and the precise
// refusals of units and math functions that need the engine value-model package.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const UNITS: readonly FixtureSpec[] = [
  layout('units-absolute'),
  layout('units-em'),
  layout('units-rem'),
  layout('units-rem-root'),
  both('units-rem-positioned'),
  reject('reject-unit-vw', 'DRAGON_UNSUPPORTED_VALUE', '50vw', 'width: 50vw is unsupported: viewport units'),
  reject('reject-unit-ex', 'DRAGON_UNSUPPORTED_VALUE', '3ex', 'height: 3ex is unsupported: it is measured from the primary font'),
  reject('reject-unit-lh', 'DRAGON_UNSUPPORTED_VALUE', '2lh', 'height: 2lh is unsupported: it is the used line height'),
  reject('reject-unit-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(10px + 2em)', 'width: calc(10px + 2em) is unsupported: calc() is a css-values-4 math function'),
];
