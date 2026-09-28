// css-backgrounds-3 §3.10: the background shorthand. Its layout fixtures capture and compare every background longhand, not only
// background-color (computedExtra); the reject fixtures cover !important, a non-initial image and multiple layers.
import { BACKGROUND_RESET_LONGHANDS } from 'dragon';
import type { BackgroundResetLonghand } from 'dragon';
import type { FixtureSpec } from '../fixtures.ts';
import { reject } from './define.ts';

const background = (id: string): FixtureSpec => ({ id, format: 'html', kind: 'layout', gate: 'default', environments: ['ltr'], source: 'hand-written', rootFont: 'ahem', computedExtra: Object.keys(BACKGROUND_RESET_LONGHANDS) as BackgroundResetLonghand[] });

export const BACKGROUND: readonly FixtureSpec[] = [
  background('background-shorthand-colors'),
  background('background-shorthand-cascade'),
  reject('reject-background-important', 'DRAGON_UNSUPPORTED_IMPORTANT', 'background: red !important'),
  reject('reject-background-image', 'DRAGON_UNSUPPORTED_VALUE', 'linear-gradient(red, blue)', 'background: "linear-gradient(red, blue)" sets background-image'),
  reject('reject-background-layers', 'DRAGON_UNSUPPORTED_VALUE', 'none, red', 'background: "none, red" has 2 layers'),
];
