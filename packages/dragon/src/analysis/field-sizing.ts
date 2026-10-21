// field-sizing (css/properties/field-sizing.ts): Chrome applies content to form controls alone, which Dragon does not build, so both
// keywords compile on every element it lays out but a replaced one. On img, iframe and svg, content is refused on every target, once
// per element: no case proves it leaves a replaced element's natural sizing alone. The value is checked computed, so one that
// arrives through var() or inherit is checked too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { sizesToContent } from '../css/properties/field-sizing.ts';
import type { FieldSizingFaults } from '../faults/field-sizing.ts';
import type { Diagnostic } from '../types.ts';
import { isReplacedTag } from './elements/replaced.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/** Refuses field-sizing: content on a replaced element. */
export function checkFieldSizing(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: FieldSizingFaults): void {
  if (faults.fieldSizingReplacedAccepted || !sizesToContent(el) || !isReplacedTag(el.element.tag)) return;
  const id = `field-sizing|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get('field-sizing') as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `field-sizing: content on <${el.element.tag}> ${el.element.address} is unsupported: no case proves it leaves a replaced element's natural size alone; only fixed is accepted there`,
      manual: `Remove field-sizing from ${el.element.address}, or set field-sizing: fixed.`,
      basis: 'computed-value',
    }));
  }
}
