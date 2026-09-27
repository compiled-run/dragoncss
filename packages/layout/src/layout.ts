// Entry point: lays out a validated LayoutInput and returns boxes in preorder, relative to the parent border box, in LU.
import type { LayoutInput } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx } from './units.ts';
import type { Frag } from './box.ts';
import type { EngineFaults } from './block.ts';
import { blockLevelInlineSize, layoutContents, NO_ENGINE_FAULTS } from './block.ts';
import type { TextMeasurer } from './text.ts';
import type { LayoutUnsupported } from './unsupported.ts';
import { UnsupportedSignal } from './unsupported.ts';

/** A box, text leaf or line fragment (<leaf>:line<j>), relative to its parent's border box; parent is null for the root. */
export type LayoutRect = { readonly id: string; readonly parent: string | null; readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

export type LayoutResult =
  | { readonly kind: 'ok'; readonly boxes: readonly LayoutRect[] }
  | { readonly kind: 'unsupported'; readonly unsupported: LayoutUnsupported };

// CSS2 §10.1 and §10.3.3: the root box is block-level in the initial containing block (the viewport); root margins never collapse.
export function layout(input: LayoutInput, measurer: TextMeasurer): LayoutResult {
  return layoutWithFaults(input, measurer, NO_ENGINE_FAULTS);
}

/** layout with seeded engine errors; only the parity harness's planted tests pass anything but NO_ENGINE_FAULTS. */
export function layoutWithFaults(input: LayoutInput, measurer: TextMeasurer, faults: EngineFaults): LayoutResult {
  const root = input.root;
  if (root.style.display === 'none') return { kind: 'ok', boxes: [] };
  const icbWidth = fromCssPx(input.viewport.width);
  const icbHeight = fromCssPx(input.viewport.height);
  try {
    const ctx = { measurer, devicePixelRatio: input.devicePixelRatio, faults };
    const inline = blockLevelInlineSize(ctx, root, icbWidth);
    const r = layoutContents(ctx, root, {
      cbInline: icbWidth,
      borderBoxWidth: inline.borderBoxWidth,
      forcedBorderBoxHeight: null,
      forcedHeightDefinite: false,
      heightBasis: { kind: 'definite', value: icbHeight },
      formattingContextRoot: true,
    });
    const boxes: LayoutRect[] = [];
    flatten(r.frag, null, inline.marginLeft, inline.marginTop, boxes);
    return { kind: 'ok', boxes };
  } catch (e) {
    if (e instanceof UnsupportedSignal) return { kind: 'unsupported', unsupported: e.unsupported };
    throw e;
  }
}

function flatten(frag: Frag, parent: string | null, x: LU, y: LU, out: LayoutRect[]): void {
  out.push({ id: frag.id, parent, x, y, width: frag.width, height: frag.height });
  for (const c of frag.children) flatten(c.frag, frag.id, c.x, c.y, out);
}

/** Absolute border-box edges in LU: parent offsets are summed in integers before any conversion. */
export function absoluteRects(boxes: readonly LayoutRect[]): Map<string, LayoutRect> {
  const abs = new Map<string, LayoutRect>();
  for (const b of boxes) {
    const parent = b.parent === null ? undefined : abs.get(b.parent);
    const px = parent === undefined ? (0 as LU) : parent.x;
    const py = parent === undefined ? (0 as LU) : parent.y;
    abs.set(b.id, { id: b.id, parent: b.parent, x: add(px, b.x), y: add(py, b.y), width: b.width, height: b.height });
  }
  return abs;
}
