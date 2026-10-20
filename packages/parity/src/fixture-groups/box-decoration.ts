// Fixture group box-decoration (css-break-4 §5.4): box-decoration-break at slice in Ahem, both directions, on bordered and padded
// blocks with backgrounds and on inline boxes that wrap over several lines, in another ASCII case, through -webkit-box-decoration-break,
// with !important, through the CSS-wide keywords, var() and inherit, and on a flex row, so every target proves slice. The reject:
// clone on a wrapping inline box, which no target lays out or draws yet.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const BOX_DECORATION: readonly FixtureSpec[] = [
  layout('box-decoration-initial', ['ltr', 'rtl']),
  reject('reject-box-decoration-clone', 'DRAGON_UNSUPPORTED_VALUE', 'clone', 'box-decoration-break: clone'),
];
