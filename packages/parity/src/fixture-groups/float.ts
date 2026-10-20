// Fixture group float (FLT, CSS2 §9.5): floats in block flow where nothing in flow is beside them. A float is shrink-to-fit
// (§10.3.5), placed at its flow position beside the floats before it in its container, left or right, wrapping below the nearest
// float bottom that leaves room (§9.5.1), and counted in its block formatting context root's height (§10.6.7); a box sized by its
// content sums its floats side by side. The compiler refuses a float beside text or other in-flow content, in an inline-block, and
// with clear (analysis/computed-checks.ts checkFloats); inert-layout's reject-float-block pins the text case.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const FLOAT: readonly FixtureSpec[] = [
  // The coverage probe's shape: a float of two blocks of text, alone in a block.
  both('float-left'),
  both('float-right'),
  // Left and right floats side by side and wrapping, with margins, after an in-flow block, a replaced float, a float of text with
  // padding and a border, floats in a flex item sized by its content, and a float in a plain block of an overflow: hidden root.
  both('float-row'),
  // A zero-width float leaves the line as wide as it was (Blink adds no layout opportunity edge for it), and a flex float.
  both('float-zero-width'),
  reject('reject-float-keyword-width', 'DRAGON_UNSUPPORTED_VALUE', 'max-content', 'width: max-content on a on a float (FLT)'),
  reject('reject-float-aspect-ratio', 'DRAGON_UNSUPPORTED_VALUE', 'left', 'float: left with aspect-ratio on a'),
  reject('reject-float-after', 'DRAGON_UNSUPPORTED_VALUE', 'left', 'float: left on f is followed in its formatting context by k'),
  reject('reject-float-clear', 'DRAGON_UNSUPPORTED_VALUE', 'right', 'float: right with clear: left on g'),
  reject('reject-float-inline-block', 'DRAGON_UNSUPPORTED_VALUE', 'left', 'float: left on f in ib, whose display is inline-block'),
];
