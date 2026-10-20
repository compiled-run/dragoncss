// Fixture group fx (FX-0): backdrop-filter and mix-blend-mode where Chrome 145 changes no pixel, both directions, measured
// byte-identical with and without the declaration at DPR 1, 2, 2.625 and 3. Each page paints nothing outside its one FX box but the
// canvas colour, and the box holds only opaque fills, solid borders of one colour and text over a fill: blur(10px) over a blue body
// canvas (fx-backdrop-canvas), blur(2px) blur(1.5em) through var() over the white canvas on the coverage probe's shape
// (fx-backdrop-white), multiply through var() over white (fx-blend-multiply) and DARKEN on a relative box under html's white
// (fx-blend-darken). fx-initial: none and normal in another case, through var(), inherit and initial, on blocks, a positioned box
// and a flex row. Every other value or case is refused on native (dragon analysis/fx.ts), and a reject blocks web too, so the
// refusals are dragon test/fx.test.ts's.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';

export const FX: readonly FixtureSpec[] = [
  both('fx-backdrop-canvas'),
  both('fx-backdrop-white'),
  both('fx-blend-multiply'),
  both('fx-blend-darken'),
  both('fx-initial'),
];
