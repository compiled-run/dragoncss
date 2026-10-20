// Fixture group scroll-containment: the overscroll, scroll-snap, containment and container-query longhands at their initial values in
// Ahem, both directions. scroll-initial-longhands puts the scroll ones on scroll containers and their content (its scroll- prefix
// gives it Chrome scroll-metric captures), through every shorthand, longhand and flow-relative name, in another ASCII case and
// through the CSS-wide keywords; containment-initial does the same for the containment and container ones on bordered and padded
// boxes and a flex row. scroll-snap-values holds scroll-padding and scroll-margin in px, em, rem, % and calc(), and snap alignments,
// stops and types wherever nothing snaps: alignments with no snapping container, a snap type on a box that does not scroll, and
// scroll containers with a snap type and no snap area. The rejects: a hidden content-visibility and a container type, which no
// target implements yet (the overscroll values are all supported: fixture-groups/overscroll.ts). An active snap pair is refused on
// iOS and Android alone, which a reject case cannot express (it needs every output blocked), so
// packages/dragon/test/scroll-containment.test.ts covers it.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const SCROLL_CONTAINMENT: readonly FixtureSpec[] = [
  layout('scroll-initial-longhands', ['ltr', 'rtl']),
  layout('containment-initial', ['ltr', 'rtl']),
  both('scroll-snap-values'),
  reject('reject-contain-content-visibility', 'DRAGON_UNSUPPORTED_VALUE', 'hidden', 'content-visibility: hidden'),
  reject('reject-container-type', 'DRAGON_UNSUPPORTED_VALUE', 'inline-size', 'container-type: inline-size'),
];
