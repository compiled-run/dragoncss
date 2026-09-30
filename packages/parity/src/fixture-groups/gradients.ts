// BG2 (notes/T046-paint-spec.md §5.4): CSS gradients and multiple background layers, drawn by Dragon with the translated Chrome
// 145 raster (paint-gradient.ts): linear gradients in every direction form, radial gradients in every shape and extent, repeating
// gradients, layer lists with their geometry, fractional boxes, and the calibration ramps for the gradient allowance, which cross
// Chrome's cc raster tiles; the rejects cover what Dragon refuses and names the package that lifts it.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const GRADIENTS: readonly FixtureSpec[] = [
  layout('gradient-linear'),
  layout('gradient-radial'),
  both('bg-layers'),
  layout('gradient-fractional'),
  layout('calib-gradient-ramps'),
  reject('reject-gradient-hint', 'DRAGON_UNSUPPORTED_VALUE', '30%', 'background: "30%" is unsupported: colour hints'),
  reject('reject-gradient-em', 'DRAGON_UNSUPPORTED_VALUE', '1em', 'background: "1em" is unsupported: a colour stop position in em'),
  reject('reject-gradient-tiling', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(red, blue) 0 0 / 50% 50%', 'background-image on '),
  reject('reject-gradient-translucent', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(red, transparent)', 'background-image on '),
  reject('reject-gradient-space', 'DRAGON_UNSUPPORTED_VALUE', 'space', 'background: "space" is unsupported: background-repeat: space'),
  reject('reject-gradient-fixed', 'DRAGON_UNSUPPORTED_VALUE', 'fixed', 'background: "fixed" is unsupported: background-attachment: fixed'),
  reject('reject-gradient-root', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(#fff, #ccc)', 'background-image on '),
];
