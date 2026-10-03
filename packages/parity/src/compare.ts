// Numeric comparison of Dragon's layout with Chrome: 1 device pixel on every absolute edge (owner decision 13).
// Every Chrome node is compared: elements, text nodes and their per-line fragments. A node only Dragon has passes only if it is
// an anonymous box the compiler generated (Chrome exposes no node for it), and every text line inside it is a compared node.
import type { LayoutBox, LayoutInput, LayoutRect } from '@dragon/layout';
import { LU_PER_PX } from '@dragon/layout';
import type { Environment } from 'dragon';
import type { CapturedNode, WebCapture } from './capture.ts';

/** Owner decision 13: boxes must match within one physical screen pixel. Fixtures cannot override it. */
export const GATE_DEVICE_PX = 1;
export const GATE_CHANNEL_DELTA = 0;
/** T093 ruling A and addendum F1: a line's glyph x centre and glyph bottom edge within this of Chrome's; raising it loosens. */
export const GATE_GLYPH_POSITION_DEVICE_PX = 0.5;

export type Edges = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

export type NodeComparison = {
  readonly id: string;
  readonly kind: CapturedNode['kind'];
  readonly chrome: Edges;
  readonly dragon: Edges | null;
  readonly delta: Edges | null;
  readonly pass: boolean;
  /** Informational: all four absolute edges equal at 1/64 px. */
  readonly exactLu: boolean;
};

/** An anonymous box only Dragon has, and the Chrome-compared line fragments of the text and the atomic inlines inside it. */
export type AnonymousBox = { readonly id: string; readonly lines: readonly string[] };

export type Comparison = {
  readonly pass: boolean;
  readonly nodes: readonly NodeComparison[];
  readonly anonymous: readonly AnonymousBox[];
  readonly problems: readonly string[];
};

function chromeEdges(n: CapturedNode): Edges {
  return { left: n.x, top: n.y, right: n.x + n.width, bottom: n.y + n.height };
}

/** Absolute LU edges are summed in integers and converted to px once. */
function dragonEdges(r: LayoutRect): { px: Edges; raw: Edges } {
  const raw = { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
  return {
    raw,
    px: { left: raw.left / LU_PER_PX, top: raw.top / LU_PER_PX, right: raw.right / LU_PER_PX, bottom: raw.bottom / LU_PER_PX },
  };
}

/** Each anonymous box's text leaf ids and its atomic inline children's ids (INL2a: inline-block and inline-flex boxes). */
function anonymousBoxes(input: LayoutInput): Map<string, { readonly leaves: readonly string[]; readonly atomics: readonly string[] }> {
  const out = new Map<string, { readonly leaves: readonly string[]; readonly atomics: readonly string[] }>();
  const walk = (b: LayoutBox): void => {
    if (b.boxType === 'anonymous') {
      const atomics = b.children.filter((c): c is LayoutBox => c.kind === 'box' && (c.style.display === 'inline-block' || c.style.display === 'inline-flex')).map((c) => c.id);
      out.set(b.id, { leaves: b.children.filter((c) => c.kind === 'text').map((c) => c.id), atomics });
    }
    for (const c of b.children) if (c.kind === 'box') walk(c);
  };
  walk(input.root);
  return out;
}

/** The gate is in device pixels, so a CSS px delta is scaled by the case environment's device pixel ratio. */
export function compareLayout(capture: WebCapture, absolute: ReadonlyMap<string, LayoutRect>, input: LayoutInput, env: Environment): Comparison {
  const problems: string[] = [];
  const nodes: NodeComparison[] = [];
  const seen = new Set<string>();
  if (capture.devicePixelRatio !== env.devicePixelRatio) problems.push(`capture DPR ${capture.devicePixelRatio} is not the case DPR ${env.devicePixelRatio}`);
  if (capture.direction !== env.direction) problems.push(`capture direction ${capture.direction} is not the case direction ${env.direction}`);
  for (const n of capture.nodes) {
    seen.add(n.id);
    const d = absolute.get(n.id);
    if (!n.hasBox) {
      if (d !== undefined) problems.push(`${n.id}: Chrome generates no box but Dragon laid one out`);
      continue;
    }
    if (d === undefined) {
      problems.push(`${n.id}: Chrome has a box but Dragon has none`);
      nodes.push({ id: n.id, kind: n.kind, chrome: chromeEdges(n), dragon: null, delta: null, pass: false, exactLu: false });
      continue;
    }
    const c = chromeEdges(n);
    const { px, raw } = dragonEdges(d);
    const delta = { left: px.left - c.left, top: px.top - c.top, right: px.right - c.right, bottom: px.bottom - c.bottom };
    const pass = [delta.left, delta.top, delta.right, delta.bottom].every((v) => Math.abs(v) * env.devicePixelRatio <= GATE_DEVICE_PX);
    const exactLu = raw.left === c.left * LU_PER_PX && raw.top === c.top * LU_PER_PX && raw.right === c.right * LU_PER_PX && raw.bottom === c.bottom * LU_PER_PX;
    if (!pass) problems.push(`${n.id}: edge delta ${JSON.stringify(delta)} exceeds ${GATE_DEVICE_PX} device px`);
    nodes.push({ id: n.id, kind: n.kind, chrome: c, dragon: px, delta, pass, exactLu });
  }
  const anonymous = anonymousComparison(absolute, input, seen, problems);
  return { pass: problems.length === 0, nodes, anonymous, problems };
}

/** Anonymous boxes only Dragon has: each passes only if every text line inside it is a compared Chrome node. */
function anonymousComparison(absolute: ReadonlyMap<string, LayoutRect>, input: LayoutInput, seen: ReadonlySet<string>, problems: string[]): AnonymousBox[] {
  const anonymousInput = anonymousBoxes(input);
  const anonymous: AnonymousBox[] = [];
  for (const id of absolute.keys()) {
    if (seen.has(id)) continue;
    const held = anonymousInput.get(id);
    if (held === undefined) {
      problems.push(`${id}: Dragon laid out a node Chrome does not have`);
      continue;
    }
    const leaves = held.leaves;
    const lines = [...absolute.values()].filter((r) => r.parent !== null && leaves.includes(r.parent) && r.id.startsWith(`${r.parent}:line`)).map((r) => r.id);
    // An anonymous box passes when it holds a compared text line or atomic inline and nothing it holds is uncompared.
    const uncompared = [...lines, ...held.atomics].filter((l) => !seen.has(l));
    if (lines.length + held.atomics.length === 0 || uncompared.length > 0) problems.push(`${id}: anonymous box whose text lines are not all compared with Chrome (${uncompared.join(', ') || 'no lines'})`);
    anonymous.push({ id, lines: [...lines, ...held.atomics] });
  }
  return anonymous;
}

/** A node of the DPR lane: the Chrome edges in CSS px, the engine edges in zoomed LU (1/64 device px) and in CSS px. */
export type ZoomedNodeComparison = NodeComparison & { readonly dragonLu: Edges | null };

export type ZoomedComparison = {
  readonly pass: boolean;
  readonly nodes: readonly ZoomedNodeComparison[];
  readonly anonymous: readonly AnonymousBox[];
  readonly problems: readonly string[];
};

/**
 * A Chrome CSS px edge equals an engine edge in zoomed LU when the LU nearest to px * 64 * DPR is the engine's, and px * 64 * DPR
 * lies within ZOOMED_LU_READBACK of it. Chrome reports zoomed LU divided by the DPR in float, so the readback carries float error
 * far below 1 LU; a value off by one LU or more is never exact.
 */
export const ZOOMED_LU_READBACK = 1 / 16;

export function exactInZoomedLu(cssPx: number, lu: number, dpr: number): boolean {
  const z = cssPx * LU_PER_PX * dpr;
  return Math.round(z) === lu && Math.abs(z - lu) <= ZOOMED_LU_READBACK;
}

/**
 * The DPR lane (native-strategy.md section 2): engine output in zoomed LU against Chrome captured at the same DPR. The gate is the
 * same GATE_DEVICE_PX on |delta css px| * DPR; exactness is judged in zoomed LU. compareLayout (DPR 1 lanes) is unchanged.
 */
export function compareZoomedLayout(capture: WebCapture, absolute: ReadonlyMap<string, LayoutRect>, input: LayoutInput, env: Environment): ZoomedComparison {
  const problems: string[] = [];
  const nodes: ZoomedNodeComparison[] = [];
  const seen = new Set<string>();
  const dpr = env.devicePixelRatio;
  if (capture.devicePixelRatio !== dpr) problems.push(`capture DPR ${capture.devicePixelRatio} is not the case DPR ${dpr}`);
  if (input.devicePixelRatio !== dpr) problems.push(`layout input DPR ${input.devicePixelRatio} is not the case DPR ${dpr}`);
  if (capture.direction !== env.direction) problems.push(`capture direction ${capture.direction} is not the case direction ${env.direction}`);
  for (const n of capture.nodes) {
    seen.add(n.id);
    const d = absolute.get(n.id);
    if (!n.hasBox) {
      if (d !== undefined) problems.push(`${n.id}: Chrome generates no box but Dragon laid one out`);
      continue;
    }
    if (d === undefined) {
      problems.push(`${n.id}: Chrome has a box but Dragon has none`);
      nodes.push({ id: n.id, kind: n.kind, chrome: chromeEdges(n), dragon: null, delta: null, pass: false, exactLu: false, dragonLu: null });
      continue;
    }
    const c = chromeEdges(n);
    const raw = { left: d.x, top: d.y, right: d.x + d.width, bottom: d.y + d.height };
    const scale = LU_PER_PX * dpr;
    const px = { left: raw.left / scale, top: raw.top / scale, right: raw.right / scale, bottom: raw.bottom / scale };
    const delta = { left: px.left - c.left, top: px.top - c.top, right: px.right - c.right, bottom: px.bottom - c.bottom };
    const pass = [delta.left, delta.top, delta.right, delta.bottom].every((v) => Math.abs(v) * dpr <= GATE_DEVICE_PX);
    const exactLu = exactInZoomedLu(c.left, raw.left, dpr) && exactInZoomedLu(c.top, raw.top, dpr) && exactInZoomedLu(c.right, raw.right, dpr) && exactInZoomedLu(c.bottom, raw.bottom, dpr);
    if (!pass) problems.push(`${n.id}: edge delta ${JSON.stringify(delta)} exceeds ${GATE_DEVICE_PX} device px`);
    nodes.push({ id: n.id, kind: n.kind, chrome: c, dragon: px, delta, pass, exactLu, dragonLu: raw });
  }
  const anonymous = anonymousComparison(absolute, input, seen, problems);
  return { pass: problems.length === 0, nodes, anonymous, problems };
}
