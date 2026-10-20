// The families Dragon accepts at their initial values alone (css/properties/initial-only.ts). Any other computed value is refused on
// every target, once per element and family. The values are checked computed, so one that arrives through var() or inherit is
// refused too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isInitialValue } from '../css/properties/initial-only.ts';
import type { Longhand } from '../css/properties.ts';
import { CONTAINER_QUERY_INITIAL, CONTAINER_QUERY_LONGHANDS } from '../css/properties/container-query.ts';
import { CONTAINMENT_INITIAL, CONTAINMENT_LONGHANDS } from '../css/properties/containment.ts';
import { OVERSCROLL_INITIAL, OVERSCROLL_LONGHANDS } from '../css/properties/overscroll.ts';
import { SCROLL_SNAP_INITIAL, SCROLL_SNAP_LONGHANDS } from '../css/properties/scroll-snap.ts';
import type { CssValue } from '../css/values.ts';
import type { ScrollContainmentFaults } from '../faults/scroll-containment.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** A family Dragon accepts at its initial values alone: its longhands, their initial values, and why any other value is refused. */
export type InitialOnlyFamily = { readonly id: string; readonly longhands: readonly Longhand[]; readonly initial: { readonly [p: string]: CssValue }; readonly reason: string };

/** Refuses the element's first longhand of the family whose computed value is not initial, once per element and family. */
export function refuseNonInitial(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, f: InitialOnlyFamily): void {
  const p = f.longhands.find((q) => !isInitialValue(f.initial[q] as CssValue, (el.props.get(q) as ResolvedValue).value));
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

/** Refuses the first non-initial longhand of each family on the element; each family's planted fault accepts it. */
export function checkScrollContainment(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  if (!faults.overscrollAccepted) refuseNonInitial(el, targets, diagnostics, reported, OVERSCROLL);
  if (!faults.scrollSnapAccepted) refuseNonInitial(el, targets, diagnostics, reported, SCROLL_SNAP);
  if (!faults.containmentAccepted) refuseNonInitial(el, targets, diagnostics, reported, CONTAINMENT);
  if (!faults.containerQueryAccepted) refuseNonInitial(el, targets, diagnostics, reported, CONTAINER_QUERY);
}
