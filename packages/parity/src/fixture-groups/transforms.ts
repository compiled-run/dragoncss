// css-transforms-1 (PNT2): transform, transform-origin and will-change, and css-transforms-2's translate, rotate and scale. Rotated,
// scaled, translated and matrix() boxes with every origin form, nested and clipped transforms, transformed text, flex items, the
// individual transforms alone, together and with transform, and the music-player demo's patterns; the rejects name
// what PNT2 refuses (PNT2-m: skew, 3D, perspective, a z origin or translation and a composition that skews; the containing-block, viewport-unit,
// will-change and root refusals). The perspective property (not the perspective() function) is drawn as an identity transform:
// over 2D transforms it changes no pixel, only the stacking context and containing block (transform-perspective). The individual
// transforms translate, rotate and scale (css-transforms-2 §4) alone and composed before transform about transform-origin
// (transform-indiv-values, transform-indiv-compose); the rejects name their 3D parts and a composition that skews.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

const M = 'skew, 3D functions and perspective are not supported yet (package PNT2-m)';

export const TRANSFORMS: readonly FixtureSpec[] = [
  layout('transform-rotate'),
  layout('transform-scale'),
  layout('transform-translate'),
  layout('transform-origin'),
  layout('transform-nested'),
  layout('transform-text'),
  layout('transform-matrix'),
  layout('transform-demo'),
  layout('transform-clip'),
  layout('transform-will-change'),
  both('transform-perspective'),
  layout('transform-flex'),
  both('transform-direction'),
  layout('transform-individual'),
  both('transform-indiv-values'),
  layout('transform-indiv-compose'),
  reject('reject-transform-skew', 'DRAGON_UNSUPPORTED_VALUE', 'skewX(10deg)', `transform: skewX(10deg) is unsupported: ${M}`),
  reject('reject-transform-3d', 'DRAGON_UNSUPPORTED_VALUE', 'rotateY(20deg)', `transform: rotateY(20deg) is unsupported: ${M}`),
  reject('reject-transform-perspective', 'DRAGON_UNSUPPORTED_VALUE', 'perspective(200px)', `transform: perspective(200px) is unsupported: ${M}`),
  reject('reject-transform-scale-rotate', 'DRAGON_UNSUPPORTED_VALUE', 'scaleX(2) rotate(30deg)', 'transform: scaleX(2) rotate(30deg) is unsupported: a rotation after a non-uniform scale skews the box'),
  reject('reject-transform-individual-z', 'DRAGON_UNSUPPORTED_VALUE', '6px', `translate: 6px is unsupported: a z translation moves the box off the plane: ${M}`),
  reject('reject-transform-origin-z', 'DRAGON_UNSUPPORTED_VALUE', '10px', `transform-origin: 10px is unsupported: it moves the origin off the plane: ${M}`),
  reject('reject-transform-viewport-unit', 'DRAGON_UNSUPPORTED_VALUE', '5vw', 'transform: 5vw is unsupported: vw in a transform function'),
  reject('reject-transform-will-change', 'DRAGON_UNSUPPORTED_VALUE', 'left', 'will-change: left is unsupported: only auto, transform and opacity are supported'),
  reject('reject-transform-containing-block', 'DRAGON_UNSUPPORTED_VALUE', 'translate(5px)', 'a transform on a makes it the containing block of the absolutely positioned p'),
  reject('reject-transform-body', 'DRAGON_UNSUPPORTED_VALUE', 'rotate(2deg)', 'a transform on <body> body is not supported'),
  reject('reject-transform-indiv-3d', 'DRAGON_UNSUPPORTED_VALUE', 'y', `rotate: y is unsupported: a rotation axis other than z turns the box out of the plane: ${M}`),
  reject('reject-transform-indiv-z', 'DRAGON_UNSUPPORTED_VALUE', '5px', `translate: 5px is unsupported: a z translation moves the box off the plane: ${M}`),
  reject('reject-transform-indiv-scale-z', 'DRAGON_UNSUPPORTED_VALUE', '2', `scale: 2 is unsupported: a z scale is a 3D transform: ${M}`),
  reject('reject-transform-indiv-skew', 'DRAGON_UNSUPPORTED_VALUE', 'rotate(30deg)', 'the translate, rotate, scale and transform of a compose to a rotation after a non-uniform scale'),
];
