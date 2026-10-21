// The border module's computed paint values: none of its own; its one check is MISC-PAINT's native context refusal of a border image
// (analysis/border-image.ts reads the image and refuses what no target draws). The native targets rasterise a border image in the
// root scroller's layer and in the box's own untransformed coordinates, as the gradient raster does (gradient.ts R4 and R13), so a
// border image in a subtree whose transform is not the identity, or in a composited layer Dragon does not model (will-change:
// transform or opacity, or a scroll container), is refused on ios and android; web keeps it as written.
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import { borderImageOf, borderImageRefusal } from './border-image.ts';
import { compositesSubtree, transformsSubtree } from './gradient.ts';
import type { PaintCheck, PaintValues } from './types.ts';
import type { Diagnostic } from '../../types.ts';

/** Refuses, on the native targets, every drawn border image in the subtree of root, which is transformed or composited (why). */
function refuseSubtree(el: ResolvedElement, root: ResolvedElement, why: string, native: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  if (borderImageOf(el) !== null && borderImageRefusal(el) === null) {
    const v = el.props.get('border-image-source') as ResolvedValue;
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    for (const t of native) {
      const id = `${t}|border-image-context|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `border-image-source on ${el.element.address}: the border image is inside ${root.element.address}, ${why}, and the native targets raster it in the root layer's untransformed device px (MISC-PAINT)`,
        manual: 'Remove the transform, will-change: transform and opacity, and overflow auto and scroll from the border image box and its ancestors.',
        basis: 'computed-value',
      }));
    }
  }
  for (const c of el.children) if (c.kind === 'element') refuseSubtree(c, root, why, native, diagnostics, reported);
}

const checkBorderImageContext: PaintCheck = (el, targets, diagnostics, reported, propagated) => {
  const native = targets.filter((t) => t !== 'web');
  if (native.length === 0) return;
  if (transformsSubtree(el)) refuseSubtree(el, el, 'whose transform is not the identity', native, diagnostics, reported);
  else if (compositesSubtree(el, propagated)) refuseSubtree(el, el, 'which rasters in a composited layer of its own (will-change, or a scroll container)', native, diagnostics, reported);
};

export const BORDER_VALUES: PaintValues = { name: 'border', compute: () => {}, check: checkBorderImageContext };
