// The families Dragon accepts at their initial values alone (css/properties/initial-only.ts). Any other computed value is refused on
// every target, once per element and family. The values are checked computed, so one that arrives through var() or inherit is
// refused too. container-type takes normal and, on a box the layout engine contains, inline-size. Scroll snapping
// (css/properties/scroll-snap.ts) is accepted at any value except an active snap pair on iOS and Android (checkScrollSnap).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isInitialValue } from '../css/properties/initial-only.ts';
import type { Longhand } from '../css/properties.ts';
import { CONTAINMENT_INITIAL, CONTAINMENT_INITIAL_ONLY } from '../css/properties/containment.ts';
import { alignsSnap, snapTypeOf } from '../css/properties/scroll-snap.ts';
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

// css-contain-2: content-visibility skips laying out and painting a box's contents (text included), and the intrinsic sizes apply
// under size containment; contain itself is analysis/containment.ts's.
const CONTAINMENT: InitialOnlyFamily = { id: 'containment', longhands: CONTAINMENT_INITIAL_ONLY, initial: CONTAINMENT_INITIAL, reason: 'Dragon skips no contents and sizes no contained box from contain-intrinsic-size yet' };

/**
 * css-conditional-5 §2.1: container-type: inline-size compiles (lower/ios-layout.ts containInlineSize, LayoutStyle containSize inline-size) on a box that generates a block
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

/** Refuses the first non-initial longhand of each initial-only family on the element; each family's planted fault accepts it. */
export function checkScrollContainment(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  if (!faults.containmentAccepted) refuseNonInitial(el, targets, diagnostics, reported, CONTAINMENT);
  if (!faults.containerQueryAccepted) checkContainerType(el, targets, diagnostics, reported);
}

const keywordOf = (el: ResolvedElement, p: Longhand): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};
const isScrollKeyword = (k: string): boolean => k === 'hidden' || k === 'auto' || k === 'scroll';

/**
 * css-scroll-snap-1 §4: a scroll container whose scroll-snap-type is not none snaps its scroll position to the snap positions of
 * its snap areas, the boxes it is the nearest scroll container of whose scroll-snap-align is not none. Chrome 145 snaps such a
 * container even at rest, before any scroll, and may snap a proximity one, so every such pair is refused on iOS and Android, once
 * per container, where neither snaps yet (SCROLL-SNAP). Everything else changes nothing in Chrome and is accepted: scroll-padding,
 * scroll-margin and scroll-snap-stop anywhere, a snap type on a box that does not scroll or with no snap area, and an alignment with
 * no snapping container. The viewport takes its snap type from the root element alone (Chrome does not propagate it from body).
 * propagated is the element whose overflow went to the viewport (css-overflow-3 §3.3), which is then no scroll container itself.
 * Planted fault scrollSnapAccepted accepts an active pair.
 */
export function checkScrollSnap(root: ResolvedElement, propagated: ResolvedElement | null, nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: ScrollContainmentFaults): void {
  if (faults.scrollSnapAccepted || nativeTargets.length === 0) return;
  // null is the viewport. Per container, its first snap area in document order.
  const firstArea = new Map<ResolvedElement | null, ResolvedElement>();
  const order: (ResolvedElement | null)[] = [null];
  // chain: the scroll containers around el, outermost (the viewport) first; from: the first of them that may be el's nearest.
  const walk = (el: ResolvedElement, chain: readonly (ResolvedElement | null)[], from: number): void => {
    const display = keywordOf(el, 'display');
    if (display === 'none') return;
    // An absolutely or fixed positioned box's containing block may lie outside the inner scroll containers, so it counts as an area
    // of each of them (it may snap any of them).
    const outside = keywordOf(el, 'position') === 'absolute' || keywordOf(el, 'position') === 'fixed' ? 0 : from;
    // A snap area is a box (css-scroll-snap-1 §5): a display: contents element has none, and Blink's snap areas are LayoutBoxes, so
    // a non-replaced inline box is none either; an atomic inline (inline-block, a replaced element) is one.
    const box = display !== 'contents' && (display !== 'inline' || isReplacedTag(el.element.tag));
    if (el !== root && box && alignsSnap((el.props.get('scroll-snap-align') as ResolvedValue).value)) {
      for (const c of chain.slice(outside)) if (!firstArea.has(c)) firstArea.set(c, el);
    }
    // Overflow makes only a block, flex or grid container a scroll container (css-overflow-3 §3), never an inline box.
    const scroller = el !== root && el !== propagated && display !== 'inline' && display !== 'contents' && (isScrollKeyword(keywordOf(el, 'overflow-x')) || isScrollKeyword(keywordOf(el, 'overflow-y')));
    if (scroller) order.push(el);
    const inner = scroller ? [...chain, el] : chain;
    for (const c of el.children) if (c.kind === 'element') walk(c, inner, scroller ? inner.length - 1 : outside);
  };
  walk(root, [null], 0);
  for (const container of order) {
    const area = firstArea.get(container);
    const owner = container ?? root;
    const type = owner.props.get('scroll-snap-type') as ResolvedValue;
    const snapType = snapTypeOf(type.value);
    if (area === undefined || snapType === null) continue;
    const [where, on] = container === null ? ['the viewport', ` on ${root.element.address}`] : [container.element.address, ''];
    const align = valueToString((area.props.get('scroll-snap-align') as ResolvedValue).value);
    for (const t of nativeTargets) {
      const id = `${t}|scroll-snap|${container === null ? 'viewport' : container.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin: type.declaration !== null ? authored(type.declaration.valueSpan) : owner.element.node.origin,
        target: t,
        message: `scroll snapping in ${where} (scroll-snap-type: ${snapType}${on}, with ${area.element.address} aligned ${align}) is not implemented on ${t} yet (SCROLL-SNAP): Chrome snaps the scroll position even at rest`,
        manual: `Set scroll-snap-type: none on ${owner.element.address}, or scroll-snap-align: none on the boxes it scrolls.`,
        basis: 'computed-value',
      }));
    }
  }
}
