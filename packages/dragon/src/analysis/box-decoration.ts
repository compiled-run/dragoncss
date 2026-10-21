// css-break-4 §5.4: box-decoration-break is accepted at slice alone (css/properties/box-decoration.ts). clone is refused on every
// target, once per element: each fragment of a box split across lines would take its own padding, border, background, radius and
// shadow, which moves text and paints what no target draws yet. The value is checked computed, so a clone that arrives through var()
// or inherit is refused too. clone never hides text, so no accessibility case rests on this refusal.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { BOX_DECORATION_INITIAL, isInitialBoxDecoration } from '../css/properties/box-decoration.ts';
import type { BoxDecorationFaults } from '../faults/box-decoration.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** Refuses a box-decoration-break other than slice; planted fault boxDecorationAccepted accepts it. */
export function checkBoxDecoration(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: BoxDecorationFaults): void {
  if (faults.boxDecorationAccepted) return;
  const v = el.props.get('box-decoration-break') as ResolvedValue;
  if (isInitialBoxDecoration(v.value)) return;
  const id = `box-decoration|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `box-decoration-break: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon does not lay out or draw cloned box fragments yet; only ${BOX_DECORATION_INITIAL} is accepted`,
      manual: `Remove box-decoration-break from ${el.element.address}, or set box-decoration-break: ${BOX_DECORATION_INITIAL}.`,
      basis: 'computed-value',
    }));
  }
}
