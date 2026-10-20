// The touch-action refusal (pointerevents-3 §10.2): in Chrome a pan that starts on a box moves the page or a scroll container only in
// the directions the box's touch-action, intersected with its ancestors' up to the nearest scroll container, allows (the spec's
// effective touch action, StyleAdjuster::AdjustEffectiveTouchAction), whichever scroller the pan then chains to. So a box's
// touch-action limits the pans of its own scroll view and of every scroll view around it, and never those of a scroll container
// inside it, where Chrome resets the pan restrictions. Native output pans only its scroll views (a box with overflow auto or scroll,
// each on the axes it scrolls, scroll.ts) and an iframe's web view; the native root view never scrolls, and nothing zooms. So on
// iOS and Android a touch-action that stops a pan direction changes nothing Chrome does that native does not, and compiles, unless
// the box or an ancestor scrolls natively on the axis of a stopped direction, or the box is or holds an iframe; there it is
// refused. Every scroll view is taken to scroll whatever its content, as the content may overflow at run time. auto, manipulation
// and pan-x pan-y stop no pan, so they compile everywhere. Chrome applies touch-action to every element but a display: inline box
// other than an <img> or an outer <svg> (an inline <iframe> included), a table row, row group, column or column group (a table
// header or footer group keeps it), and a box that generates none (display contents or none), which has no area a touch could
// start on.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { touchActionPans } from '../css/properties/touch-action.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import type { ResolvedElement } from './resolve.ts';

const IGNORED_DISPLAY: readonly string[] = ['contents', 'none', 'table-row', 'table-row-group', 'table-column', 'table-column-group'];

/** A box native output pans: the axes its scroll view scrolls. */
export type NativePanner = { readonly address: string; readonly x: boolean; readonly y: boolean };

const scrolls = (el: ResolvedElement, p: 'overflow-x' | 'overflow-y'): boolean => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' && (v.value === 'auto' || v.value === 'scroll');
};

/** The axes el's native scroll view scrolls (overflow auto or scroll), or null; propagated (whose overflow the viewport took) has none. */
export function nativePanner(el: ResolvedElement, propagated: ResolvedElement | null): NativePanner | null {
  if (el === propagated) return null;
  const x = scrolls(el, 'overflow-x');
  const y = scrolls(el, 'overflow-y');
  return x || y ? { address: el.element.address, x, y } : null;
}

const holdsIframe = (el: ResolvedElement): boolean => el.element.tag === 'iframe' || el.children.some((c) => c.kind === 'element' && holdsIframe(c));

/**
 * Refuses, per native target, a touch-action on el that stops a pan direction, where Chrome applies it and native pans that
 * direction: panners are el's native scroll views, outermost first, el's own last.
 */
export function checkTouchAction(el: ResolvedElement, panners: readonly NativePanner[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('touch-action') as ResolvedValue | undefined;
  if (v === undefined) throw new Error(`${el.element.address}: touch-action did not resolve`);
  if (v.value.kind !== 'keyword') throw new Error(`${el.element.address}: touch-action did not compute to a keyword`);
  const k = v.value.value;
  const pans = touchActionPans(k);
  if (pans.size === 4) return;
  const display = el.props.get('display') as ResolvedValue | undefined;
  const d = display?.value.kind === 'keyword' ? display.value.value : null;
  if (d !== null && IGNORED_DISPLAY.includes(d)) return;
  if (d === 'inline' && el.element.tag !== 'img' && el.element.tag !== 'svg') return;
  const stopsX = !pans.has('left') || !pans.has('right');
  const stopsY = !pans.has('up') || !pans.has('down');
  // The nearest scroll view whose pans the value stops in some direction.
  const panner = [...panners].reverse().find((p) => (p.x && stopsX) || (p.y && stopsY));
  const iframe = panner === undefined && holdsIframe(el);
  if (panner === undefined && !iframe) return;
  const how = k === 'none' || k === 'pinch-zoom' ? 'in any direction' : 'in the directions it leaves out';
  const what = panner === undefined ? `the document of ${el.element.tag === 'iframe' ? 'its' : 'an'} iframe` : panner.address === el.element.address ? 'itself' : `the scroll container ${panner.address}`;
  for (const t of nativeTargets) {
    const id = `${t}|touch-action|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan),
      target: t,
      message: `${el.element.address} has touch-action ${k}, so Chrome stops a pan that starts on it from scrolling ${what} ${how}; ${t} ${panner === undefined ? 'web views pan' : 'scroll views pan'} in every direction they scroll, so Dragon compiles a touch-action that stops a pan direction only where native pans nothing in that direction`,
      manual: `Remove touch-action from ${el.element.address}, or set it to manipulation.`,
      basis: 'computed-value',
    }));
  }
}
