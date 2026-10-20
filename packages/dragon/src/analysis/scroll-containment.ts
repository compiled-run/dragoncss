// The families Dragon accepts at their initial values alone (css/properties/initial-only.ts). Any other computed value is refused on
// every target, once per element and family. The values are checked computed, so one that arrives through var() or inherit is
// refused too. container-type takes normal and, on a box the layout engine contains, inline-size.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isInitialValue } from '../css/properties/initial-only.ts';
import type { Longhand } from '../css/properties.ts';
import { CONTAINMENT_INITIAL, CONTAINMENT_LONGHANDS } from '../css/properties/containment.ts';
import { OVERSCROLL_INITIAL, OVERSCROLL_LONGHANDS } from '../css/properties/overscroll.ts';
import { SCROLL_SNAP_INITIAL, SCROLL_SNAP_LONGHANDS } from '../css/properties/scroll-snap.ts';
import type { CssValue } from '../css/values.ts';
import type { ScrollContainmentFaults } from '../faults/scroll-containment.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';
import { isReplacedTag } from './elements/replaced.ts';
import { isSvgShapeTag } from './elements/svg.ts';

type InitialOnlyFamily = { readonly id: string; readonly longhands: readonly Longhand[]; readonly initial: { readonly [p: string]: CssValue }; readonly reason: string };

function refuseNonInitial(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, f: InitialOnlyFamily): void {
  const p = f.longhands.find((q) => !isInitialValue(f.initial[q] as CssValue, (el.props.get(q) as ResolvedValue).value));
  if (p !== undefined) refuse(el, targets, diagnostics, reported, f.id, p, `${f.reason}; only ${valueToString(f.initial[p] as CssValue)} is accepted`, valueToString(f.initial[p] as CssValue));
}

function refuse(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, family: string, p: Longhand, reason: string, accepted: string): void {
  const id = `${family}|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get(p) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: ${reason}`,
      manual: `Remove ${p} from ${el.element.address}, or set ${p}: ${accepted}.`,
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

/**
 * css-conditional-5 §2.1: container-type: inline-size compiles (lower/ios-layout.ts containInlineSize) on a box that generates a block
 * container, flex or grid box. Size containment, scroll-state and anchored containers are refused, as is inline-size on an inline box
 * (which css-contain-2 §3.2 does not contain) and on a replaced element or SVG shape (whose natural size it would drop). container-name
 * only names a query container for @container rules (analysis/container-rules.ts), so every name compiles.
 */
function checkContainerType(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = (el.props.get('container-type') as ResolvedValue).value;
  const type = v.kind === 'keyword' ? v.value : valueToString(v);
  if (type === 'normal') return;
  const display = (el.props.get('display') as ResolvedValue).value;
  const shown = display.kind === 'keyword' ? display.value : '';
  const tag = el.element.tag;
  const reason = type !== 'inline-size'
    ? 'Dragon implements inline-size query containers only, not size containment or scroll-state and anchored queries'
    : isReplacedTag(tag) || isSvgShapeTag(tag)
      ? `inline-size containment drops the natural size of <${tag}>, which Dragon does not model`
      : shown === 'inline' || shown === 'contents'
        ? `inline-size containment does not apply to a display: ${shown} element, which Dragon does not model`
        : null;
  if (reason !== null) refuse(el, targets, diagnostics, reported, 'container-query', 'container-type', reason, type === 'inline-size' ? 'normal' : 'inline-size');
}

/** Refuses the first non-initial longhand of each family on the element; each family's planted fault accepts it. */
export function checkScrollContainment(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  if (!faults.overscrollAccepted) refuseNonInitial(el, targets, diagnostics, reported, OVERSCROLL);
  if (!faults.scrollSnapAccepted) refuseNonInitial(el, targets, diagnostics, reported, SCROLL_SNAP);
  if (!faults.containmentAccepted) refuseNonInitial(el, targets, diagnostics, reported, CONTAINMENT);
  if (!faults.containerQueryAccepted) checkContainerType(el, targets, diagnostics, reported);
}
