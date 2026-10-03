// Fixture group radius (PNT1, css-backgrounds-3 §5): border radii in px, em, rem and percentages, elliptical and per-corner radii,
// the §5.5 clamp, rounded solid borders (one colour and per side), rounded overflow clips, and the cascade of the shorthand and the
// corner longhands (var(), inherit, initial, unset), in both environment directions. A calculation and a viewport unit in a radius
// are refused; a rounded dashed, dotted or double border (PNT1b) is refused on the native targets only, so its refusal is proven
// by packages/dragon/test/paint-radius.test.ts rather than a reject fixture (a reject fixture blocks the web output too).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const RADIUS: readonly FixtureSpec[] = [
  both('radius-basic'),
  both('radius-borders'),
  both('radius-clip'),
  both('radius-clamp'),
  both('radius-cascade'),
  reject('reject-radius-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(10px + 5%)', 'border-radius: calc(10px + 5%) is unsupported: a calculation in a border radius is not supported'),
  reject('reject-radius-viewport', 'DRAGON_UNSUPPORTED_VALUE', '2vw', 'border-top-left-radius: 2vw is unsupported: a border radius in a viewport unit'),
];
