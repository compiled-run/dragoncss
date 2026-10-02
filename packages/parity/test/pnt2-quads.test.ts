// PNT2 (notes/T046-paint-spec.md §2 and §5.3): Chrome's transformed geometry against Dragon's. For every case of the transforms
// group at DPR 1, 2, 3 and 2.625, the engine's untransformed border box times the paint-transform.ts matrices of the box and its
// transformed ancestors equals Chrome's DOM.getContentQuads quad within GATE_DEVICE_PX at every corner, and the functions matrix
// serialises to Chrome's computed transform string. The untransformed boxes themselves are the transform twin's captures, which the
// parity and DPR lanes compare with the engine under the existing gates. Two planted models (the origin ignored, percentages of
// the parent box) must each fail somewhere.
import { describe, expect, it } from 'vitest';
import type { LayoutRect, Matrix2D, TransformOp, TransformOrigin } from '@dragon/layout';
import { absoluteRects, layout, mapPoint, paintTransformMatrix, serializeTransform } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { programInput } from 'dragon';
import { GATE_DEVICE_PX } from '../src/compare.ts';
import { DPRS } from '../src/dpr.ts';
import { nativeCases, referenceMeasurer } from '../src/native-host.ts';
import { committedQuads, QUAD_DPRS, transformCases } from '../src/transform-capture.ts';

const TRIG = { sin: Math.sin, cos: Math.cos };
type Facts = { readonly ops: readonly TransformOp[]; readonly origin: TransformOrigin };
type Model = 'dragon' | 'origin-ignored' | 'percent-of-parent';

function times(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  return { full: true, a: m1.a * m2.a + m1.c * m2.b, b: m1.b * m2.a + m1.d * m2.b, c: m1.a * m2.c + m1.c * m2.d, d: m1.b * m2.c + m1.d * m2.d, e: m1.a * m2.e + m1.c * m2.f + m1.e, f: m1.b * m2.e + m1.d * m2.f + m1.f };
}
const shift = (x: number, y: number): Matrix2D => ({ full: true, a: 1, b: 0, c: 0, d: 1, e: x, f: y });

/** The engine's absolute boxes of a program at a DPR, in CSS px. */
function cssBoxes(p: NativeProgram, dpr: number): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = layout(programInput(p, { width: 400, height: 300 }, dpr), referenceMeasurer());
  if (out.kind !== 'ok') throw new Error(`the engine refused the program at ${dpr}`);
  const scale = 64 * dpr;
  return new Map([...absoluteRects(out.boxes as LayoutRect[])].map(([id, r]) => [id, { x: r.x / scale, y: r.y / scale, w: r.width / scale, h: r.height / scale }]));
}

/** The page matrix of a node: each transformed ancestor-or-self's T(box) · paint matrix · T(-box), outermost first. */
function pageMatrix(p: NativeProgram, boxes: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>, id: string, model: Model): Matrix2D {
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  for (let at: string | null = id; at !== null; at = nodes.get(at)?.parent ?? null) chain.unshift(at);
  let m: Matrix2D = shift(0, 0);
  for (const a of chain) {
    const f = nodes.get(a)?.facts['transform'] as Facts | undefined;
    if (f === undefined || f.ops.length === 0) continue;
    const b = boxes.get(a);
    if (b === undefined) throw new Error(`${a}: no engine box`);
    const parent = nodes.get(a)?.parent;
    const ref = model === 'percent-of-parent' && parent !== null && parent !== undefined ? (boxes.get(parent) ?? b) : b;
    const origin: TransformOrigin = model === 'origin-ignored' ? { x: { kind: 'px', px: 0, percent: 0 }, y: { kind: 'px', px: 0, percent: 0 } } : f.origin;
    m = times(m, times(times(shift(b.x, b.y), paintTransformMatrix(f.ops, origin, ref.w, ref.h, TRIG)), shift(-b.x, -b.y)));
  }
  return m;
}

/** Every corner delta in device px of every transformed node of every transforms case at every DPR, under a model. */
async function deltas(model: Model): Promise<{ readonly where: string; readonly worst: number }[]> {
  const ids = new Set((await transformCases()).map((c) => c.id));
  const out: { where: string; worst: number }[] = [];
  for (const n of nativeCases().filter((c) => ids.has(c.case.id))) {
    const p = n.programs.uikit;
    for (const dpr of QUAD_DPRS) {
      const q = committedQuads(n.case.id, dpr);
      const boxes = cssBoxes(p, dpr);
      for (const node of q.nodes) {
        const b = boxes.get(node.id);
        if (b === undefined) throw new Error(`${n.case.id}: Chrome transforms ${node.id}, which the engine has no box for`);
        const m = pageMatrix(p, boxes, node.id, model);
        const corners = [mapPoint(m, b.x, b.y), mapPoint(m, b.x + b.w, b.y), mapPoint(m, b.x + b.w, b.y + b.h), mapPoint(m, b.x, b.y + b.h)];
        const worst = Math.max(...corners.flatMap((c, k) => [Math.abs(c.x - (node.quad[2 * k] as number)), Math.abs(c.y - (node.quad[2 * k + 1] as number))])) * dpr;
        out.push({ where: `${n.case.id}@${dpr} ${node.id}`, worst });
      }
    }
  }
  return out;
}

describe('PNT2: transformed geometry against Chrome', () => {
  it('captures quads at DPR 1 and every device DPR', () => {
    expect([...QUAD_DPRS]).toEqual([1, ...DPRS]);
  });

  it('transforms exactly the nodes Chrome transforms, and serialises each functions matrix as Chrome computes it', async () => {
    const ids = new Set((await transformCases()).map((c) => c.id));
    const cases = nativeCases().filter((c) => ids.has(c.case.id));
    expect(cases.length).toBe(ids.size);
    for (const n of cases) {
      const p = n.programs.uikit;
      const boxes = cssBoxes(p, 1);
      const q = committedQuads(n.case.id, 1);
      const dragon = p.nodes.filter((x) => ((x.facts['transform'] as Facts | undefined)?.ops.length ?? 0) > 0).map((x) => x.id);
      expect(q.nodes.map((x) => x.id), n.case.id).toEqual(dragon);
      for (const node of q.nodes) {
        const f = p.nodes.find((x) => x.id === node.id)?.facts['transform'] as Facts;
        const b = boxes.get(node.id) as { w: number; h: number };
        expect(serializeTransform(f.ops, b.w, b.h, TRIG), `${n.case.id} ${node.id}`).toBe(node.transform);
      }
    }
  }, 600_000);

  it('maps the engine box through the transform onto Chrome\'s content quad within GATE_DEVICE_PX at DPR 1, 2, 3 and 2.625', async () => {
    const d = await deltas('dragon');
    expect(d.length).toBeGreaterThan(100);
    const bad = d.filter((x) => x.worst > GATE_DEVICE_PX);
    expect(bad).toEqual([]);
    console.log(`pnt2-quads: ${d.length} transformed nodes; worst corner ${Math.max(...d.map((x) => x.worst)).toFixed(4)} device px`);
  }, 300_000);

  it('catches both planted models: the origin ignored, and percentages of the parent box', async () => {
    for (const model of ['origin-ignored', 'percent-of-parent'] as const) {
      const bad = (await deltas(model)).filter((x) => x.worst > GATE_DEVICE_PX);
      expect(bad.length, model).toBeGreaterThan(0);
    }
  }, 300_000);
});
