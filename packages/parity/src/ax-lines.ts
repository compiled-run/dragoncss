// P6b (notes/T046-paint-spec.md §5.6, T076): the per-line accessibility native gives Dragon-drawn text, and Chrome's, for
// packages/parity/test/a11y-lines.test.ts to compare. Chrome's accessibility tree gives each text node a StaticText whose children
// are InlineTextBoxes, one per line fragment, named with the fragment's text and the collapsible space it hangs at the line's end;
// its layout gives each fragment's rect (DOMSnapshot's text boxes, the same fragments). Native exposes one element per line piece of
// a text view (native-support.ts dragonSetAccessibleLines) from the engine's own line placement, as the model here reads it: the
// piece's code points [start, end) (end past its hanging spaces, which a line ended by a <br> drops as Chrome does) and its
// fragment's rect (<leaf>:line<j>), which the device snaps to whole device px as the dump snaps the line (the documents here are
// at DPR 1 on whole px, where snapping changes nothing). A leaf text-overflow truncates is exposed whole for now: one element named
// with its text, as Chrome's StaticText is, since Chrome's InlineTextBoxes there (the hidden full run, the painted part and the
// ellipsis) are not lines. On a device, checkAccessibleLines holds every dumped line's element, or a whole leaf's one element (the
// text view itself), to the model's name and to the line's frame, or the view's (device-lines).
import type { CDPSession, Page } from 'playwright';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import { NO_ENGINE_FAULTS } from '../../layout/src/block.ts';
import { resolveBorder, resolvePadding } from '../../layout/src/box.ts';
import { NO_GRID_FAULTS } from '../../layout/src/grid.ts';
import { controlAsBox } from '../../layout/src/controls.ts';
import { buildIfc, placeIfcLines } from '../../layout/src/inline.ts';
import type { InlineChild, LayoutBox, LayoutInput } from '../../layout/src/input.ts';
import { absoluteRects, layout, resolvedInput } from '../../layout/src/layout.ts';
import type { TextMeasurer } from '../../layout/src/text.ts';
import { GATE_DEVICE_PX } from './compare.ts';
import type { NativeDump } from './native-dump.ts';
import { sub, ZERO } from '../../layout/src/units.ts';

/**
 * One line's accessibility element: the text node it is a line of, its name, its frame in CSS px from the root, and the level of the
 * heading it is read under (0 for none); or, for a truncated leaf, the leaf's one element (whole) with its text, framed on the text
 * view.
 */
export type AxLine = { readonly leaf: string; readonly name: string; readonly rect: readonly [number, number, number, number]; readonly heading: number; readonly whole?: true };

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
    else if (c.kind === 'control') ownersOf(controlAsBox(c), own, out);
    else if (c.kind !== 'replaced') inline(c, own);
  }
}

/**
 * The lines native exposes for an engine input, in tree order: each text leaf's pieces, line by line. A text view whose element's
 * used visibility is hidden or collapse (hidden, from the program's visibility writes) is hidden, so the platform exposes none of it.
 * A line's heading is its text node's nearest heading in the DOM (headingOf, from the program's heading writes, as DragonTree's
 * headingOf reads them).
 */
export function axLinesOf(input: LayoutInput, measurer: TextMeasurer, hidden: readonly string[], headingOf: (leaf: string) => number): AxLine[] {
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
      else if (c.kind === 'control') walk(controlAsBox(c));
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
        (named[p.leaf] as AxLine[]).push({ leaf: leaf.id, name, rect: [f.x / LU_PX, f.y / LU_PX, f.width / LU_PX, f.height / LU_PX], heading: headingOf(leaf.id) });
      }
    }
    for (const i of truncated) {
      const leaf = ifc.leaves[i];
      const f = leaf === undefined ? undefined : abs.get(leaf.id);
      if (leaf === undefined || f === undefined) throw new Error(`${b.id}: no text view for leaf ${i}`);
      (named[i] as AxLine[]).push({ leaf: leaf.id, name: leaf.text, rect: [f.x / LU_PX, f.y / LU_PX, f.width / LU_PX, f.height / LU_PX], heading: headingOf(leaf.id), whole: true });
    }
    ifc.leaves.forEach((leaf, i) => {
      if (!hidden.includes(owners.get(leaf.id) ?? '')) lines.push(...(named[i] as AxLine[]));
    });
  };
  walk(zoomed.root);
  return lines;
}

/**
 * The lines native exposes for a compiled program at a viewport and DPR (axLinesOf over programInput): a text view is hidden when
 * its element has a visibility write, and a line's heading is the level of its text node's nearest ancestor with a heading write
 * (the role module, lower/paint/role.ts), as DragonTree's headingOf reads the views. The lines are laid out with the reference
 * measurer (native-host.ts referenceMeasurer, which the caller passes, so this module needs no host), made once per program, viewport
 * and DPR: the device checks and the host tests' made-up dumps ask for the same program's lines many times.
 */
export function axLinesOfProgram(program: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number, referenceMeasurer: () => TextMeasurer): readonly AxLine[] {
  const byView = programLines.get(program) ?? new Map<string, readonly AxLine[]>();
  programLines.set(program, byView);
  const key = `${viewport.width}x${viewport.height}@${dpr}`;
  const known = byView.get(key);
  if (known !== undefined) return known;
  const hidden = program.nodes.filter((n) => n.writes.some((w) => w.kind === 'visibility')).map((n) => n.id);
  const nodes = new Map(program.nodes.map((n) => [n.id, n]));
  const headingOf = (leaf: string): number => {
    for (let at = nodes.get(leaf)?.parent ?? null; at !== null; at = nodes.get(at)?.parent ?? null) {
      const w = nodes.get(at)?.writes.find((x) => x.kind === 'heading');
      if (w !== undefined && w.kind === 'heading') return w.level;
    }
    return 0;
  };
  const lines = axLinesOf(programInput(program, viewport, dpr), referenceMeasurer(), hidden, headingOf);
  byView.set(key, lines);
  return lines;
}

const programLines = new WeakMap<NativeProgram, Map<string, readonly AxLine[]>>();

// In the page, on a text node: its leaf's name.
const LEAF_NAME = 'function () { const p = this.parentNode; return p.getAttribute("data-dragon-id") + ":text" + [...p.childNodes].filter((c) => c.nodeType === 3).indexOf(this); }';

type AxNode = { readonly nodeId: string; readonly role?: { readonly value: string }; readonly name?: { readonly value: string }; readonly childIds?: readonly string[]; readonly backendDOMNodeId?: number; readonly ignored: boolean; readonly properties?: readonly { readonly name: string; readonly value: { readonly value: unknown } }[] };

/**
 * Chrome's lines for the page, in tree order: each StaticText's InlineTextBoxes (Accessibility.getFullAXTree, walked from the root)
 * with the text node's fragment rects (DOMSnapshot.captureSnapshot's text boxes), which must be as many. A text node is named as the
 * compiler names its leaf, <element>:text<k> for the parent's k-th text child. A line's heading is the level of its nearest heading
 * ancestor in the tree (role heading, its level property). A leaf in whole is read as its StaticText alone, named and with no frame
 * (the model's whole lines, which a comparison reads by name).
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
    const visit = async (n: AxNode, heading: number): Promise<void> => {
      if (n.role?.value === 'StaticText' && !n.ignored) {
        if (n.backendDOMNodeId === undefined) throw new Error(`StaticText ${n.nodeId} has no DOM node`);
        const node = (await cdp.send('DOM.resolveNode', { backendNodeId: n.backendDOMNodeId })) as unknown as { readonly object: { readonly objectId: string } };
        const named = (await cdp.send('Runtime.callFunctionOn', { objectId: node.object.objectId, functionDeclaration: LEAF_NAME, returnByValue: true })) as unknown as { readonly result: { readonly value: string } };
        const leaf = named.result.value;
        if (whole.has(leaf)) {
          lines.push({ leaf, name: n.name?.value ?? '', rect: [0, 0, 0, 0], heading, whole: true });
          return;
        }
        const rects = boxes.get(n.backendDOMNodeId) ?? [];
        const kids = (n.childIds ?? []).map((c) => byId.get(c)).filter((c): c is AxNode => c !== undefined && c.role?.value === 'InlineTextBox');
        if (kids.length !== rects.length) throw new Error(`${leaf}: ${kids.length} InlineTextBoxes but ${rects.length} text boxes`);
        kids.forEach((k, i) => {
          const b = rects[i] as readonly number[];
          lines.push({ leaf, name: k.name?.value ?? '', rect: [b[0] as number, b[1] as number, b[2] as number, b[3] as number], heading });
        });
        return;
      }
      let under = heading;
      if (n.role?.value === 'heading') {
        const level = n.properties?.find((p) => p.name === 'level')?.value.value;
        if (typeof level !== 'number') throw new Error(`heading ${n.nodeId} has no level`);
        under = level;
      }
      for (const c of n.childIds ?? []) {
        const k = byId.get(c);
        if (k !== undefined) await visit(k, under);
      }
    };
    await visit(root, 0);
    return lines;
  } finally {
    await cdp.detach();
  }
}

type NativeDumpNode = NativeDump['nodes'][number];

/** One accessibility problem a device dump shows: the text node and what is wrong. */
export type AxProblem = { readonly id: string; readonly detail: string };

/**
 * The device-lines accessibility check (P6b) against the model's lines (axLinesOfProgram), by text node. A text node the model
 * exposes line by line has an element per dumped line, in order, named as the model names that line (its code points with the
 * collapsible space it hangs at the line's end, none before a <br>; a11y-lines.test.ts proves the rule against Chrome), marked a
 * heading exactly when the model's line is under one, and framed on the dumped line within GATE_DEVICE_PX on every edge, and the
 * view is not an element itself. A leaf the model exposes whole (one text-overflow truncates) has no line elements, and the view is
 * one element named with the leaf's text, marked a heading as the model's, and framed on the view. A text node the model exposes
 * nothing of (hidden, or a list marker's text) has no element at all. The order a screen reader reads the text views in
 * (accessibleOrder, less every other view) is the model's order of its text nodes, which is DOM order.
 */
export function checkAccessibleLines(dump: NativeDump, expected: readonly AxLine[]): { readonly compared: number; readonly problems: readonly AxProblem[] } {
  const problems: AxProblem[] = [];
  let compared = 0;
  const dpr = dump.case.dpr;
  const byLeaf = new Map<string, AxLine[]>();
  for (const l of expected) byLeaf.set(l.leaf, [...(byLeaf.get(l.leaf) ?? []), l]);
  type Frame = NativeDumpNode['frame'];
  const framed = (id: string, at: string, a: Frame, f: Frame): void => {
    const delta = [a.x - f.x, a.y - f.y, a.x + a.width - (f.x + f.width), a.y + a.height - (f.y + f.height)];
    if (delta.some((d) => Math.abs(d) * dpr > GATE_DEVICE_PX)) problems.push({ id, detail: `${at}: accessibility frame edge delta ${JSON.stringify(delta)} css px exceeds ${GATE_DEVICE_PX} device px` });
  };
  const marked = (id: string, at: string, a: { readonly heading: number }, l: AxLine): void => {
    if (a.heading !== (l.heading > 0 ? 1 : 0)) problems.push({ id, detail: `${at}: ${a.heading === 1 ? 'read as a heading, but the model has it under none' : `not read as a heading, but the model has it under an h${l.heading}`}` });
  };
  for (const n of dump.nodes) {
    if (n.kind !== 'text') continue;
    const want = byLeaf.get(n.id) ?? [];
    const whole = want.find((l) => l.whole === true);
    const exposed = n.lines.flatMap((l, j) => (l.accessible === null ? [] : [j]));
    if (whole !== undefined) {
      compared++;
      for (const j of exposed) problems.push({ id: n.id, detail: `${n.id}:line${j}: the leaf is exposed whole, but an element exposes the line` });
      const a = n.accessible;
      if (a === null) problems.push({ id: n.id, detail: `${n.id}: the leaf is exposed whole, but the view is not an accessibility element` });
      else {
        if (a.name !== whole.name) problems.push({ id: n.id, detail: `${n.id}: named ${JSON.stringify(a.name)}, expected ${JSON.stringify(whole.name)}` });
        marked(n.id, n.id, a, whole);
        framed(n.id, n.id, a.frame, n.frame);
      }
      continue;
    }
    if (n.accessible !== null) problems.push({ id: n.id, detail: `${n.id}: the view is an accessibility element itself, named ${JSON.stringify(n.accessible.name)}` });
    if (want.length === 0) {
      compared += n.lines.length;
      for (const j of exposed) problems.push({ id: n.id, detail: `${n.id}:line${j}: the model exposes none of this text (hidden, or a marker's), but an element exposes the line` });
      continue;
    }
    if (want.length !== n.lines.length) {
      problems.push({ id: n.id, detail: `${n.id}: ${n.lines.length} dumped lines, but the model exposes ${want.length}` });
      continue;
    }
    n.lines.forEach((l, j) => {
      compared++;
      const at = `${n.id}:line${j}`;
      const a = l.accessible;
      if (a === null) return void problems.push({ id: n.id, detail: `${at}: no accessibility element exposes the line` });
      const m = want[j] as AxLine;
      if (a.name !== m.name) problems.push({ id: n.id, detail: `${at}: named ${JSON.stringify(a.name)}, expected ${JSON.stringify(m.name)}` });
      marked(n.id, at, a, m);
      framed(n.id, at, a.frame, l.frame);
    });
  }
  // The reading order: a device writes it (the schema allows null only in a ts-reference dump).
  if (dump.accessibleOrder !== null) {
    const texts = new Set(dump.nodes.filter((n) => n.kind === 'text').map((n) => n.id));
    const read = dump.accessibleOrder.filter((id) => texts.has(id));
    const model = modelOrder(expected);
    if (read.join('\n') !== model.join('\n')) problems.push({ id: dump.case.id, detail: `reading order: the screen reader reads ${JSON.stringify(read)}, the model (DOM order) ${JSON.stringify(model)}` });
  }
  return { compared, problems };
}

/** The text nodes the model exposes, in the order a screen reader reads them (the model's, DOM order). */
function modelOrder(expected: readonly AxLine[]): string[] {
  return [...new Set(expected.map((l) => l.leaf))];
}

/**
 * A dump's nodes with the accessibility fields a correct device writes for the model's lines (checkAccessibleLines): each exposed
 * line's element named and marked as the model's and framed on the line, a whole leaf's view named with its text and framed on the
 * view, and nothing else; and the reading order, the model's text nodes. For the host tests' made-up device dumps.
 */
export function exposedAsModelled(dump: NativeDump, expected: readonly AxLine[]): NativeDump {
  const byLeaf = new Map<string, AxLine[]>();
  for (const l of expected) byLeaf.set(l.leaf, [...(byLeaf.get(l.leaf) ?? []), l]);
  const mark = (l: AxLine): number => (l.heading > 0 ? 1 : 0);
  return {
    ...dump,
    nodes: dump.nodes.map((n) => {
      const want = n.kind === 'text' ? (byLeaf.get(n.id) ?? []) : [];
      const whole = want.find((l) => l.whole === true);
      const lined = whole === undefined && want.length === n.lines.length;
      return {
        ...n,
        lines: n.lines.map((l, j) => ({ ...l, accessible: lined ? { name: (want[j] as AxLine).name, heading: mark(want[j] as AxLine), frame: l.frame } : null })),
        accessible: whole === undefined ? null : { name: whole.name, heading: mark(whole), frame: n.frame },
      };
    }),
    accessibleOrder: modelOrder(expected),
  };
}
