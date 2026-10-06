// CSS2 Appendix E paint order on the fixed tree (T046 §1): stacking contexts, their layers, and native hosting. A stacking context
// is the root, a positioned box or flex item with an integer z-index, a box with opacity below 1, or a transformed box (a transform,
// or will-change: transform or opacity; css-transforms-1 §3, css-will-change-1 §3), which paints in the z-index 0 layer. Its
// layer items are the positioned boxes and stacking contexts it holds, not counting those inside a nested stacking context: z < 0
// in (z, tree) order, then z-index auto or 0 in tree order, then z > 0 in (z, tree) order. Every box of normal flow paints as one
// unit with its flow descendants, the model the native nesting draws. A layer item is re-hosted under the view where its layer
// paints: its stacking context for z < 0 and z > 0, else the nearest positioned z-index auto ancestor inside that context (whose
// positioned descendants follow it in tree order), and it is sorted there after the flow children. A re-hosting that would take a
// box out of an overflow clip in its containing-block chain stays under the clip instead (EMS has no clip-chain hook), which is
// Chrome's order everywhere but where the box overlaps content painted after the clipper; a box that needs it, and whose native order
// then differs from Appendix E's against some node, is refused (analysis/paint-values/stacking.ts), and so is a box a native
// ancestor's clip view would clip although the clip is not in its containing-block chain. Every layer item
// gets a write; flow boxes get none.
import type { LayoutBox, LayoutNode } from '@dragon/layout';
import type { ResolvedElement, ResolvedValue } from '../../analysis/resolve.ts';
import { opacityOf, zIndexOf } from '../../css/properties/effects.ts';
import { elementWillChange, transformsDescendants } from '../../analysis/paint-values/transform.ts';
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
  /** A transform, or will-change: transform or opacity: a stacking context in the z-index 0 layer. */
  readonly transformed: boolean;
  readonly clips: boolean;
  /** Text leaves and boxes, in tree order; a text leaf is a StackNode with no children that is never positioned. */
  readonly children: readonly StackNode[];
  readonly text: boolean;
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
  /** The node whose view hosts this one. */
  readonly host: string | null;
  /** The overflow clips that apply (the clipping ancestors in the containing-block chain), nearest first. */
  readonly clipChain: readonly string[];
  /** Whether the node stays under a clip its layer would take it out of (see the header). */
  readonly underClip: boolean;
};

/** A node's placement among its host's children: bucket -1 (z < 0), 0 (flow), 1 (auto or 0), 2 (z > 0), then rank. */
export type Placement = { readonly host: string; readonly bucket: number; readonly rank: number };

/** A placement with the node's index among the box views its host ends up with. */
export type PlacedWrite = Placement & { readonly index: number };

export type Stacking = {
  readonly facts: ReadonlyMap<string, StackingFacts>;
  /** The placement of every layer item. */
  readonly writes: ReadonlyMap<string, PlacedWrite>;
  /** Appendix E's order of the node ids, and the native order the placements give (equal unless a node stays under a clip). */
  readonly order: readonly string[];
  readonly native: readonly string[];
  /**
   * The nodes the native tree paints wrongly, with the clip at fault: 'order', a layer item kept under a clip of its containing-block
   * chain, which then paints in another order than Appendix E's against some node; 'clip', a node a native ancestor's clip view
   * clips although that clip is not in its containing-block chain (a re-hosting under a stacking context inside the clip).
   */
  readonly clipped: readonly { readonly id: string; readonly clip: string; readonly kind: 'order' | 'clip' }[];
};

type Info = {
  readonly node: StackNode;
  readonly parent: Info | null;
  readonly index: number;
  readonly sc: boolean;
  readonly item: boolean;
};

const isItem = (n: StackNode, root: boolean): boolean => !root && !n.text && (n.position !== 'static' || n.z !== null || n.opacity < 1 || n.transformed);
const createsContext = (n: StackNode, root: boolean): boolean => root || (!n.text && (n.z !== null || n.opacity < 1 || n.transformed || n.position === 'fixed' || n.position === 'sticky'));

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
    const info: Info = { node: n, parent, index: all.length, sc: createsContext(n, r), item: isItem(n, r) };
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

  const order: string[] = [];
  const flow = (b: Info): void => {
    for (const c of kids(b)) {
      if (c.item) continue;
      order.push(c.node.id);
      flow(c);
    }
  };
  const paint = (i: Info): void => {
    order.push(i.node.id);
    if (!i.sc) {
      flow(i);
      return;
    }
    const items = itemsOf(i);
    for (const it of items) if (layerOf(it) === 'negative') paint(it);
    flow(i);
    for (const it of items) if (layerOf(it) !== 'negative') paint(it);
  };
  paint(top);

  // Placements: every layer item under its layer's view, or under the nearest clip its layer would take it out of.
  const placement = new Map<string, Placement>();
  const underClip = new Set<string>();
  const clipped: { id: string; clip: string; kind: 'order' | 'clip' }[] = [];
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
    }
    placement.set(i.node.id, { host: host.node.id, bucket: l === 'negative' ? -1 : l === 'positioned' ? 1 : 2, rank: rankOf.get(i.node.id) as number });
  }

  const nativeOrder = (p: ReadonlyMap<string, Placement>, indices: Map<string, number> = new Map()): string[] => {
    const hosted = new Map<string, Info[]>();
    for (const i of all) {
      if (i.parent === null) continue;
      const h = p.get(i.node.id)?.host ?? i.parent.node.id;
      const list = hosted.get(h) ?? [];
      list.push(i);
      hosted.set(h, list);
    }
    const out: string[] = [];
    const walk = (i: Info): void => {
      out.push(i.node.id);
      const key = (c: Info): [number, number] => {
        const q = p.get(c.node.id);
        return q === undefined ? [0, 0] : [q.bucket, q.rank];
      };
      const list = [...(hosted.get(i.node.id) ?? [])].sort((a, b) => {
        const [ba, ra] = key(a);
        const [bb, rb] = key(b);
        return ba - bb || (ba === 0 ? 0 : ra - rb) || a.index - b.index;
      });
      list.filter((c) => !c.node.text).forEach((c, k) => indices.set(c.node.id, k));
      for (const c of list) walk(c);
    };
    walk(top);
    return out;
  };

  // Every layer item is placed: the device adds views in the engine's box order, which lays out-of-flow boxes after the flow, so
  // tree order is no guide to where an unplaced item would land.
  const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, k) => x === b[k]);
  const indices = new Map<string, number>();
  const native = nativeOrder(placement, indices);
  const writes = new Map([...placement].map(([id, q]) => [id, { ...q, index: indices.get(id) as number }]));
  if (underClip.size === 0 && !same(native, order)) throw new ProgramError(`${root.id}: the placements give the native order ${native.join(' ')}, not Appendix E's ${order.join(' ')}`);
  // An item kept under a clip paints wrongly when it (or its subtree) and some other node paint in the other order natively.
  const inOrder = new Map(order.map((id, k) => [id, k]));
  const inNative = new Map(native.map((id, k) => [id, k]));
  const subtree = (i: Info): string[] => [i.node.id, ...kids(i).flatMap(subtree)];
  for (const i of all) {
    if (!underClip.has(i.node.id)) continue;
    const mine = new Set(subtree(i));
    const at = (m: ReadonlyMap<string, number>, id: string): number => m.get(id) as number;
    const swapped = order.some((y) => !mine.has(y) && [...mine].some((x) => at(inOrder, x) < at(inOrder, y) !== at(inNative, x) < at(inNative, y)));
    if (swapped) clipped.push({ id: i.node.id, clip: (placement.get(i.node.id) as Placement).host, kind: 'order' });
  }

  const chainOf = (i: Info): string[] => {
    const out: string[] = [];
    for (let a = i.parent; a !== null; a = a.parent) if (a.node.clips && inBlockChain(a, i)) out.push(a.node.id);
    return out;
  };
  // The clips the native tree applies to a node are its native ancestors' (each hosts its children in a clip view); they must be its
  // containing-block chain's. A node is reported where the difference starts: its native parent paints right.
  const nativeParent = (i: Info): Info | null => (i.parent === null ? null : (infos.get(placement.get(i.node.id)?.host ?? i.parent.node.id) as Info));
  const wrong = new Map<string, string>();
  for (const i of all) {
    const chain = new Set(chainOf(i));
    const applied: string[] = [];
    for (let a = nativeParent(i); a !== null; a = nativeParent(a)) if (a.node.clips) applied.push(a.node.id);
    const extra = applied.find((c) => !chain.has(c));
    const missing = [...chain].find((c) => !applied.includes(c));
    if (extra !== undefined || missing !== undefined) wrong.set(i.node.id, (extra ?? missing) as string);
  }
  for (const i of all) {
    const clip = wrong.get(i.node.id);
    const np = nativeParent(i);
    if (clip !== undefined && !(np !== null && wrong.has(np.node.id))) clipped.push({ id: i.node.id, clip, kind: 'clip' });
  }

  const facts = new Map<string, StackingFacts>();
  const at = new Map(order.map((id, k) => [id, k]));
  for (const i of all) {
    const clipChain = chainOf(i);
    facts.set(i.node.id, {
      paintOrder: at.get(i.node.id) as number,
      context: contextOf(i)?.node.id ?? null,
      createsContext: i.sc,
      layer: layerOf(i),
      host: i.parent === null ? null : (writes.get(i.node.id)?.host ?? i.parent.node.id),
      clipChain,
      underClip: underClip.has(i.node.id),
    });
  }
  return { facts, writes, order, native, clipped };
}

// ---------------------------------------------------------------- the lowering

/** Whether an element's transform or will-change makes it a stacking context (css-transforms-1 §3, css-will-change-1 §3). */
export const transformedForStacking = (el: ResolvedElement): boolean => transformsDescendants(el) || elementWillChange(el).includes('opacity');

/** The stacking tree of a layout tree, with each element's z-index, opacity and transform from its resolved style. */
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
      transformed: el !== null && transformedForStacking(el),
      clips: b.style.overflowX === 'hidden',
      text: false,
      children: b.kind === 'replaced' ? [] : b.children.map((c) => (c.kind !== 'text' ? node(c, flex) : { id: c.id, position: 'static', z: null, opacity: 1, transformed: false, clips: false, text: true, children: [] })),
    };
  };
  return node(root, false);
}

export type StackingWrite = { readonly kind: 'paint-order'; readonly host: string; readonly bucket: number; readonly rank: number; readonly index: number };

/** The stacking of the case being lowered: computed at its root box, which the lowering visits first, with that tree's nodes. */
let current: { readonly nodes: WeakSet<LayoutNode>; readonly stacking: Stacking } | null = null;

const treeNodes = (root: LayoutBox): WeakSet<LayoutNode> => {
  const out = new WeakSet<LayoutNode>();
  const walk = (b: LayoutNode): void => {
    out.add(b);
    if (b.kind === 'box') for (const c of b.children) if (c.kind !== 'text') walk(c);
  };
  walk(root);
  return out;
};

function caseStacking(box: LayoutNode, el: ResolvedElement | null): Stacking {
  if (el !== null && el.element.tag === 'html') {
    if (box.kind !== 'box') throw new ProgramError(`${box.id}: the root is not a box`);
    const elements = new Map<string, ResolvedElement>();
    const walk = (e: ResolvedElement): void => {
      elements.set(e.element.address, e);
      for (const c of e.children) if (c.kind === 'element') walk(c);
    };
    walk(el);
    current = { nodes: treeNodes(box), stacking: stackingOf(layoutStackTree(box, elements)) };
  }
  // A box of another tree (a stale stacking) is an error, never a lookup by a coincident id.
  if (current === null || !current.nodes.has(box) || !current.stacking.facts.has(box.id)) throw new ProgramError(`${box.id}: the stacking lowering did not see this box's root first`);
  return current.stacking;
}

const STACKING_PAINT = 'Dragon computes CSS2 Appendix E paint order at compile time: a positioned box or stacking context is hosted under the view its layer paints in (its stacking context, or its nearest positioned z-index auto ancestor there) and sorted after the flow children by layer and rank; sibling order is native child order (no zPosition, translationZ or elevation)';

export const STACKING_LOWERING: PaintLowering<StackingWrite> = {
  name: 'stacking',
  vocabulary: {
    uikit: { 'paint-order': { key: 'dragonStacking.order', technique: 'dragon-owned-paint', detail: `DragonBoxView [host id, index among the host view's box views]. ${STACKING_PAINT}` } },
    'android-views': { 'paint-order': { key: 'dragonStacking.order', technique: 'dragon-owned-paint', detail: `DragonBoxView [host id, index among the host view's box views]. ${STACKING_PAINT}` } },
  },
  css: { 'paint-order': ['z-index'] },
  lower: ({ box, el, facts }) => {
    const stacking = caseStacking(box, el);
    facts['stacking'] = stacking.facts.get(box.id) as StackingFacts;
    const w = stacking.writes.get(box.id);
    return w === undefined ? [] : [{ kind: 'paint-order', host: w.host, bucket: w.bucket, rank: w.rank, index: w.index }];
  },
};
