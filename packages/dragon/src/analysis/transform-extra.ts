// PNT2 (css-transforms-2 §6, §7): the 3D transform longhands are accepted at their initial values, backface-visibility at
// hidden too, and perspective and perspective-origin at any value (css/properties/transform-extra.ts). Any other computed value is
// refused on every target where it applies, once per element: preserve-3d and another reference box change what a transform draws.
// A hidden backface hides the box only once it faces away, which no 2D transform makes it do, so what it changes is the paint order:
// Blink gives the box a paint layer of its own (lower/paint/stacking.ts, a normal-flow layer). An inline box gets no such layer in
// Blink (LayoutInline::LayerTypeRequired ignores backface-visibility), which Dragon's stack tree does not model, so hidden is refused
// there. The values are checked computed, so one that arrives through var() or inherit is checked too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isInitialTransformExtra, TRANSFORM_EXTRA_INITIAL, TRANSFORM_EXTRA_LONGHANDS } from '../css/properties/transform-extra.ts';
import type { TransformExtraFaults } from '../faults/transform-extra.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** Refuses the first of the element's 3D transform longhands Dragon does not draw; planted fault transformExtraAccepted accepts them. */
export function checkTransformExtra(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: TransformExtraFaults): void {
  if (faults.transformExtraAccepted) return;
  const display = (el.props.get('display') as ResolvedValue).value;
  const inline = display.kind === 'keyword' && display.value === 'inline';
  const hidden = (q: string, v: ResolvedValue['value']): boolean => q === 'backface-visibility' && v.kind === 'keyword' && v.value === 'hidden';
  // perspective and perspective-origin are accepted: below a perspective every transform is 2D, so it projects nothing and acts as
  // an identity transform (paint-values/transform.ts hasPerspective), and its origin moves nothing.
  const p = TRANSFORM_EXTRA_LONGHANDS.find((q) => {
    if (q === 'perspective' || q === 'perspective-origin') return false;
    const v = (el.props.get(q) as ResolvedValue).value;
    return !isInitialTransformExtra(q, v) && !(hidden(q, v) && !inline);
  });
  if (p === undefined) return;
  const id = `transform-extra|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get(p) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  const onInline = hidden(p, v.value);
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: onInline
        ? `backface-visibility: hidden on the inline box <${el.element.tag}> ${el.element.address} is unsupported: Chrome gives an inline box no paint layer for it (LayoutInline::LayerTypeRequired), so it changes nothing there, and Dragon does not model that difference from a block-level box yet (PNT2-m)`
        : `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon draws no 3D transform rendering yet (PNT2-m); only ${TRANSFORM_EXTRA_INITIAL[p]} is accepted`,
      manual: onInline ? `Give ${el.element.address} display: inline-block, or remove backface-visibility from it.` : `Remove ${p} from ${el.element.address}, or set ${p}: ${TRANSFORM_EXTRA_INITIAL[p]}.`,
      basis: 'computed-value',
    }));
  }
}
