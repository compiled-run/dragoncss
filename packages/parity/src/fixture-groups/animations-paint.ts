// Fixture group animations-paint (T065 ANIM-b2): the reject fixtures of the transform rows of the spec's §1 table. The frame
// fixtures that prove the supported rows (anim-spin, anim-slide) are frame cases, found by their frames.json (anim-cases.ts).
import type { FixtureSpec } from '../fixtures.ts';
import { reject } from './define.ts';

export const ANIMATIONS_PAINT: readonly FixtureSpec[] = [
  reject('reject-anim-mismatched-transform', 'DRAGON_UNSUPPORTED_VALUE', 'rotate(90deg)', 'transform in @keyframes k on a: mismatched transform functions need matrix interpolation (package ANIM-m)'),
  reject('reject-anim-3d-rotate', 'DRAGON_UNSUPPORTED_VALUE', 'rotate3d(1, 0, 0, 45deg)', 'transform: rotate3d(1,0,0,45deg) is unsupported: skew, 3D functions and perspective are not supported yet (package PNT2-m)'),
];
