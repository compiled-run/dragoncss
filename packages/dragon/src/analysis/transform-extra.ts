// PNT2 (css-transforms-2 §6, §7): the 3D transform longhands other than perspective and perspective-origin are accepted at their
// initial values alone (css/properties/transform-extra.ts), and backface-visibility: hidden on a box whose will-change names
// transform. Any other computed value is refused on every target where it applies, once per element: elsewhere a hidden backface
// gives the box a paint layer (painted like position: relative) and a composited layer of its own (pending_layer.cc
// DecompositeTransforms keeps a transform node whose backface differs from its parent's), which moves it in the paint order and
// changes its raster, measured in Chrome 145 with no transform at all; preserve-3d and another reference box change what a transform
// draws. The values are checked computed, so one that arrives through var() or inherit is refused too.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { isInitialTransformExtra, TRANSFORM_EXTRA_INITIAL, TRANSFORM_EXTRA_LONGHANDS } from '../css/properties/transform-extra.ts';
import type { TransformExtraFaults } from '../faults/transform-extra.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';
import { elementWillChange } from './paint-values/transform.ts';

/**
 * Whether backface-visibility: hidden changes nothing Chrome 145 draws for el: its will-change names transform, so it is already a
 * stacking context with a paint layer (LayoutBox::LayerTypeRequired), a paint offset translation and a composited transform node
 * (paint_property_tree_builder.cc NeedsPaintOffsetTranslation and NeedsTransform), which the hidden flag rides on without another
 * layer (pending_layer.cc DecompositeTransforms keeps that node for its will-change alone). Dragon's transforms are 2D, and a 2D
 * matrix never shows its back face (ui/gfx/geometry/transform.cc IsBackFaceVisible: false for an axis-aligned one, and cofactor33 *
 * determinant is the determinant squared for any other), negative scales included. Measured pixel-identical to will-change:
 * transform alone at DPR 1, 2, 2.625 and 3.
 */
export function hiddenBackfaceIsInert(el: ResolvedElement): boolean {
  return elementWillChange(el).includes('transform');
}

/** Refuses the first of the element's 3D transform longhands that is not initial; planted fault transformExtraAccepted accepts them. */
export function checkTransformExtra(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>, faults: TransformExtraFaults): void {
  if (faults.transformExtraAccepted) return;
  // perspective and perspective-origin are accepted: below a perspective every transform is 2D, so it projects nothing and acts as
  // an identity transform (paint-values/transform.ts hasPerspective), and its origin moves nothing.
  const p = TRANSFORM_EXTRA_LONGHANDS.find((q) => q !== 'perspective' && q !== 'perspective-origin' && !isInitialTransformExtra(q, (el.props.get(q) as ResolvedValue).value) && !(q === 'backface-visibility' && hiddenBackfaceIsInert(el)));
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
      message: `${p}: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is unsupported: Dragon draws no 3D transform rendering yet (PNT2-m); only ${TRANSFORM_EXTRA_INITIAL[p]} is accepted${p === 'backface-visibility' ? ', or hidden on a box whose will-change names transform' : ''}`,
      manual: p === 'backface-visibility' ? `Remove ${p} from ${el.element.address}, or add will-change: transform to it.` : `Remove ${p} from ${el.element.address}, or set ${p}: ${TRANSFORM_EXTRA_INITIAL[p]}.`,
      basis: 'computed-value',
    }));
  }
}
