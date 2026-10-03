// css-backgrounds-3 §3.10: the background shorthand. Its layout fixtures compare every background longhand (since BG2 every
// layer longhand is a real longhand, captured with LONGHANDS) and !important on the shorthand (css-cascade-5 §6.4); the reject
// fixtures cover an image and a layer list Dragon does not draw (BG2 retargeted both: gradients and plain layer lists compile).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const BACKGROUND: readonly FixtureSpec[] = [
  layout('background-shorthand-colors'),
  layout('background-shorthand-cascade'),
  layout('background-important'),
  reject('reject-background-image', 'DRAGON_UNSUPPORTED_VALUE', 'url(a.png)', 'background: "url(a.png)" is unsupported: url() images'),
  reject('reject-background-layers', 'DRAGON_UNSUPPORTED_VALUE', 'conic-gradient(red, blue)', 'background: "conic-gradient(red, blue)" is unsupported: conic gradients'),
];
