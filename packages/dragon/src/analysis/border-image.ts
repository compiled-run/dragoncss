// MISC-PAINT (css-backgrounds-3 §4): the border image longhands are accepted at their initial values alone
// (css/properties/border-image.ts). No target draws a border image yet, so any other computed value is refused on every target
// where it applies (none is inherited), once per element. The values are checked computed, so one that arrives through var() or
// inherit is refused too. With every longhand initial, border-image-source is none and Chrome draws the border as border-style says.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { BORDER_IMAGE_LONGHANDS, isInitialBorderImage } from '../css/properties/border-image.ts';
import type { BorderImageFaults } from '../faults/border-image.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** Refuses the first of the element's border image longhands that is not initial; planted fault borderImageAccepted accepts them. */
export function checkBorderImage(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: BorderImageFaults): void {
  if (faults.borderImageAccepted) return;
  const p = BORDER_IMAGE_LONGHANDS.find((q) => !isInitialBorderImage(q, (el.props.get(q) as ResolvedValue).value));
  if (p === undefined) return;
  const id = `border-image|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get(p) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon draws no border image yet (MISC-PAINT); only the initial value is accepted`,
      manual: `Remove the border image from ${el.element.address}, or set border-image: none.`,
      basis: 'computed-value',
    }));
  }
}
