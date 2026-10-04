// CSS2 Appendix E paint order on the fixed tree (T046 §1): stacking contexts, their layers, and native hosting. A stacking context
// is the root, a positioned box or flex item with an integer z-index, or a box with opacity below 1 (transforms join with PNT2). Its
// layer items are the positioned boxes and stacking contexts it holds, not counting those inside a nested stacking context: z < 0
// in (z, tree) order, then z-index auto or 0 in tree order, then z > 0 in (z, tree) order. Inside each paint root (the root, a
// layer item, or a flex item, which paints atomically like an inline block: Blink 145 flex_layout_algorithm.cc SetIsPaintedAtomically
// and BoxFragmentPainter::PaintAllPhasesAtomically) the flow content paints in Appendix E's phases: the backgrounds of the block
// boxes in tree order (step 4), then the foreground in tree order (step 7): text, and each flex item atomically in order-modified
// document order. A layer item is re-hosted under the view where its layer paints: its stacking context for z < 0 and z > 0, else
// the nearest positioned z-index auto ancestor inside that context (whose positioned descendants follow it in tree order), and it is
// sorted there after the flow children and the foreground. A re-hosting that would take a box out of an overflow clip in its
// containing-block chain stays under the clip instead (EMS has no clip-chain hook), which is Chrome's order everywhere but where the
// box overlaps content painted after the clipper; a z-index box that needs it is refused (analysis/paint-values/stacking.ts). The
// foreground is hosted the same way: a text leaf whose box is not a paint root, and every flex item, go under the nearest paint root
// or clip (the foreground's native root), sorted there after the flow children in paint order. Under a clip that is not the paint
// root, the clip's foreground paints in the clip's place rather than after the root's later backgrounds, Chrome's order everywhere
// but where those backgrounds overlap the clip's content (foregroundClip in the facts). Every layer item gets a paint-order write and
// every box with a hosted foreground a paint-foreground write; other flow boxes get none.
import type { LayoutBox, LayoutNode } from '@dragon/layout';
import type { ResolvedElement, ResolvedValue } from '../../analysis/resolve.ts';
import { opacityOf, zIndexOf } from '../../css/properties/effects.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

/** One box of the stacking tree: its positioning, z-index (null for auto or where it has no effect), opacity and clip. */
export type StackNode = {
  readonly id: string;
  /** fixed and sticky come from the resolved tree only (the engine refuses them; POSX-f): both always make a stacking context. */
  readonly position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
  /** The z-index when it applies (a positioned box or a flex item), else null. */
  readonly z: number | null;
  readonly opacity: number;
  readonly clips: boolean;
  /** Text leaves and boxes, in tree order; a text leaf is a StackNode with no children that is never positioned. */
  readonly children: readonly StackNode[];
  readonly text: boolean;
  /** A flex item (a box child of a flex container): it paints atomically, in its order-modified document order (flexOrder, stable). */
  readonly atomic: boolean;
  readonly flexOrder: number;
  /**
   * A text leaf of white space only (CSS white space: space, tab, line feed, carriage return, form feed): it paints no ink, and the
   * engine lays out none of it where the spaces collapse away, so it is never hosted in the foreground.
   */
  readonly blank: boolean;
};

export type StackLayer = 'flow' | 'negative' | 'positioned' | 'positive';

/** The paint facts of a node (rt-hit.ts reads them). */
export type StackingFacts = {
  /** The node's index in the Appendix E paint order of the case. */
  readonly paintOrder: number;
  /** The stacking context the node paints in (for a stacking context, its parent context); null for the root. */
  readonly context: string | null;
  readonly createsContext: boolean;
  readonly layer: StackLayer;
  /** A flex item that is not a layer item: it paints atomically in its paint root's foreground. */
  readonly atomic: boolean;
  /** The node whose view hosts this one. */
  readonly host: string | null;
  /** The overflow clips that apply (the clipping ancestors in the containing-block chain), nearest first. */
  readonly clipChain: readonly string[];
  /** Whether the node stays under a clip its layer would take it out of (see the header). */
  readonly underClip: boolean;
  /** The Appendix E paint-order index of each text leaf child, in child order. */
  readonly textPaintOrder: readonly number[];
  /** Whether this flex item, or a text leaf child, paints natively under a clip that is not its paint root (see the header). */
  readonly foregroundClip: boolean;
};

/** A node's placement among its host's children: bucket -1 (z < 0), 0 (flow), 1 (auto or 0), 2 (z > 0), then rank. */
export type Placement = { readonly host: string; readonly bucket: number; readonly rank: number };

/** A placement with the node's index among the box views its host ends up with. */
export type PlacedWrite = Placement & { readonly index: number };

/**
 * A foreground node's placement (a text leaf or flex item): its native root's view, its rank there (its Appendix E index), and the
 * number of box views before it in that view's container (every box is laid out; a text leaf of collapsed white space is not).
 */
export type ForegroundEntry = { readonly id: string; readonly rank: number; readonly index: number };
/** The foreground placements a box writes: its own (a flex item) or its text leaves', all under one host. */
export type ForegroundWrite = { readonly host: string; readonly entries: readonly ForegroundEntry[] };

export type Stacking = {
  readonly facts: ReadonlyMap<string, StackingFacts>;
  /** The placement of every layer item. */
  readonly writes: ReadonlyMap<string, PlacedWrite>;
  /** The foreground placements, by the box that writes them. */
  readonly foreground: ReadonlyMap<string, ForegroundWrite>;
  /** Appendix E's order of the node ids, and the native order the placements give (equal unless a node stays under a clip). */
  readonly order: readonly string[];
  readonly native: readonly string[];
  /** Layer items with an integer z-index that stay under a clip, with the clip. */
  readonly clipped: readonly { readonly id: string; readonly clip: string }[];
  /**
   * Where each box's outline paints (PNT1 outline): the box itself when it is a paint root (the root, a layer item or a flex item),
   * else its nearest ancestor that is one or that clips it; with the paint root (the nearest, itself included) and the tree index.
   */
  readonly outlines: ReadonlyMap<string, { readonly host: string; readonly layer: string; readonly rank: number }>;
};

type Info = {
  readonly node: StackNode;
  readonly parent: Info | null;
  readonly index: number;
  readonly sc: boolean;
  readonly item: boolean;
  /** A flex item that is not a layer item: a paint root of its own, painted in its parent root's foreground. */
  readonly atomic: boolean;
};

const isItem = (n: StackNode, root: boolean): boolean => !root && !n.text && (n.position !== 'static' || n.z !== null || n.opacity < 1);
const createsContext = (n: StackNode, root: boolean): boolean => root || (!n.text && (n.z !== null || n.opacity < 1 || n.position === 'fixed' || n.position === 'sticky'));

function layerOf(i: Info): StackLayer {
  if (!i.item) return 'flow';
  const z = i.node.z ?? 0;
  return z < 0 ? 'negative' : z > 0 ? 'positive' : 'positioned';
}

/**
 * Whether a is in d's containing-block chain (CSS2 §10.1): a static, relative or sticky box's block is its parent, an absolute one's
 * the nearest positioned ancestor, and a fixed one's the viewport, so no ancestor's clip applies to it.
 */
function inBlockChain(a: Info, d: Info): boolean {
  for (let x: Info | null = d; x !== null && x.parent !== null; ) {
    if (x.node.position === 'fixed') return false;
    let cb: Info | null = x.parent;
    if (x.node.position === 'absolute') while (cb !== null && cb.parent !== null && cb.node.position === 'static') cb = cb.parent;
    if (cb === a) return true;
    x = cb;
  }
  return false;
}

/** Appendix E over a stacking tree: facts per node, and the placements that make the native order equal it. */
export function stackingOf(root: StackNode): Stacking {
  const infos = new Map<string, Info>();
  const all: Info[] = [];
  const build = (n: StackNode, parent: Info | null): Info => {
    if (infos.has(n.id)) throw new ProgramError(`${n.id}: the stacking tree holds the id twice`);
    const r = parent === null;
    const item = isItem(n, r);
    const info: Info = { node: n, parent, index: all.length, sc: createsContext(n, r), item, atomic: !r && !n.text && !item && n.atomic };
    infos.set(n.id, info);
    all.push(info);
    for (const c of n.children) build(c, info);
    return info;
  };
  const top = build(root, null);
  const kids = (i: Info): Info[] => i.node.children.map((c) => infos.get(c.id) as Info);
  const contextOf = (i: Info): Info | null => {
    for (let p = i.parent; p !== null; p = p.parent) if (p.sc) return p;
    return null;
  };

  // The layer items of a context in paint order (z < 0, auto and 0, z > 0), each with its bucket.
  const itemsOf = (s: Info): Info[] => {
    const out: Info[] = [];
    const visit = (i: Info): void => {
      if (i.item) out.push(i);
      if (!i.sc) for (const c of kids(i)) visit(c);
    };
    for (const c of kids(s)) visit(c);
    const key = (i: Info): [number, number] => {
      const l = layerOf(i);
      return [l === 'negative' ? 0 : l === 'positioned' ? 1 : 2, l === 'positioned' ? 0 : (i.node.z as number)];
    };
    return out.sort((a, b) => {
      const [la, za] = key(a);
      const [lb, zb] = key(b);
      return la - lb || za - zb || a.index - b.index;
    });
  };

  // A paint root: the root, a layer item or a flex item. Its flow content paints in phases: block backgrounds, then the foreground.
  const isRoot = (i: Info): boolean => i.parent === null || i.item || i.atomic;
  const order: string[] = [];
  const backgrounds = (b: Info): void => {
    for (const c of kids(b)) {
      if (c.item || c.atomic || c.node.text) continue;
      order.push(c.node.id);
      backgrounds(c);
    }
  };
  // Flex items in order-modified document order: one total key (flexOrder, then tree index) for every child, so a layer item
  // between ordered items cannot break the sort; outside a flex container every flexOrder is 0, which keeps tree order.
  const paintKids = (b: Info): Info[] => kids(b).map((c, k) => ({ c, k })).sort((x, y) => x.c.node.flexOrder - y.c.node.flexOrder || x.k - y.k).map((x) => x.c);
  const foreground = (b: Info): void => {
    for (const c of paintKids(b)) {
      if (c.item) continue;
      if (c.node.text) order.push(c.node.id);
      else if (c.atomic) paint(c);
      else foreground(c);
    }
  };
  const paint = (i: Info): void => {
    order.push(i.node.id);
    if (!i.sc) {
      backgrounds(i);
      foreground(i);
      return;
    }
    const items = itemsOf(i);
    for (const it of items) if (layerOf(it) === 'negative') paint(it);
    backgrounds(i);
    foreground(i);
    for (const it of items) if (layerOf(it) !== 'negative') paint(it);
  };
  paint(top);
  const at = new Map(order.map((id, k) => [id, k]));
  if (at.size !== all.length) throw new ProgramError(`${root.id}: the paint order holds ${at.size} of ${all.length} nodes`);

  // Placements: every layer item under its layer's view, or under the nearest clip its layer would take it out of.
  const placement = new Map<string, Placement>();
  const underClip = new Set<string>();
  const clipped: { id: string; clip: string }[] = [];
  const rankOf = new Map<string, number>();
  for (const s of all) if (s.sc) itemsOf(s).forEach((it, k) => rankOf.set(it.node.id, k));
  for (const i of all) {
    if (!i.item) continue;
    const s = contextOf(i) as Info;
    const l = layerOf(i);
    let host: Info = s;
    if (l === 'positioned') for (let a = i.parent; a !== null && a !== s; a = a.parent) if (a.item && !a.sc) { host = a; break; }
    let crossing: Info | null = null;
    for (let a = i.parent; a !== null && a !== host; a = a.parent) if (a.node.clips && inBlockChain(a, i) && crossing === null) crossing = a;
    if (crossing !== null) {
      host = crossing;
      underClip.add(i.node.id);
      if (i.node.z !== null) clipped.push({ id: i.node.id, clip: crossing.node.id });
    }
    placement.set(i.node.id, { host: host.node.id, bucket: l === 'negative' ? -1 : l === 'positioned' ? 1 : 2, rank: rankOf.get(i.node.id) as number });
  }

  // Foreground placements: every flex item, and every text leaf whose box is not a paint root, under its native root (the nearest
  // paint root or clip), ranked by its Appendix E index. Under a clip that is not the paint root it paints in the clip's place.
  const fgPlace = new Map<string, { host: string; rank: number }>();
  const fgClip = new Set<string>();
  for (const i of all) {
    if (i.parent === null || !(i.node.text || i.atomic) || i.node.blank) continue;
    let h: Info = i.parent;
    while (!isRoot(h) && !h.node.clips) h = h.parent as Info;
    let r: Info = i.parent;
    while (!isRoot(r)) r = r.parent as Info;
    if (h !== r) fgClip.add(i.node.id);
    if (i.node.text && h === i.parent) continue;
    fgPlace.set(i.node.id, { host: h.node.id, rank: at.get(i.node.id) as number });
  }

  // The native order: each host's children sorted by [bucket, phase, rank] (flow 0, foreground 1), flow children in tree order.
  const nativeOrder = (p: ReadonlyMap<string, Placement>, boxIndex: Map<string, number> = new Map(), nodeIndex: Map<string, number> = new Map()): string[] => {
    const hosted = new Map<string, Info[]>();
    for (const i of all) {
      if (i.parent === null) continue;
      const h = p.get(i.node.id)?.host ?? fgPlace.get(i.node.id)?.host ?? i.parent.node.id;
      const list = hosted.get(h) ?? [];
      list.push(i);
      hosted.set(h, list);
    }
    const out: string[] = [];
    const walk = (i: Info): void => {
      out.push(i.node.id);
      const key = (c: Info): [number, number, number] => {
        const q = p.get(c.node.id);
        if (q !== undefined) return [q.bucket, 0, q.rank];
        const f = fgPlace.get(c.node.id);
        return f === undefined ? [0, 0, 0] : [0, 1, f.rank];
      };
      const list = [...(hosted.get(i.node.id) ?? [])].sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.index - b.index;
      });
      list.filter((c) => !c.node.text).forEach((c, k) => boxIndex.set(c.node.id, k));
      let boxesBefore = 0;
      for (const c of list) {
        nodeIndex.set(c.node.id, boxesBefore);
        if (!c.node.text) boxesBefore++;
      }
      for (const c of list) walk(c);
    };
    walk(top);
    return out;
  };

  // Every layer item is placed: the device adds views in the engine's box order, which lays out-of-flow boxes after the flow, so
  // tree order is no guide to where an unplaced item would land.
  const isUnder = (x: Info, a: Info): boolean => {
    for (let p = x.parent; p !== null; p = p.parent) if (p === a) return true;
    return false;
  };
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, k) => x === b[k]);
  const indices = new Map<string, number>();
  const nodeIndex = new Map<string, number>();
  const native = nativeOrder(placement, indices, nodeIndex);
  const writes = new Map([...placement].map(([id, q]) => [id, { ...q, index: indices.get(id) as number }]));
  // Without a layer item kept under a clip, the native order is Appendix E's but for the foreground a clip keeps in its own place
  // (each such text leaf, and each such flex item with its subtree) and for white space only, which paints nothing.
  const kept = new Set<string>();
  for (const i of all) if (i.node.blank) kept.add(i.node.id);
  for (const i of all) if (fgClip.has(i.node.id)) for (const x of all) if (x === i || (!i.node.text && isUnder(x, i))) kept.add(x.node.id);
  const unkept = (ids: readonly string[]): string[] => ids.filter((id) => !kept.has(id));
  if (underClip.size === 0 && !same(unkept(native), unkept(order))) throw new ProgramError(`${root.id}: the placements give the native order ${native.join(' ')}, not Appendix E's ${order.join(' ')}`);
  // A box writes its own foreground placement (a flex item) or its text leaves' (one native root for all of them).
  const foregroundWrites = new Map<string, ForegroundWrite>();
  for (const i of all) {
    const ids = [i, ...kids(i).filter((c) => c.node.text)].map((x) => x.node.id).filter((id) => fgPlace.has(id));
    if (ids.length === 0) continue;
    const hosts = new Set(ids.map((id) => (fgPlace.get(id) as { host: string }).host));
    if (hosts.size !== 1) throw new ProgramError(`${i.node.id}: its foreground placements have ${hosts.size} hosts`);
    foregroundWrites.set(i.node.id, { host: [...hosts][0] as string, entries: ids.map((id) => ({ id, rank: (fgPlace.get(id) as { rank: number }).rank, index: nodeIndex.get(id) as number })) });
  }

  const facts = new Map<string, StackingFacts>();
  for (const i of all) {
    const clipChain: string[] = [];
    for (let a = i.parent; a !== null; a = a.parent) if (a.node.clips && inBlockChain(a, i)) clipChain.push(a.node.id);
    facts.set(i.node.id, {
      paintOrder: at.get(i.node.id) as number,
      context: contextOf(i)?.node.id ?? null,
      createsContext: i.sc,
      layer: layerOf(i),
      atomic: i.atomic,
      host: i.parent === null ? null : (writes.get(i.node.id)?.host ?? fgPlace.get(i.node.id)?.host ?? i.parent.node.id),
      clipChain,
      underClip: underClip.has(i.node.id),
      textPaintOrder: kids(i).filter((c) => c.node.text).map((c) => at.get(c.node.id) as number),
      foregroundClip: [i, ...kids(i).filter((c) => c.node.text)].some((x) => fgClip.has(x.node.id)),
    });
  }
  const outlines = new Map<string, { host: string; layer: string; rank: number }>();
  for (const i of all) {
    if (i.node.text) continue;
    let host: Info = i;
    if (!isRoot(i)) for (let a: Info | null = i.parent; a !== null; a = a.parent) if (isRoot(a) || a.node.clips) { host = a; break; }
    let layer: Info = i;
    if (!isRoot(i)) for (let a: Info | null = i.parent; a !== null; a = a.parent) if (isRoot(a)) { layer = a; break; }
    outlines.set(i.node.id, { host: host.node.id, layer: layer.node.id, rank: i.index });
  }
  return { facts, writes, foreground: foregroundWrites, order, native, clipped, outlines };
}

// ---------------------------------------------------------------- the lowering

/** Whether a text is CSS white space only (css-text-3 §4: space, tab, line feed, carriage return, form feed). */
export const isBlank = (text: string): boolean => /^[ \t\n\r\f]*$/.test(text);

/** The stacking tree of a layout tree, with each element's z-index and opacity from its resolved style. */
export function layoutStackTree(root: LayoutNode, elements: ReadonlyMap<string, ResolvedElement>): StackNode {
  // A replaced leaf (REPL-a) is an element box with no children: it can be positioned, carry z-index and opacity like any box.
  const node = (b: LayoutNode, parentFlex: boolean): StackNode => {
    const anonymous = b.kind === 'box' && b.boxType === 'anonymous';
    const el = anonymous ? null : (elements.get(b.id) ?? null);
    if (!anonymous && el === null) throw new ProgramError(`${b.id}: no resolved element for the layout box`);
    const get = (p: 'z-index' | 'opacity'): ResolvedValue | null => (el === null ? null : (el.props.get(p) ?? null));
    const zv = get('z-index');
    const ov = get('opacity');
    const z = zv === null ? null : zIndexOf(zv.value);
    const opacity = ov === null ? 1 : opacityOf(ov.value);
    if (opacity === null) throw new ProgramError(`${b.id}: opacity did not compute to a number`);
    const flex = b.style.display === 'flex';
    return {
      id: b.id,
      position: b.style.position,
      z: b.style.position !== 'static' || parentFlex ? z : null,
      opacity,
      clips: b.style.overflowX === 'hidden',
      text: false,
      atomic: parentFlex && b.style.position !== 'absolute',
      flexOrder: parentFlex ? b.style.order : 0,
      blank: false,
      children: b.kind === 'replaced' ? [] : b.children.map((c) => (c.kind !== 'text' ? node(c, flex) : { id: c.id, position: 'static', z: null, opacity: 1, clips: false, text: true, atomic: false, flexOrder: 0, blank: isBlank(c.text), children: [] })),
    };
  };
  return node(root, false);
}

export type StackingWrite =
  | { readonly kind: 'paint-order'; readonly host: string; readonly bucket: number; readonly rank: number; readonly index: number }
  | { readonly kind: 'paint-foreground'; readonly host: string; readonly entries: readonly ForegroundEntry[] };

/** The stacking of the case being lowered: computed at its root box, which the lowering visits first. */
let current: { readonly root: LayoutBox; readonly stacking: Stacking } | null = null;

function caseStacking(box: LayoutNode, el: ResolvedElement | null): Stacking {
  if (el !== null && el.element.tag === 'html') {
    if (box.kind !== 'box') throw new ProgramError(`${box.id}: the root is not a box`);
    const elements = new Map<string, ResolvedElement>();
    const walk = (e: ResolvedElement): void => {
      elements.set(e.element.address, e);
      for (const c of e.children) if (c.kind === 'element') walk(c);
    };
    walk(el);
    current = { root: box, stacking: stackingOf(layoutStackTree(box, elements)) };
  }
  if (current === null || !current.stacking.facts.has(box.id)) throw new ProgramError(`${box.id}: the stacking lowering did not see this box's root first`);
  return current.stacking;
}

/** Where a box of the case being lowered paints its outline (Stacking.outlines); the outline module runs after this one. */
export function outlinePlacement(boxId: string): { readonly host: string; readonly layer: string; readonly rank: number } {
  const o = current?.stacking.outlines.get(boxId);
  if (o === undefined) throw new ProgramError(`${boxId}: the stacking lowering has no outline placement for this box`);
  return o;
}

const STACKING_PAINT = 'Dragon computes CSS2 Appendix E paint order at compile time: a positioned box or stacking context is hosted under the view its layer paints in (its stacking context, or its nearest positioned z-index auto ancestor there) and sorted after the flow children and the foreground by layer and rank; sibling order is native child order (no zPosition, translationZ or elevation)';
const FOREGROUND_PAINT = "Dragon paints each paint root's flow content in Appendix E's phases: a text leaf whose box is not a paint root, and every flex item (painted atomically, Blink 145 SetIsPaintedAtomically), is hosted under the nearest paint root or clip and sorted there after the flow children, in paint order, so text paints above the later block backgrounds";

export const STACKING_LOWERING: PaintLowering<StackingWrite> = {
  name: 'stacking',
  vocabulary: {
    uikit: {
      'paint-order': { key: 'dragonStacking.order', technique: 'dragon-owned-paint', detail: `DragonBoxView [host id, index among the host view's box views]. ${STACKING_PAINT}` },
      'paint-foreground': { key: 'dragonStacking.foreground', technique: 'dragon-owned-paint', detail: `DragonBoxView [host id, then the number of box views before each entry in the host's container]. ${FOREGROUND_PAINT}` },
    },
    'android-views': {
      'paint-order': { key: 'dragonStacking.order', technique: 'dragon-owned-paint', detail: `DragonBoxView [host id, index among the host view's box views]. ${STACKING_PAINT}` },
      'paint-foreground': { key: 'dragonStacking.foreground', technique: 'dragon-owned-paint', detail: `DragonBoxView [host id, then the number of box views before each entry in the host's container]. ${FOREGROUND_PAINT}` },
    },
  },
  css: { 'paint-order': ['z-index'], 'paint-foreground': [] },
  lower: ({ box, el, facts }) => {
    const stacking = caseStacking(box, el);
    facts['stacking'] = stacking.facts.get(box.id) as StackingFacts;
    const w = stacking.writes.get(box.id);
    const f = stacking.foreground.get(box.id);
    return [
      ...(w === undefined ? [] : [{ kind: 'paint-order' as const, host: w.host, bucket: w.bucket, rank: w.rank, index: w.index }]),
      ...(f === undefined ? [] : [{ kind: 'paint-foreground' as const, host: f.host, entries: f.entries }]),
    ];
  },
};
