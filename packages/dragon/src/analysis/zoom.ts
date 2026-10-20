// ZOOM (css-viewport-1 §5): zoom is accepted where it is 1 (css/properties/zoom.ts). Any other computed value is refused on every
// target, once per element: it scales the box and its descendants, which Dragon does not lay out yet. The value is checked computed,
// so one that arrives through var() is checked too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { zoomOf } from '../css/properties/zoom.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** Refuses an element's zoom unless it is 1. */
export function checkZoom(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('zoom') as ResolvedValue | undefined;
  if (v === undefined || zoomOf(v.value) === 1) return;
  const id = `zoom|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `zoom: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: it scales the box and its descendants, which Dragon does not lay out yet (ZOOM); only zoom 1 (normal, 100%) is accepted`,
      manual: `Remove zoom from ${el.element.address}, or size it with its own lengths.`,
      basis: 'computed-value',
    }));
  }
}
