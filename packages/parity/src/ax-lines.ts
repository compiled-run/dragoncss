// P6b (notes/T046-paint-spec.md §5.6, T076): the per-line accessibility native gives Dragon-drawn text, and Chrome's, for
// packages/parity/test/a11y-lines.test.ts to compare. Chrome's accessibility tree gives each text node a StaticText whose children
// are InlineTextBoxes, one per line fragment, named with the fragment's text and the collapsible space it hangs at the line's end;
// its layout gives each fragment's rect (DOMSnapshot's text boxes, the same fragments). Native exposes one element per line piece of
// a text view (native-support.ts dragonSetAccessibleLines) from the engine's own line placement, as the model here reads it: the
// piece's code points [start, end) (end past its hanging spaces, which a line ended by a <br> drops as Chrome does) and its
// fragment's rect (<leaf>:line<j>). A leaf text-overflow truncates is exposed whole for now: one element named with its text, as
// Chrome's StaticText is, since Chrome's InlineTextBoxes there (the hidden full run, the painted part and the ellipsis) are not lines.
import type { CDPSession, Page } from 'playwright';
import { NO_ENGINE_FAULTS } from '../../layout/src/block.ts';
import { resolveBorder, resolvePadding } from '../../layout/src/box.ts';
import { NO_GRID_FAULTS } from '../../layout/src/grid.ts';
import { buildIfc, placeIfcLines } from '../../layout/src/inline.ts';
import type { InlineChild, LayoutBox, LayoutInput } from '../../layout/src/input.ts';
import { absoluteRects, layout, resolvedInput } from '../../layout/src/layout.ts';
import type { TextMeasurer } from '../../layout/src/text.ts';
import { sub, ZERO } from '../../layout/src/units.ts';

/**
 * One line's accessibility element: the text node it is a line of, its name, and its frame in CSS px from the root; or, for a
 * truncated leaf, the leaf's one element (whole) with its text, framed on the text view.
 */
export type AxLine = { readonly leaf: string; readonly name: string; readonly rect: readonly [number, number, number, number]; readonly whole?: true };

const LU_PX = 64;

function hasInlineContent(b: LayoutBox): boolean {
  for (const c of b.children) if (c.kind === 'text' || c.kind === 'inline' || c.kind === 'br') return true;
  return false;
}

/** Each text leaf's element: the nearest element box or inline box over it, through anonymous boxes. */
function ownersOf(b: LayoutBox, owner: string, out: Map<string, string>): void {
  const own = b.boxType === 'element' ? b.id : owner;
  const inline = (c: InlineChild, o: string): void => {
    if (c.kind === 'text') out.set(c.id, o);
    else if (c.kind === 'inline') for (const k of c.children) inline(k, c.id);
  };
  for (const c of b.children) {
    if (c.kind === 'box') ownersOf(c, own, out);
    else if (c.kind !== 'replaced') inline(c, own);
  }
}

/**
 * The lines native exposes for an engine input, in tree order: each text leaf's pieces, line by line. A text view whose element's
 * used visibility is hidden or collapse (hidden, from the program's visibility writes) is hidden, so the platform exposes none of it.
 */
export function axLinesOf(input: LayoutInput, measurer: TextMeasurer, hidden: readonly string[]): AxLine[] {
  const out = layout(input, measurer);
  if (out.kind !== 'ok') throw new Error(`the engine refused the input (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  const abs = absoluteRects(out.boxes);
  const zoomed = resolvedInput(input, measurer, NO_ENGINE_FAULTS);
  const ctx = { measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: NO_ENGINE_FAULTS, gridFaults: NO_GRID_FAULTS };
  const owners = new Map<string, string>();
  ownersOf(zoomed.root, zoomed.root.id, owners);
  const lines: AxLine[] = [];
  const walk = (b: LayoutBox): void => {
    if (!hasInlineContent(b)) {
      for (const c of b.children) if (c.kind === 'box') walk(c);
      return;
    }
    const r = abs.get(b.id);
    if (r === undefined) throw new Error(`no rect for ${b.id}`);
    const border = resolveBorder(b.style, zoomed.devicePixelRatio);
    const padding = resolvePadding(b.style, ZERO);
    const width = sub(sub(sub(sub(r.width, border.left), border.right), padding.left), padding.right);
    const ifc = buildIfc(ctx, b);
    const seen = ifc.leaves.map(() => 0);
    const named: AxLine[][] = ifc.leaves.map(() => []);
    const placed = placeIfcLines(ctx, b, ifc, width);
    const truncated = new Set<number>();
    for (const line of placed) {
      for (const p of line.pieces) if (p.truncated) truncated.add(p.leaf);
      if (line.ellipsis !== null) truncated.add(line.ellipsis.leaf);
    }
    for (const line of placed) {
      const last = line.pieces[line.pieces.length - 1];
      for (const p of line.pieces) {
        if (truncated.has(p.leaf)) continue;
        const leaf = ifc.leaves[p.leaf];
        if (leaf === undefined) throw new Error(`${b.id}: no leaf ${p.leaf}`);
        const j = seen[p.leaf] as number;
        seen[p.leaf] = j + 1;
        const f = abs.get(`${leaf.id}:line${j}`);
        if (f === undefined) throw new Error(`no fragment ${leaf.id}:line${j}`);
        // A <br> ends the line: the collapsible spaces before it are removed, not hung (css-text-3 §4.1.3), so the name ends there.
        const end = line.breaks.length > 0 && p === last ? p.visibleEnd : p.end;
        const name = [...leaf.text].slice(p.start, end).join('');
        (named[p.leaf] as AxLine[]).push({ leaf: leaf.id, name, rect: [f.x / LU_PX, f.y / LU_PX, f.width / LU_PX, f.height / LU_PX] });
      }
    }
    for (const i of truncated) {
      const leaf = ifc.leaves[i];
      const f = leaf === undefined ? undefined : abs.get(leaf.id);
      if (leaf === undefined || f === undefined) throw new Error(`${b.id}: no text view for leaf ${i}`);
      (named[i] as AxLine[]).push({ leaf: leaf.id, name: leaf.text, rect: [f.x / LU_PX, f.y / LU_PX, f.width / LU_PX, f.height / LU_PX], whole: true });
    }
    ifc.leaves.forEach((leaf, i) => {
      if (!hidden.includes(owners.get(leaf.id) ?? '')) lines.push(...(named[i] as AxLine[]));
    });
  };
  walk(zoomed.root);
  return lines;
}

// In the page, on a text node: its leaf's name.
const LEAF_NAME = 'function () { const p = this.parentNode; return p.getAttribute("data-dragon-id") + ":text" + [...p.childNodes].filter((c) => c.nodeType === 3).indexOf(this); }';

type AxNode = { readonly nodeId: string; readonly role?: { readonly value: string }; readonly name?: { readonly value: string }; readonly childIds?: readonly string[]; readonly backendDOMNodeId?: number; readonly ignored: boolean };

/**
 * Chrome's lines for the page, in tree order: each StaticText's InlineTextBoxes (Accessibility.getFullAXTree, walked from the root)
 * with the text node's fragment rects (DOMSnapshot.captureSnapshot's text boxes), which must be as many. A text node is named as the
 * compiler names its leaf, <element>:text<k> for the parent's k-th text child. A leaf in whole is read as its StaticText alone, named
 * and with no frame (the model's whole lines, which a comparison reads by name).
 */
export async function chromeAxLines(page: Page, whole: ReadonlySet<string> = new Set()): Promise<AxLine[]> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    await cdp.send('Accessibility.enable');
    const tree = (await cdp.send('Accessibility.getFullAXTree')) as unknown as { readonly nodes: readonly AxNode[] };
    const byId = new Map(tree.nodes.map((n) => [n.nodeId, n]));
    const snap = (await cdp.send('DOMSnapshot.captureSnapshot', { computedStyles: [] })) as unknown as {
      readonly documents: readonly { readonly nodes: { readonly backendNodeId: readonly number[] }; readonly layout: { readonly nodeIndex: readonly number[] }; readonly textBoxes: { readonly layoutIndex: readonly number[]; readonly bounds: readonly (readonly number[])[] } }[];
    };
    const doc = snap.documents[0];
    if (doc === undefined) throw new Error('no snapshot document');
    const boxes = new Map<number, (readonly number[])[]>();
    doc.textBoxes.layoutIndex.forEach((li, k) => {
      const backend = doc.nodes.backendNodeId[doc.layout.nodeIndex[li] as number] as number;
      boxes.set(backend, [...(boxes.get(backend) ?? []), doc.textBoxes.bounds[k] as readonly number[]]);
    });
    const lines: AxLine[] = [];
    const root = tree.nodes[0];
    if (root === undefined) throw new Error('an empty accessibility tree');
    const visit = async (n: AxNode): Promise<void> => {
      if (n.role?.value === 'StaticText' && !n.ignored) {
        if (n.backendDOMNodeId === undefined) throw new Error(`StaticText ${n.nodeId} has no DOM node`);
        const node = (await cdp.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId })) as unknown as { readonly object: { readonly objectId: string } };
        const named = (await cdp.send('Runtime.callFunctionOn', { objectId: node.object.objectId, functionDeclaration: LEAF_NAME, returnByValue: true })) as unknown as { readonly result: { readonly value: string } };
        const leaf = named.result.value;
        if (whole.has(leaf)) {
          lines.push({ leaf, name: n.name?.value ?? '', rect: [0, 0, 0, 0], whole: true });
          return;
        }
        const rects = boxes.get(n.backendDOMNodeId) ?? [];
        const kids = (n.childIds ?? []).map((c) => byId.get(c)).filter((c): c is AxNode => c !== undefined && c.role?.value === 'InlineTextBox');
        if (kids.length !== rects.length) throw new Error(`${leaf}: ${kids.length} InlineTextBoxes but ${rects.length} text boxes`);
        kids.forEach((k, i) => {
          const b = rects[i] as readonly number[];
          lines.push({ leaf, name: k.name?.value ?? '', rect: [b[0] as number, b[1] as number, b[2] as number, b[3] as number] });
        });
        return;
      }
      for (const c of n.childIds ?? []) {
        const k = byId.get(c);
        if (k !== undefined) await visit(k);
      }
    };
    await visit(root);
    return lines;
  } finally {
    await cdp.detach();
  }
}
