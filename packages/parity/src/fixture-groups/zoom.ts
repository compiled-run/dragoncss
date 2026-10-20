// Fixture group zoom (ZOOM): zoom where it is 1 in Ahem, both directions, on bordered and padded boxes with backgrounds: 1, normal,
// 100% in another ASCII case, 1.0, 0 (which Chrome computes to 1), a calculation, var(), the CSS-wide keywords and a flex row, so
// every target proves them. The reject: zoom 1.5, which scales a subtree no target lays out yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const ZOOM: readonly FixtureSpec[] = [
  layout('zoom-one', ['ltr', 'rtl']),
  reject('reject-zoom', 'DRAGON_UNSUPPORTED_VALUE', '1.5', 'zoom: 1.5 on <div> s is unsupported'),
];
