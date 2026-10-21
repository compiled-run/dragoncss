// Fixture group contain-intrinsic (CONTAIN-IS, css-sizing-4 §5.2): contain-intrinsic-width, -height and contain-intrinsic-size in
// Ahem, both directions. contain-intrinsic-ahem sizes size-contained boxes from them: a strict block, inline-blocks with size and
// inline-size containment and container-type: inline-size (whose height the intrinsic height does not set), an explicit width
// over an intrinsic one, an absolutely positioned box from the one-value shorthand, a height and a min-height over an intrinsic
// height, em, fractional px, none with padding, another ASCII case and var(); and boxes where no size containment applies, which
// the values do not change (auto with a length or none among them). The rejects: auto on a size-contained box (it takes the last
// remembered size, which Dragon does not track), a percentage (Chrome drops it), and the flow-relative contain-intrinsic-inline-size.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const CONTAIN_INTRINSIC: readonly FixtureSpec[] = [
  layout('contain-intrinsic-ahem', ['ltr', 'rtl']),
  reject('reject-contain-intrinsic-auto', 'DRAGON_UNSUPPORTED_VALUE', 'auto 40px', 'contain-intrinsic-width: auto 40px on <div> s is unsupported: auto takes'),
  reject('reject-contain-intrinsic-percent', 'DRAGON_UNSUPPORTED_VALUE', '10%', 'contain-intrinsic-height: 10% on <div> s is unsupported'),
  reject('reject-contain-intrinsic-inline-size', 'DRAGON_UNSUPPORTED_VALUE', '30px', 'contain-intrinsic-inline-size: 30px on <div> s is unsupported'),
];
