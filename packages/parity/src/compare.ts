// Numeric comparison of Dragon's layout with Chrome: 1 device pixel on every absolute edge (owner decision 13).
import type { LayoutRect } from '@dragon/layout';
import { LU_PER_PX } from '@dragon/layout';
import type { Environment } from 'dragon';
import type { CapturedNode, WebCapture } from './capture.ts';

/** Owner decision 13: boxes must match within one physical screen pixel. Fixtures cannot override it. */
export const GATE_DEVICE_PX = 1;

export type Edges = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

export type NodeComparison = {
  readonly id: string;
  readonly kind: 'element' | 'text';
  readonly chrome: Edges;
  readonly dragon: Edges | null;
  readonly delta: Edges | null;
  readonly pass: boolean;
  /** Informational: all four absolute edges equal at 1/64 px. */
  readonly exactLu: boolean;
};

export type Comparison = {
  readonly pass: boolean;
  readonly nodes: readonly NodeComparison[];
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

/** The gate is in device pixels, so a CSS px delta is scaled by the case environment's device pixel ratio. */
export function compareLayout(capture: WebCapture, absolute: ReadonlyMap<string, LayoutRect>, env: Environment): Comparison {
  const problems: string[] = [];
  const nodes: NodeComparison[] = [];
  const seen = new Set<string>();
  if (capture.devicePixelRatio !== env.devicePixelRatio) problems.push(`capture DPR ${capture.devicePixelRatio} is not the case DPR ${env.devicePixelRatio}`);
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
  for (const id of absolute.keys()) if (!seen.has(id)) problems.push(`${id}: Dragon laid out a node Chrome does not have`);
  return { pass: problems.length === 0, nodes, problems };
}
