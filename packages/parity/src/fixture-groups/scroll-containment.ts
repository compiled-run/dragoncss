// Fixture group scroll-containment: the overscroll, scroll-snap, containment and container-query longhands at their initial values in
// Ahem, both directions. scroll-initial-longhands puts the scroll ones on scroll containers and their content (its scroll- prefix
// gives it Chrome scroll-metric captures), through every shorthand, longhand and flow-relative name, in another ASCII case and
// through the CSS-wide keywords; containment-initial does the same for the containment and container ones on bordered and padded
// boxes and a flex row. The rejects: a snap type, an overscroll behaviour, a hidden content-visibility and a container type, which
// no target implements yet. render-anchor-initial does the same for image-rendering, the anchor positioning longhands and the
// svg-extra longhands on boxes, an absolutely positioned box and a flex row, with rejects of a pixelated image rendering, an anchor
// name and a text anchor.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const SCROLL_CONTAINMENT: readonly FixtureSpec[] = [
  layout('scroll-initial-longhands', ['ltr', 'rtl']),
  layout('containment-initial', ['ltr', 'rtl']),
  reject('reject-scroll-snap-type', 'DRAGON_UNSUPPORTED_VALUE', 'y mandatory', 'scroll-snap-type: y mandatory'),
  reject('reject-overscroll-contain', 'DRAGON_UNSUPPORTED_VALUE', 'contain', 'overscroll-behavior-x: contain'),
  reject('reject-contain-content-visibility', 'DRAGON_UNSUPPORTED_VALUE', 'hidden', 'content-visibility: hidden'),
  reject('reject-container-type', 'DRAGON_UNSUPPORTED_VALUE', 'inline-size', 'container-type: inline-size'),
  layout('render-anchor-initial', ['ltr', 'rtl']),
  reject('reject-image-rendering', 'DRAGON_UNSUPPORTED_VALUE', 'pixelated', 'image-rendering: pixelated'),
  reject('reject-anchor-name', 'DRAGON_UNSUPPORTED_VALUE', '--card', 'anchor-name: --card'),
  reject('reject-text-anchor', 'DRAGON_UNSUPPORTED_VALUE', 'middle', 'text-anchor: middle'),
];
