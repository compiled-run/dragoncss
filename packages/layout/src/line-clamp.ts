// TXT2-g (notes/T149-txt2-spec.md R11): Blink's legacy line clamp through block children (BlockLineClampData,
// block_layout_algorithm.cc). The clamp point of a container falls in the child whose lines reach line N; that child clamps after
// its line with the ellipsis there when content follows it, in the child or after it in the container (a lineless box counts,
// UpdateAfterLayout), and is laid out with lineClamp -N (inline.ts clampsLine). With nothing after the clamp point Blink lays the
// container out again without the clamp, so the child keeps its lines. The engine takes one level: a child is a block container
// of inline content in the container's formatting context. block.ts applies it as it lays the children out; clampedInput gives a
// host the same children after layout, so a device and the break vectors place each child's lines as the layout did.
import type { Ctx } from './block.ts';
import { NO_ENGINE_FAULTS } from './block.ts';
import { contentBox, establishesFormattingContext, resolveBorder, resolvePaddingWith, sumEdges } from './box.ts';
import { NO_GRID_FAULTS } from './grid.ts';
import { placeLines } from './inline.ts';
import type { LayoutBox, LayoutInput } from './input.ts';
import type { LayoutRect } from './layout.ts';
import { isOutOfFlow } from './position.ts';
import type { TextMeasurer } from './text.ts';
import type { LU } from './units.ts';
import { fromCssPx } from './units.ts';
import { unsupported } from './unsupported.ts';

/** clampChild's result: the lines left after the child, and the child as it is laid out. */
export type ClampedChild = { readonly left: number; readonly kid: LayoutBox };

/**
 * One child of the line-clamp container box, with left lines until the clamp point and the children after it: the lines left
 * after it, and the child as it is laid out (lineClamp -left when the clamp point is its line `left` and content follows).
 * contentWidth is the child's content-box inline size and cbInline the container's, which the child's padding resolves against.
 */
export function clampChild(ctx: Ctx, box: LayoutBox, kid: LayoutBox, borderBoxWidth: LU, cbInline: LU, left: number, after: LayoutBox['children']): ClampedChild {
  if (kid.strut === null || establishesFormattingContext(kid.style, ctx.faults)) {
    unsupported('line-clamp', kid.id, 'css-overflow-4 §4.2', `${kid.id} in the line-clamp container ${box.id} is not a block container of inline content in its formatting context`);
  }
  const pad = resolvePaddingWith(kid.style, cbInline, ctx.faults);
  const bor = resolveBorder(kid.style, ctx.devicePixelRatio);
  const lines = placeLines(ctx, kid, contentBox(borderBoxWidth, sumEdges(bor.left, bor.right, pad.left, pad.right))).length;
  if (lines < left) return { left: left - lines, kid };
  const follows = lines > left || after.some((n) => n.kind === 'replaced' || (n.kind === 'box' && !isOutOfFlow(ctx, n)));
  return { left: 0, kid: follows ? { ...kid, style: { ...kid.style, lineClamp: -left } } : kid };
}

/**
 * The laid-out input (as layout gives its boxes, in its units) with each line-clamp container's children as the layout clamped
 * them (clampChild over the boxes' border-box widths), so a host's placeLines over a child gives the lines the layout placed.
 */
export function clampedInput(input: LayoutInput, boxes: readonly LayoutRect[], measurer: TextMeasurer): LayoutInput {
  const ctx: Ctx = { measurer, devicePixelRatio: input.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
  const widths = new Map<string, LU>();
  for (const r of boxes) widths.set(r.id, r.width);
  const widthOf = (id: string): LU => {
    const w = widths.get(id);
    if (w === undefined) throw new Error(`clampedInput: no box ${id}`);
    return w;
  };
  const walk = (b: LayoutBox, cbInline: LU): LayoutBox => {
    const own = widths.get(b.id);
    const pad = resolvePaddingWith(b.style, cbInline, ctx.faults);
    const bor = resolveBorder(b.style, ctx.devicePixelRatio);
    const content = own === undefined ? cbInline : contentBox(own, sumEdges(bor.left, bor.right, pad.left, pad.right));
    let left = b.style.lineClamp > 0 ? b.style.lineClamp : 0;
    let changed = false;
    const children: LayoutBox['children'][number][] = [];
    for (let k = 0; k < b.children.length; k++) {
      const c = b.children[k] as LayoutBox['children'][number];
      if (c.kind !== 'box') {
        children.push(c);
        continue;
      }
      let kid = c;
      if (left > 0 && !isOutOfFlow(ctx, c)) {
        const r: ClampedChild = clampChild(ctx, b, c, widthOf(c.id), content, left, b.children.slice(k + 1));
        left = r.left;
        kid = r.kid;
      }
      const next = walk(kid, content);
      if (next !== c) changed = true;
      children.push(next);
    }
    return changed ? { ...b, children } : b;
  };
  const root = walk(input.root, fromCssPx(input.viewport.width));
  return root === input.root ? input : { ...input, root };
}
