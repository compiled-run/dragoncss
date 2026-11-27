// A box an empty clip rect or clip-path shape hides whole (MASK-CLIP, MASK-CLIP-path-hidden): Chrome 145 paints nothing of it or of
// its subtree, outlines, box-shadows and fixed descendants included, and hits none of it (the visually-hidden pattern).
import type { ResolvedElement } from '../../analysis/resolve.ts';
import type { CssValue } from '../values.ts';
import type { ClipShape, ShapeLength, ShapeRadius } from './clip-path.ts';
import { clipPathShape, clipShapeOf } from './clip-path.ts';
import { clipEdgesOf, clipHidesBox, clipsEverything } from './clip-rect.ts';

/** One inset axis is empty at every size h when h - (start + end) <= 0 for all h: its percentages sum to 100 or more, its lengths to 0 or more. */
function insetAxisEmpty(start: ShapeLength, end: ShapeLength): boolean {
  const percent = (e: ShapeLength): number => (e.unit === '%' ? e.value : 0);
  const length = (e: ShapeLength): number => (e.unit === '%' ? 0 : e.value);
  return percent(start) + percent(end) >= 100 && length(start) >= 0 && length(end) >= 0;
}

const zeroRadius = (r: ShapeRadius): boolean => typeof r !== 'string' && r.value === 0;

/** Whether inset() edges (top, right, bottom, left) leave no region at any reference box size. */
export function insetClipsEverything(edges: readonly ShapeLength[]): boolean {
  const [top, right, bottom, left] = edges;
  if (top === undefined || right === undefined || bottom === undefined || left === undefined) throw new Error(`inset() has ${edges.length} edges, not 4`);
  return insetAxisEmpty(top, bottom) || insetAxisEmpty(left, right);
}

/** Whether a shape's region is empty at every reference box size (css-shapes-1 §3.1), as F8 measures: a polygon or a keyword radius depends on the box. */
export function shapeClipsEverything(shape: ClipShape): boolean {
  if (shape.kind === 'inset') return insetClipsEverything(shape.edges);
  if (shape.kind === 'circle') return zeroRadius(shape.radius);
  if (shape.kind === 'ellipse') return zeroRadius(shape.radii[0]) || zeroRadius(shape.radii[1]);
  return false;
}

/** Whether an element's clip-path shape hides it whole; clip-path applies to every box, unlike clip. */
export function clipPathHidesBox(el: Pick<ResolvedElement, 'props' | 'element'>): boolean {
  const shape = clipPathShape(el);
  return shape !== null && shapeClipsEverything(shape);
}

/** Whether an element's clip rect or clip-path hides it whole. */
export function clipHidesWhole(el: Pick<ResolvedElement, 'props' | 'element'>): boolean {
  return clipHidesBox(el) === true || clipPathHidesBox(el);
}

/** A computed clip-path value whose shape is empty at every size (HIT_MODELLED: the hit facts leave its box out). */
export function emptyClipPathValue(v: CssValue): boolean {
  const shape = clipShapeOf(v);
  return shape !== null && shapeClipsEverything(shape);
}

/** A computed clip value whose rect is empty at every size; it hides only a positioned box, which the hit facts read (clipHidesBox). */
export function emptyClipRectValue(v: CssValue): boolean {
  const edges = clipEdgesOf(v);
  return edges !== null && edges.every((e) => e === null || e.unit === 'px') && clipsEverything(edges) === true;
}
