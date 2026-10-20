// PNT2 (css-transforms-2 §6, §7): the 3D transform longhands other than perspective and perspective-origin are accepted at their
// initial values alone (css/properties/transform-extra.ts).
// Any other computed value is refused on every target where it applies, once per element: backface-visibility: hidden gives the box a
// paint layer of its own and hides it when it faces away, so it can hide text; preserve-3d and another reference box change what a
// transform draws. The values are checked computed, so one that arrives through var() or inherit is refused too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isInitialTransformExtra, TRANSFORM_EXTRA_INITIAL, TRANSFORM_EXTRA_LONGHANDS } from '../css/properties/transform-extra.ts';
import type { TransformExtraFaults } from '../faults/transform-extra.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** Refuses the first of the element's 3D transform longhands that is not initial; planted fault transformExtraAccepted accepts them. */
export function checkTransformExtra(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: TransformExtraFaults): void {
  if (faults.transformExtraAccepted) return;
  // perspective and perspective-origin are accepted: below a perspective every transform is 2D, so it projects nothing and acts as
  // an identity transform (paint-values/transform.ts hasPerspective), and its origin moves nothing.
  const p = TRANSFORM_EXTRA_LONGHANDS.find((q) => q !== 'perspective' && q !== 'perspective-origin' && !isInitialTransformExtra(q, (el.props.get(q) as ResolvedValue).value));
  if (p === undefined) return;
  const id = `transform-extra|${el.element.address}`;
  if (reported.has(id)) return;
  reported.add(id);
  const v = el.props.get(p) as ResolvedValue;
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon draws no 3D transform rendering yet (PNT2-m); only ${TRANSFORM_EXTRA_INITIAL[p]} is accepted`,
      manual: `Remove ${p} from ${el.element.address}, or set ${p}: ${TRANSFORM_EXTRA_INITIAL[p]}.`,
      basis: 'computed-value',
    }));
  }
}
