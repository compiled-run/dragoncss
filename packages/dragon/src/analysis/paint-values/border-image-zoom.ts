// MISC-PAINT and ZOOM on the native targets: Chrome scales a border image's slices and its gradient by the effective zoom times
// the device scale, and the native border image writes pass the device scale alone (emit/paint/border-image.ts), so a drawn
// border image under an effective zoom other than 1 is refused on ios and android. The web output keeps it as written.
import type { Longhand } from '../../css/properties.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import { effectiveZoom } from '../zoom.ts';
import { borderImageOf, borderImageRefusal } from './border-image.ts';

/** Refuses natively every drawn border image (one the other checks accept) whose effective zoom is not 1. */
export function checkBorderImageZoom(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const native = targets.filter((t) => t === 'ios' || t === 'android');
  if (native.length === 0) return;
  const walk = (el: ResolvedElement, parentZoom: number): void => {
    const display = el.props.get('display' as Longhand)?.value;
    if (display !== undefined && display.kind === 'keyword' && display.value === 'none') return;
    const zoom = effectiveZoom(el, parentZoom);
    if (zoom !== 1 && borderImageOf(el) !== null && borderImageRefusal(el) === null) {
      const v = el.props.get('border-image-source' as Longhand) as ResolvedValue;
      for (const t of native) {
        const id = `${t}|border-image-zoom|${el.element.address}`;
        if (reported.has(id)) continue;
        reported.add(id);
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan),
          target: t,
          message: `border-image-source on <${el.element.tag}> ${el.element.address} is unsupported: its effective zoom is ${zoom}, and native draws a border image at zoom 1 only (MISC-PAINT)`,
          manual: 'Remove zoom from the box and its ancestors, or remove the border image.',
          basis: 'computed-value',
        }));
      }
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, zoom);
  };
  walk(root, 1);
}
