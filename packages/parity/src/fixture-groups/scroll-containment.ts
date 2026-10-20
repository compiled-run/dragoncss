// Fixture group scroll-containment: the overscroll, scroll-snap, containment and container-query longhands at their initial values in
// Ahem, both directions. scroll-initial-longhands puts the scroll ones on scroll containers and their content (its scroll- prefix
// gives it Chrome scroll-metric captures), through every shorthand, longhand and flow-relative name, in another ASCII case and
// through the CSS-wide keywords; containment-initial does the same for the containment and container ones on bordered and padded
// boxes and a flex row; containment-layout sets contain's layout, paint, style and size values on blocks, inline-blocks beside text,
// a baseline-aligned flex row and absolutely positioned boxes. The rejects: size containment on a flex container, a snap type, an
// overscroll behaviour and a hidden content-visibility, which no target implements yet (container types are the container-query group's).
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const SCROLL_CONTAINMENT: readonly FixtureSpec[] = [
  layout('scroll-initial-longhands', ['ltr', 'rtl']),
  layout('containment-initial', ['ltr', 'rtl']),
  layout('containment-layout', ['ltr', 'rtl']),
  reject('reject-scroll-snap-type', 'DRAGON_UNSUPPORTED_VALUE', 'y mandatory', 'scroll-snap-type: y mandatory'),
  reject('reject-overscroll-contain', 'DRAGON_UNSUPPORTED_VALUE', 'contain', 'overscroll-behavior-x: contain'),
  reject('reject-contain-content-visibility', 'DRAGON_UNSUPPORTED_VALUE', 'hidden', 'content-visibility: hidden'),
  reject('reject-contain-size-flex', 'DRAGON_UNSUPPORTED_VALUE', 'strict', 'contain: strict on <div> f is unsupported'),
];
