// Entry point: lays out a validated LayoutInput and returns boxes in preorder, relative to the parent border box, in LU.
import type { LayoutInput } from './input.ts';
import type { LU } from './units.ts';
import { add, fromCssPx } from './units.ts';
import type { Frag } from './box.ts';
import { blockLevelInlineSize, layoutContents } from './block.ts';
import type { TextMeasurer } from './text.ts';
import type { LayoutUnsupported } from './unsupported.ts';
import { UnsupportedSignal } from './unsupported.ts';

export type LayoutRect = { readonly id: string; readonly x: LU; readonly y: LU; readonly width: LU; readonly height: LU };

export type LayoutResult =
  | { readonly kind: 'ok'; readonly boxes: readonly LayoutRect[] }
  | { readonly kind: 'unsupported'; readonly unsupported: LayoutUnsupported };

// CSS2 §10.1 and §10.3.3: the root box is block-level in the initial containing block (the viewport); root margins never collapse.
export function layout(input: LayoutInput, measurer: TextMeasurer): LayoutResult {
  const root = input.root;
  if (root.style.display === 'none') return { kind: 'ok', boxes: [] };
  const icbWidth = fromCssPx(input.viewport.width);
  const icbHeight = fromCssPx(input.viewport.height);
  try {
    const inline = blockLevelInlineSize(root, icbWidth);
    const r = layoutContents({ measurer }, root, {
      cbInline: icbWidth,
      borderBoxWidth: inline.borderBoxWidth,
      forcedBorderBoxHeight: null,
      heightBasis: { kind: 'definite', value: icbHeight },
      formattingContextRoot: true,
    });
    const boxes: LayoutRect[] = [];
    flatten(r.frag, inline.marginLeft, inline.marginTop, boxes);
    return { kind: 'ok', boxes };
  } catch (e) {
    if (e instanceof UnsupportedSignal) return { kind: 'unsupported', unsupported: e.unsupported };
    throw e;
  }
}

function flatten(frag: Frag, x: LU, y: LU, out: LayoutRect[]): void {
  out.push({ id: frag.id, x, y, width: frag.width, height: frag.height });
  for (const c of frag.children) flatten(c.frag, c.x, c.y, out);
}

/** Absolute border-box edges in LU: parent offsets are summed in integers before any conversion. */
export function absoluteRects(input: LayoutInput, boxes: readonly LayoutRect[]): Map<string, LayoutRect> {
  const parentOf = new Map<string, string>();
  const walk = (b: LayoutInput['root']): void => {
    for (const c of b.children) {
      parentOf.set(c.id, b.id);
      if (c.kind === 'box') walk(c);
    }
  };
  walk(input.root);
  const abs = new Map<string, LayoutRect>();
  for (const b of boxes) {
    const parentId = parentOf.get(b.id);
    const parent = parentId === undefined ? undefined : abs.get(parentId);
    const px = parent === undefined ? (0 as LU) : parent.x;
    const py = parent === undefined ? (0 as LU) : parent.y;
    abs.set(b.id, { id: b.id, x: add(px, b.x), y: add(py, b.y), width: b.width, height: b.height });
  }
  return abs;
}
