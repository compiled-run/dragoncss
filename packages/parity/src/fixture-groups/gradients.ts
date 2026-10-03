// BG2-a (notes/T074-bg2-spec.md §7): CSS gradients and multiple background layers, drawn by Dragon with the translated Chrome 145
// raster (paint-gradient.ts): linear gradients by default, side and angle (deg, grad, turn, negative and over 360), radial gradients
// in every shape and extent, repeating gradients, layer lists with their geometry, fractional boxes, the calibration ramps across
// Chrome's cc raster tiles, the whole degrees whose tanf the capture host's libm gives differently from fdlibm (R3), rounded boxes,
// translucent stacks over a known backdrop (R6 a and b), em, rem, absolute lengths and edge offsets (R7), background geometry in
// every box with padding, and the music player's gradient rules. The rejects cover what no target draws yet, naming the package
// that lifts it; what only the native targets refuse (an angle off the grid, a corner, tiling, a translucent stack over an unknown
// backdrop, a rounded box Chrome paints into a bleed-avoidance layer, as the music player's .record is, and a transformed subtree)
// is proven in packages/dragon/test/paint-gradient.test.ts, as a reject fixture blocks the web output too.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const GRADIENTS: readonly FixtureSpec[] = [
  layout('gradient-linear'),
  layout('gradient-radial'),
  both('bg-layers'),
  layout('gradient-fractional'),
  layout('calib-gradient-ramps'),
  layout('gradient-angles'),
  both('gradient-rounded'),
  both('gradient-backdrop'),
  layout('gradient-units'),
  both('bg-geometry'),
  layout('gradient-north-star'),
  // Percentage padding on absolutely positioned boxes resolves against the containing block's padding box (or the initial one).
  both('gradient-abspos'),
  reject('reject-gradient-hint', 'DRAGON_UNSUPPORTED_VALUE', '30%', 'background: "30%" is unsupported: colour hints'),
  reject('reject-gradient-fixed', 'DRAGON_UNSUPPORTED_VALUE', 'fixed', 'background: "fixed" is unsupported: background-attachment: fixed'),
  reject('reject-gradient-root', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(#fff, #ccc)', 'background-image on '),
  reject('reject-gradient-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(10px + 5%)', 'background: "calc(10px + 5%)" is unsupported: a colour stop position as calc()'),
  reject('reject-gradient-viewport', 'DRAGON_UNSUPPORTED_VALUE', '10vw', 'background: "10vw" is unsupported: background-size in a viewport unit'),
];
