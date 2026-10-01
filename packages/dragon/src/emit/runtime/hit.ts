// The hit table of a program (notes/T047-runtime-spec.md RT-9, SELD-R1b): the precompiled facts of every box (layer, containing
// block, clip, atomic flex item, flex order, the element hit testing names, pointer-events and the activation handler) joined with
// the engine's boxes and line pieces at a device scale, as the translated rt-hit.ts takes them. The compiler core imports the
// engine for types only, so the host passes the engine in, as for the expected dumps.
import type { Edges, InlineRun, LayoutBox, LayoutInput, LayoutRect, LayoutResult, LayoutStyle, TextLeaf, TextMeasurer, Ctx as EngineCtx, EngineFaults } from '@dragon/layout';
import type { NativeProgram } from '../../lower/native-program.ts';

export const HIT_TABLE_VERSION = 'dragon.hit-table/1';
const LU = 64;

/** One node as packages/layout/src/rt-hit.ts takes it (its HitNode, which the parity host type-checks against this shape). */
export type HitNode = {
  readonly kind: 'box' | 'text' | 'line';
  readonly parent: number;
  readonly target: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly clips: boolean;
  readonly borderTop: number;
  readonly borderRight: number;
  readonly borderBottom: number;
  readonly borderLeft: number;
  readonly layer: boolean;
  readonly absolute: boolean;
  readonly atomic: boolean;
  readonly order: number;
  readonly line: number;
  readonly inkLeft: number;
  readonly inkTop: number;
  readonly inkRight: number;
  readonly inkBottom: number;
  readonly pointerEvents: 'auto' | 'none';
};

/** One element's hit facts from the compiler: its computed pointer-events and whether that value was inherited, and its handler. */
export type HitFact = { readonly pointerEvents: 'auto' | 'none'; readonly inherited: boolean; readonly activation: boolean };

/** The engine helpers the table needs, supplied by the host (packages/layout). */
export type HitEngine = {
  readonly layout: (input: LayoutInput, measurer: TextMeasurer) => LayoutResult;
  readonly measurer: TextMeasurer;
  readonly absoluteRects: (boxes: readonly LayoutRect[]) => Map<string, LayoutRect>;
  readonly zoomInput: (input: LayoutInput, faults: EngineFaults) => LayoutInput;
  readonly resolveBorder: (style: LayoutStyle, devicePixelRatio: number) => Edges;
  readonly buildRun: (ctx: EngineCtx, box: LayoutBox, leaves: readonly TextLeaf[]) => InlineRun;
  readonly noFaults: EngineFaults;
};

/** Planted fault pointerEventsNotInherited: an inherited pointer-events value is read as auto. */
export type HitTableFaults = { readonly pointerEventsNotInherited: boolean };
export const NO_HIT_TABLE_FAULTS: HitTableFaults = { pointerEventsNotInherited: false };

/** A program's hit table: the nodes rt-hit takes, the id each names, and the activation flag of each. */
export type HitTable = { readonly nodes: readonly HitNode[]; readonly ids: readonly string[]; readonly activation: readonly boolean[] };

export class HitTableError extends Error {}

/** The hit table of a program at a device DPR, from the engine's own layout of it. */
export function hitTable(p: NativeProgram, facts: ReadonlyMap<string, HitFact>, viewport: { readonly width: number; readonly height: number }, dpr: number, engine: HitEngine, faults: HitTableFaults = NO_HIT_TABLE_FAULTS): HitTable {
  const input: LayoutInput = { viewport: { width: viewport.width, height: viewport.height }, devicePixelRatio: dpr, root: p.root };
  const out = engine.layout(input, engine.measurer);
  if (out.kind !== 'ok') throw new HitTableError(`the engine refused the program (${out.unsupported.code} at ${out.unsupported.nodeId})`);
  const abs = engine.absoluteRects(out.boxes);
  const zoomed = engine.zoomInput(input, engine.noFaults);
  const ctx: EngineCtx = { measurer: engine.measurer, devicePixelRatio: zoomed.devicePixelRatio, faults: engine.noFaults };
  const nodes: HitNode[] = [];
  const ids: string[] = [];
  const activation: boolean[] = [];
  const rect = (id: string): LayoutRect => {
    const r = abs.get(id);
    if (r === undefined) throw new HitTableError(`the engine laid out no ${id}`);
    return r;
  };
  const zoomedBoxes = new Map<string, LayoutBox>();
  const index = (b: LayoutBox): void => {
    zoomedBoxes.set(b.id, b);
    for (const c of b.children) if (c.kind === 'box') index(c);
  };
  index(zoomed.root);
  // The engine lists a flex container's in-flow items line by line, each line in flow order (reversed for a reverse direction),
  // which is the fragment order of Blink's FlexLayoutAlgorithm except that Blink also reverses the lines under wrap-reverse
  // (ApplyReversals). Lines are the runs of items whose cross-axis ranges overlap.
  const fragmentOrders = new Map<string, Map<string, number>>();
  const fragmentOrder = (container: LayoutBox | null, id: string): number => {
    if (container === null) return 0;
    let m = fragmentOrders.get(container.id);
    if (m === undefined) {
      const kids = new Set(container.children.filter((c): c is LayoutBox => c.kind === 'box' && c.style.position !== 'absolute').map((c) => c.id));
      const listed = out.boxes.filter((x) => x.parent === container.id && kids.has(x.id)).map((x) => rect(x.id));
      const row = container.style.flexDirection === 'row' || container.style.flexDirection === 'row-reverse';
      const lines: LayoutRect[][] = [];
      let lo = 0;
      let hi = 0;
      for (const r of listed) {
        const a = row ? r.y : r.x;
        const z = a + (row ? r.height : r.width);
        const cur = lines[lines.length - 1];
        if (cur !== undefined && a < hi && lo < z) {
          cur.push(r);
          lo = Math.min(lo, a);
          hi = Math.max(hi, z);
          continue;
        }
        lines.push([r]);
        lo = a;
        hi = z;
      }
      if (container.style.flexWrap === 'wrap-reverse') lines.reverse();
      m = new Map(lines.flat().map((r, k) => [r.id, k]));
      fragmentOrders.set(container.id, m);
    }
    const k = m.get(id);
    return k === undefined ? 0 : k;
  };
  const visit = (b: LayoutBox, parent: number, parentBox: LayoutBox | null, target: number, inherited: 'auto' | 'none'): void => {
    const i = nodes.length;
    let pe = inherited;
    let own = target;
    let act = false;
    if (b.boxType === 'element') {
      const f = facts.get(b.id);
      if (f === undefined) throw new HitTableError(`no hit facts for element ${b.id}`);
      pe = faults.pointerEventsNotInherited && f.inherited ? 'auto' : f.pointerEvents;
      own = i;
      act = f.activation;
    }
    if (own < 0) throw new HitTableError(`anonymous box ${b.id} has no element ancestor`);
    const r = rect(b.id);
    const zb = zoomedBoxes.get(b.id);
    if (zb === undefined) throw new HitTableError(`no zoomed box ${b.id}`);
    const border = engine.resolveBorder(zb.style, zoomed.devicePixelRatio);
    const flexItem = parentBox !== null && parentBox.style.display === 'flex';
    nodes.push({
      kind: 'box', parent, target: own, x: r.x, y: r.y, width: r.width, height: r.height,
      clips: b.style.overflowX === 'hidden', borderTop: border.top, borderRight: border.right, borderBottom: border.bottom, borderLeft: border.left,
      layer: b.style.position !== 'static', absolute: b.style.position === 'absolute', atomic: flexItem, order: flexItem ? fragmentOrder(parentBox, b.id) : 0, line: -1, inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: pe,
    });
    ids.push(b.id);
    activation.push(act);
    const leaves = b.children.filter((c): c is TextLeaf => c.kind === 'text');
    const boxes = b.children.filter((c): c is LayoutBox => c.kind === 'box');
    if (leaves.length > 0 && boxes.length > 0) throw new HitTableError(`${b.id} mixes text and boxes; the compiler wraps text in anonymous boxes`);
    if (leaves.length > 0) inline(b, i, own, pe, leaves);
    for (const c of boxes) visit(c, i, b, own, pe);
  };
  const inline = (b: LayoutBox, parent: number, target: number, pe: 'auto' | 'none', leaves: readonly TextLeaf[]): void => {
    const zb = zoomedBoxes.get(b.id);
    if (zb === undefined) throw new HitTableError(`no zoomed box ${b.id}`);
    const zLeaves = zb.children.filter((c): c is TextLeaf => c.kind === 'text');
    const run = engine.buildRun(ctx, zb, zLeaves);
    const sizes = [...new Set(zLeaves.map((l) => l.font.size))];
    if (sizes.length !== 1) throw new HitTableError(`${b.id}: text leaves of ${sizes.length} font sizes; one inline formatting context holds one font`);
    const size = sizes[0] as number;
    // Ahem's ink per leaf: the em box when a glyph other than p (descender only) and É (ascender only) shows; p alone inks
    // only below the baseline. A leaf mixing partial glyphs over several lines is refused: its ink differs per line.
    const inkOf = new Map<string, 'em' | 'descent'>();
    for (const l of zLeaves) {
      const shown = [...l.text].filter((c) => c !== ' ' && c !== '\u200b');
      const partial = shown.some((c) => c === 'p' || c === 'É');
      if (shown.some((c) => c === 'É')) throw new HitTableError(`${l.id}: Ahem's É glyph inks only its ascender, which the hit table does not model`);
      inkOf.set(l.id, shown.every((c) => c === 'p') && partial ? 'descent' : 'em');
      if (partial && shown.some((c) => c !== 'p') && [0, 1].every((j) => abs.has(`${l.id}:line${j}`))) throw new HitTableError(`${l.id}: Ahem p glyphs mixed with full glyphs over several lines give each line its own ink, which the hit table does not model`);
    }
    // The line pieces (<leaf>:line<j>), grouped into lines by their top; a line box starts half-leading above its text.
    const pieces: LayoutRect[] = [];
    for (const leaf of leaves) for (let j = 0; abs.has(`${leaf.id}:line${j}`); j++) pieces.push(rect(`${leaf.id}:line${j}`));
    const tops = [...new Set(pieces.map((q) => q.y))].sort((x, y) => x - y);
    tops.forEach((top, k) => {
      const own = pieces.filter((q) => q.y === top);
      const x0 = Math.min(...own.map((q) => q.x));
      const x1 = Math.max(...own.map((q) => q.x + q.width));
      const line = { parent, target, clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, layer: false, absolute: false, atomic: false, order: 0, line: k, pointerEvents: pe } as const;
      nodes.push({ ...line, kind: 'line', x: x0, y: top - run.halfLeading, width: x1 - x0, height: run.lineHeight, inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0 });
      ids.push(`${b.id}:hitline${k}`);
      activation.push(false);
      for (const q of own) {
        // Ahem's ink: the glyph run's bounds rounded out to whole pixels in the run's own space (from the run origin to n em,
        // and from 0.8 em above the baseline to 0.2 em below), placed at the text's origin and ascent; measured.
        const baseline = q.y + run.ascent;
        const em = size;
        const leaf = q.id.slice(0, q.id.lastIndexOf(':line'));
        const above = inkOf.get(leaf) === 'descent' ? 0 : Math.floor(-0.8 * em);
        nodes.push({ ...line, kind: 'text', x: q.x, y: q.y, width: q.width, height: q.height, inkLeft: q.x, inkTop: baseline + above * LU, inkRight: q.x + Math.ceil(Math.round(q.width / (em * LU)) * em) * LU, inkBottom: baseline + Math.ceil(0.2 * em) * LU });
        ids.push(q.id);
        activation.push(false);
      }
    });
  };
  visit(p.root, -1, null, -1, 'auto');
  return { nodes, ids, activation };
}
