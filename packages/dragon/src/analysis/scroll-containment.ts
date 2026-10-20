// The families Dragon accepts at their initial values alone (css/properties/initial-only.ts): overscroll, scroll-snap, containment,
// container-query, anchor-position, svg-extra, view-transition and animation-extra. Any other computed value is refused on
// every target, once per element and family. The values are checked computed, so one that arrives through var() or inherit is
// refused too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isInitialValue } from '../css/properties/initial-only.ts';
import type { Longhand } from '../css/properties.ts';
import { CONTAINER_QUERY_INITIAL, CONTAINER_QUERY_LONGHANDS } from '../css/properties/container-query.ts';
import { CONTAINMENT_INITIAL, CONTAINMENT_LONGHANDS } from '../css/properties/containment.ts';
import { ANCHOR_POSITION_INITIAL, ANCHOR_POSITION_LONGHANDS } from '../css/properties/anchor-position.ts';
import { SVG_EXTRA_INITIAL, SVG_EXTRA_LONGHANDS } from '../css/properties/svg-extra.ts';
import { VIEW_TRANSITION_INITIAL, VIEW_TRANSITION_LONGHANDS } from '../css/properties/view-transition.ts';
import { ANIMATION_EXTRA_INITIAL, ANIMATION_EXTRA_LONGHANDS } from '../css/properties/animation-extra.ts';
import { OVERSCROLL_INITIAL, OVERSCROLL_LONGHANDS } from '../css/properties/overscroll.ts';
import { SCROLL_SNAP_INITIAL, SCROLL_SNAP_LONGHANDS } from '../css/properties/scroll-snap.ts';
import type { CssValue } from '../css/values.ts';
import type { ScrollContainmentFaults } from '../faults/scroll-containment.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** userAgent: a value the Chrome UA sheet sets (origin user-agent) is accepted too, as every page has it. */
type InitialOnlyFamily = { readonly id: string; readonly longhands: readonly Longhand[]; readonly initial: { readonly [p: string]: CssValue }; readonly reason: string; readonly userAgent?: true };

function refuseNonInitial(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, f: InitialOnlyFamily): void {
  const accepted = (q: Longhand): boolean => {
    const v = el.props.get(q) as ResolvedValue;
    return isInitialValue(f.initial[q] as CssValue, v.value) || (f.userAgent === true && v.origin === 'user-agent');
  };
  const p = f.longhands.find((q) => !accepted(q));
  if (p === undefined) return;
  const id = `${f.id}|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get(p) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  const initial = valueToString(f.initial[p] as CssValue);
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: ${f.reason}; only ${initial} is accepted`,
      manual: `Remove ${p} from ${el.element.address}, or set ${p}: ${initial}.`,
      basis: 'computed-value',
    }));
  }
}

// css-overscroll-1, css-scroll-anchoring-1: auto leaves scroll chaining and anchoring to the platform scroll view, as every Dragon
// scroll container does; contain, none and overflow-anchor: none ask for behaviour no target implements.
const OVERSCROLL: InitialOnlyFamily = { id: 'overscroll', longhands: OVERSCROLL_LONGHANDS, initial: OVERSCROLL_INITIAL, reason: 'Dragon implements no overscroll behaviour or scroll anchoring yet' };
// css-scroll-snap-1: a snap type snaps scroll positions, and scroll-padding and scroll-margin move snap and scrollIntoView targets;
// Dragon does neither yet.
const SCROLL_SNAP: InitialOnlyFamily = { id: 'scroll-snap', longhands: SCROLL_SNAP_LONGHANDS, initial: SCROLL_SNAP_INITIAL, reason: 'Dragon implements no scroll snapping or scroll target offsets yet' };
// css-contain-2: containment and content-visibility change layout and can skip painting a box's contents (text included); the
// intrinsic sizes apply only under size containment.
const CONTAINMENT: InitialOnlyFamily = { id: 'containment', longhands: CONTAINMENT_LONGHANDS, initial: CONTAINMENT_INITIAL, reason: 'Dragon implements no containment or content-visibility yet' };
// css-conditional-5: a container-type other than normal applies size containment, and a container-name only names a query container.
const CONTAINER_QUERY: InitialOnlyFamily = { id: 'container-query', longhands: CONTAINER_QUERY_LONGHANDS, initial: CONTAINER_QUERY_INITIAL, reason: 'Dragon implements no container queries or the containment they apply yet' };

// css-anchor-position-1: an anchor name or scope only names anchors, and the position longhands move or hide an anchored box.
const ANCHOR_POSITION: InitialOnlyFamily = { id: 'anchor-position', longhands: ANCHOR_POSITION_LONGHANDS, initial: ANCHOR_POSITION_INITIAL, reason: 'Dragon implements no anchor positioning yet' };
// SVG 2, css-masking-1: gradient stops, filter floods, masks and SVG text, which Dragon does not build, and the rendering hints,
// which would change how its shapes are drawn.
const SVG_EXTRA: InitialOnlyFamily = { id: 'svg-extra', longhands: SVG_EXTRA_LONGHANDS, initial: SVG_EXTRA_INITIAL, reason: 'Dragon builds no SVG gradient, filter, mask or text and draws its shapes with the default rendering hints' };

// css-view-transitions-2: the names, classes and groups of a view transition's captured boxes. Chrome's UA sheet names the root
// (:root { view-transition-name: root }), which captures it only once a transition starts, so that UA value is accepted too.
const VIEW_TRANSITION: InitialOnlyFamily = { id: 'view-transition', longhands: VIEW_TRANSITION_LONGHANDS, initial: VIEW_TRANSITION_INITIAL, reason: 'Dragon implements no view transitions yet', userAgent: true };
// css-values-5 §8.2, scroll-animations-1 §4.2: keyword size interpolation and the scope of named timelines.
const ANIMATION_EXTRA: InitialOnlyFamily = { id: 'animation-extra', longhands: ANIMATION_EXTRA_LONGHANDS, initial: ANIMATION_EXTRA_INITIAL, reason: 'Dragon interpolates no intrinsic size keyword and has no scroll-driven timelines yet' };

/** Refuses the first non-initial longhand of each family on the element; each family's planted fault accepts it. */
export function checkScrollContainment(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  if (!faults.overscrollAccepted) refuseNonInitial(el, targets, diagnostics, reported, OVERSCROLL);
  if (!faults.scrollSnapAccepted) refuseNonInitial(el, targets, diagnostics, reported, SCROLL_SNAP);
  if (!faults.containmentAccepted) refuseNonInitial(el, targets, diagnostics, reported, CONTAINMENT);
  if (!faults.containerQueryAccepted) refuseNonInitial(el, targets, diagnostics, reported, CONTAINER_QUERY);
  if (!faults.anchorPositionAccepted) refuseNonInitial(el, targets, diagnostics, reported, ANCHOR_POSITION);
  if (!faults.svgExtraAccepted) refuseNonInitial(el, targets, diagnostics, reported, SVG_EXTRA);
  if (!faults.viewTransitionAccepted) refuseNonInitial(el, targets, diagnostics, reported, VIEW_TRANSITION);
  if (!faults.animationExtraAccepted) refuseNonInitial(el, targets, diagnostics, reported, ANIMATION_EXTRA);
}
