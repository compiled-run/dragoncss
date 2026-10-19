// Fixture group color-functions (COL4): color-mix() in each interpolation space and hue method, nested; relative colours with calc()
// channels and alpha; and absolute lab(), oklch(), hwb() and color() colours, as backgrounds, borders and Ahem text, both directions.
// Chrome 145 paints each one's 8-bit sRGB clamp (css/color-space.ts). The reject: reject-color-lab, a translucent colour outside sRGB.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const COLOR_FUNCTIONS: readonly FixtureSpec[] = [both('color-functions')];
