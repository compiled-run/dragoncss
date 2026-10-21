// Font-metric units (css-values-4 §6.1.1): ex, ch and cap compute to an absolute length from the element's own primary font, so
// Dragon resolves them only in the non-inherited layout lengths css/units.ts unitRefusalIn admits, where the length is the
// element's own. A child that takes one with a CSS-wide keyword (inherit, or a revert that reaches it) inherits its parent's
// computed px, which every target would re-measure against the child's font, so it is refused for every target.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { FONT_METRIC_LAYOUT_LONGHANDS, FONT_METRIC_LAYOUT_UNITS } from '../css/units.ts';
import type { Longhand } from '../css/properties.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

const CSS_WIDE = new Set(['inherit', 'unset', 'revert', 'revert-layer']);

/** Refuses a font-metric length an element takes from its parent through a CSS-wide keyword. */
export function checkFontUnits(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  for (const p of FONT_METRIC_LAYOUT_LONGHANDS) {
    const v = el.props.get(p as Longhand) as ResolvedValue | undefined;
    if (v === undefined || v.value.kind !== 'length' || !FONT_METRIC_LAYOUT_UNITS.has(v.value.unit)) continue;
    if (v.declared === null || v.declared.kind !== 'keyword' || !CSS_WIDE.has(v.declared.value)) continue;
    const id = `font-units|${el.element.address}|${p}`;
    if (reported.has(id)) continue;
    reported.add(id);
    const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
    for (const t of targets) {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `${p}: ${v.declared.value} on <${el.element.tag}> ${el.element.address} takes ${valueToString(v.value)} from its parent, whose ${v.value.unit} Chrome measures against the parent's font; Dragon measures ${v.value.unit} against the element's own font only`,
        manual: `Give ${el.element.address} its own ${p} instead of ${v.declared.value}.`,
        basis: 'computed-value',
      }));
    }
  }
}
