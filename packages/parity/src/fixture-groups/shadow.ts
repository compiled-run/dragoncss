// Fixture group shadow (PNT1, css-backgrounds-3 §7.1): outer shadows (offsets, blur, spread, negative spread, several per box, a
// transparent box), shadows of rounded, pill, oval and per-corner rounded boxes (the corner correction of the spread), inset
// shadows (square, rounded, bordered, offset, full-cover), the cascade (em, rem, mm and pt lengths, currentcolor, var(), a list,
// none, inherit), and the calibration set the shadow allowance is measured on (blurs 1 to 16 px, rounded, oval and inset shapes,
// five colours over a light and a dark backdrop), in both environment directions. A calculation or a viewport unit in a shadow is
// refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const SHADOW: readonly FixtureSpec[] = [
  both('shadow-basic'),
  both('shadow-rounded'),
  both('shadow-inset'),
  both('shadow-cascade'),
  both('calib-shadow-blur'),
  both('calib-shadow-colors'),
  reject('reject-shadow-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(1px + 1px)', 'box-shadow: calc(1px + 1px) is unsupported: a calculation in a shadow is not supported'),
  reject('reject-shadow-viewport', 'DRAGON_UNSUPPORTED_VALUE', '1vw', 'box-shadow: 1vw is unsupported: a shadow length in a viewport unit'),
];
