// REPL-r1: an img whose src the app sets at run time, laid out once by Dragon and rendered by Chrome once per sample image
// (runtime-samples.ts, committed by parity:runtime-capture). Every sample's boxes equal Dragon's one layout at DPR 1, 2, 2.625 and
// 3 in both directions; where Chrome draws each sample is where the engine's runtimeImagePaint puts it for that sample's size; the
// no-image outline is where Chrome strokes it; the old image stays while a new src loads. Each planted fault fails.
import { describe, expect, it } from 'vitest';
// targets.ts first: it and dpr.ts import each other, and dpr.ts must finish before targets.ts runs.
import { deviceDprs } from '../src/targets.ts';
import type { LayoutBox, LayoutInput, LayoutNode, ObjectRect, ReplacedLeaf, ReplacedPaint } from '@dragon/layout';
import { absoluteRects, layout, NO_ENGINE_FAULTS, resolveBorder, resolvePadding, runtimeImagePaint, zoomInput } from '@dragon/layout';
import type { Compiled, LayoutProjection } from 'dragon';
import { engineLayoutProjection, nativePrograms, NO_FAULTS } from 'dragon';
import { nativeCompileOnce } from '../src/native-compile.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import type { ParityCase } from '../src/cases.ts';
import { atDpr, runDprCase } from '../src/dpr.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { compileFixture, enforcedCompile } from '../src/pipeline.ts';
import type { Projection } from '../src/pipeline.ts';
import type { RuntimeSample } from '../src/runtime-samples.ts';
import { committedRuntimeCapture, committedRuntimePixels, fixtureRuntimeLayout, QUADRANTS, RUNTIME_DPRS, runtimeImgs, samplesOf } from '../src/runtime-samples.ts';
import { referenceShapedMeasurer } from '../src/text-shaper-host.ts';

const RUNTIME = FIXTURES.filter((s) => s.format === 'html' && runtimeImgs(fixtureInput(s)).length > 0);
const LAYOUT = RUNTIME.filter((s) => s.kind === 'layout');
const DEVICE_DPRS = [...new Set([...deviceDprs('ios'), ...deviceDprs('android')])].sort((a, b) => a - b);
const casesOfSpec = (id: string): ParityCase[] => {
  const spec = RUNTIME.find((s) => s.id === id);
  if (spec === undefined) throw new Error(`no runtime fixture ${id}`);
  return casesOf(spec, fixtureInput(spec));
};
const samples = (id: string): readonly RuntimeSample[] => samplesOf(id, runtimeImgs(fixtureInput(RUNTIME.find((s) => s.id === id) as (typeof RUNTIME)[number])).some((i) => i.absent));

// The plant runtimeNaturalUnchecked: the run-time natural size reads as 300x150 instead of refusing the layout.
const unchecked = (n: LayoutNode): LayoutNode => {
  if (n.kind === 'replaced') return n.natural.kind === 'runtime' ? { ...n, natural: { kind: 'image', width: 300, height: 150 } } : n;
  if (n.kind === 'box' || n.kind === 'control') return { ...n, children: n.children.map((c) => (c.kind === 'box' || c.kind === 'control' || c.kind === 'replaced' ? unchecked(c) : c)) } as LayoutNode;
  return n;
};
const uncheckedInput = (input: LayoutInput): LayoutInput => ({ ...input, root: unchecked(input.root) as LayoutBox });
const uncheckedProjection: Projection = (compiled, env, assignment) => {
  const p: LayoutProjection = engineLayoutProjection(compiled, env, assignment);
  return p.kind === 'ready' ? { ...p, input: uncheckedInput(p.input) } : p;
};

describe('REPL-r1: every sample image Chrome loads lays out as Dragon\'s one layout', () => {
  it('covers the runtime fixtures, at DPR 1 and every device DPR', () => {
    expect(RUNTIME_DPRS).toEqual([1, ...DEVICE_DPRS]);
    expect(LAYOUT.map((s) => s.id)).toEqual(['replaced-runtime-sized', 'replaced-runtime-ratio', 'replaced-runtime-fit', 'replaced-runtime-flex', 'replaced-runtime-grid', 'replaced-runtime-absent', 'replaced-runtime-src-change']);
    expect(RUNTIME.length - LAYOUT.length).toBe(6);
  });

  it('at DPR 1, 2, 2.625 and 3, in both directions, every sample (loaded, pending, no src and changed) is exact in LU', () => {
    const off: string[] = [];
    let compared = 0;
    for (const spec of LAYOUT) {
      for (const c of casesOfSpec(spec.id)) {
        const compiled = enforcedCompile(spec, c.environment.direction);
        for (const sample of samples(spec.id)) {
          for (const dpr of RUNTIME_DPRS) {
            const o = runDprCase(c, compiled, dpr, committedRuntimeCapture(c.id, sample.id, dpr));
            compared++;
            if (o.status !== 'pass') off.push(`${c.id}~${sample.id}@${dpr}: ${o.reason}`);
          }
        }
      }
    }
    expect(off).toEqual([]);
    expect(compared).toBe(14 * 4 * 9 + 2 * 4 * 2);
  });
});

describe('REPL-r1 plant runtimeNaturalUnchecked: the run-time natural size read as 300x150', () => {
  const READS = ['reject-runtime-src-auto-height', 'reject-runtime-src-auto-ratio', 'reject-runtime-src-flex-auto-min', 'reject-runtime-src-shrink-to-fit'];
  const planted = (id: string): Compiled<'ios' | 'web'> => compileFixture(RUNTIME.find((s) => s.id === id) as (typeof RUNTIME)[number], NO_FAULTS, 'enforce', 'ltr', (i) => i, fixtureRuntimeLayout(ENVIRONMENT.viewport, uncheckedInput)).compiled;

  it('lets every reject fixture whose layout reads the natural size compile', () => {
    for (const id of READS) {
      const c = planted(id);
      expect(c.diagnostics.filter((d) => d.code === 'DRAGON_RUNTIME_IMAGE_SIZE').map((d) => d.message), id).toEqual([]);
      expect(c.ok, id).toBe(true);
    }
  });

  it('then lays the flex and shrink-to-fit fixtures out differently from Chrome for some sample', () => {
    for (const id of ['reject-runtime-src-flex-auto-min', 'reject-runtime-src-shrink-to-fit', 'reject-runtime-src-auto-height']) {
      const [c] = casesOfSpec(id) as [ParityCase];
      const compiled = planted(id);
      const failing = samples(id).flatMap((s) => RUNTIME_DPRS.filter((dpr) => runDprCase(c, compiled, dpr, committedRuntimeCapture(c.id, s.id, dpr), NO_ENGINE_FAULTS, uncheckedProjection).status === 'fail').map((dpr) => `${s.id}@${dpr}`));
      expect(failing.length, id).toBeGreaterThan(0);
    }
  });
});

/** Each runtimeSrc img of a case at a DPR: its zoomed leaf and its content box in absolute LU, as DragonTree.apply computes them. */
function runtimeBoxes(c: ParityCase, dpr: number): Map<string, { readonly leaf: ReplacedLeaf; readonly content: ObjectRect }> {
  const p = engineLayoutProjection(enforcedCompile(RUNTIME.find((s) => s.id === c.fixture) as (typeof RUNTIME)[number], c.environment.direction), atDpr(c.environment, dpr), c.assignment);
  if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
  const r = layout(p.input, referenceShapedMeasurer());
  if (r.kind !== 'ok') throw new Error(`${c.id}: ${r.unsupported.code}`);
  const abs = absoluteRects(r.boxes);
  const zoomed = zoomInput(p.input, NO_ENGINE_FAULTS);
  const out = new Map<string, { leaf: ReplacedLeaf; content: ObjectRect }>();
  const inner = (b: { readonly id: string; readonly style: LayoutBox['style'] }, cb: number): number => {
    const a = abs.get(b.id) as { width: number };
    const bor = resolveBorder(b.style, zoomed.devicePixelRatio);
    const pad = resolvePadding(b.style, cb as never);
    return a.width - bor.left - bor.right - pad.left - pad.right;
  };
  const walk = (b: LayoutBox, cb: number): void => {
    const w = inner(b, cb);
    for (const k of b.children) {
      if (k.kind === 'box') walk(k, w);
      if (k.kind !== 'replaced' || k.natural.kind !== 'runtime') continue;
      const a = abs.get(k.id) as { x: number; y: number; width: number; height: number };
      const bor = resolveBorder(k.style, zoomed.devicePixelRatio);
      const pad = resolvePadding(k.style, w as never);
      const x = a.x + bor.left + pad.left;
      const y = a.y + bor.top + pad.top;
      out.set(k.id, { leaf: k, content: { x, y, width: Math.max(0, a.width - bor.left - bor.right - pad.left - pad.right), height: Math.max(0, a.height - bor.top - bor.bottom - pad.top - pad.bottom) } as ObjectRect });
    }
  };
  walk(zoomed.root, zoomed.viewport.width * 64);
  return out;
}

const pixel = (img: RgbaImage, x: number, y: number): string => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)].join(',');
const rgb = (c: readonly number[]): string => c.slice(0, 3).join(',');

/**
 * The points where a sample's four quadrants show flat in a paint: the middle of each quadrant's part of the drawn rect, at least 3
 * device px inside the drawn edges and two source pixels inside the quadrant edges (Chrome's filter blends across them), with the
 * quadrant's colour.
 */
function quadrantPoints(p: ReplacedPaint, w: number, h: number): { x: number; y: number; want: string }[] {
  const d = p.drawn;
  if (d === null) return [];
  const xs = [p.dest.x, p.dest.x + (p.dest.width * Math.ceil(w / 2)) / w, p.dest.x + p.dest.width];
  const ys = [p.dest.y, p.dest.y + (p.dest.height * Math.ceil(h / 2)) / h, p.dest.y + p.dest.height];
  const out: { x: number; y: number; want: string }[] = [];
  for (let q = 0; q < 4; q++) {
    const qx = q % 2;
    const qy = q >> 1;
    const sx = Math.max(3, (2 * p.dest.width) / w);
    const sy = Math.max(3, (2 * p.dest.height) / h);
    const x0 = qx === 0 ? Math.max(xs[0] as number, d.x) + 3 : Math.max((xs[1] as number) + sx, d.x + 3);
    const x1 = qx === 0 ? Math.min((xs[1] as number) - sx, d.x + d.width - 3) : Math.min(xs[2] as number, d.x + d.width) - 3;
    const y0 = qy === 0 ? Math.max(ys[0] as number, d.y) + 3 : Math.max((ys[1] as number) + sy, d.y + 3);
    const y1 = qy === 0 ? Math.min((ys[1] as number) - sy, d.y + d.height - 3) : Math.min(ys[2] as number, d.y + d.height) - 3;
    if (x1 <= x0 || y1 <= y0) continue;
    out.push({ x: Math.floor((x0 + x1) / 2), y: Math.floor((y0 + y1) / 2), want: rgb(QUADRANTS[q] as readonly number[]) });
  }
  return out;
}

describe('REPL-r1 paint: Chrome draws each sample where runtimeImagePaint puts it for that sample\'s size', () => {
  const [fit] = casesOfSpec('replaced-runtime-fit') as [ParityCase];
  const pngs = samples('replaced-runtime-fit').filter((s) => s.kind === 'png');
  const misses = (natural: (s: RuntimeSample) => readonly [number, number]): { readonly off: string[]; readonly compared: number } => {
    const off: string[] = [];
    let compared = 0;
    for (const dpr of DEVICE_DPRS) {
      const boxes = runtimeBoxes(fit, dpr);
      for (const s of pngs) {
        const chrome = committedRuntimePixels(fit.id, s.id, dpr);
        const [w, h] = natural(s);
        for (const [id, b] of boxes) {
          for (const pt of quadrantPoints(runtimeImagePaint(b.leaf, b.content, w, h, dpr), s.width, s.height)) {
            compared++;
            const got = pixel(chrome, pt.x, pt.y);
            if (got !== pt.want) off.push(`${s.id}@${dpr} ${id} (${pt.x}, ${pt.y}): Chrome ${got}, quadrant ${pt.want}`);
          }
        }
      }
    }
    return { off, compared };
  };

  it('every quadrant of every PNG sample shows in Chrome where the engine draws it, at DPR 2, 2.625 and 3', () => {
    const r = misses((s) => [s.width, s.height]);
    expect(r.off).toEqual([]);
    expect(r.compared).toBeGreaterThan(150);
  });

  it('plant runtimeDestStatic: the device places every image as if 1x1, which Chrome contradicts', () => {
    expect(misses(() => [1, 1]).off.length).toBeGreaterThan(50);
  });
});

describe('REPL-r1 paint: the no-image outline', () => {
  const [absent] = casesOfSpec('replaced-runtime-absent') as [ParityCase];
  const writes = (): Map<string, { readonly absent: unknown }> => {
    const p = nativePrograms(nativeCompileOnce(RUNTIME.find((s) => s.id === absent.fixture) as (typeof RUNTIME)[number], 'ltr'), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return new Map(p.programs.uikit.nodes.flatMap((n) => n.writes.filter((w) => w.kind === 'runtime-image').map((w) => [n.id, w as unknown as { absent: unknown }] as const)));
  };
  /** Where a write strokes the outline in a snapped content box once the app says there is no image, and where it must not. */
  const outline = (w: { readonly absent: unknown }, c: ReplacedPaint['content']): { readonly gray: readonly [number, number][]; readonly clear: readonly [number, number][] } => {
    const midX = c.x + Math.floor(c.width / 2);
    const midY = c.y + Math.floor(c.height / 2);
    const band: [number, number][] = [[c.x, midY], [c.x + c.width - 1, midY], [midX, c.y], [midX, c.y + c.height - 1]];
    const inside: [number, number][] = c.width > 4 && c.height > 4 ? [[c.x + 1, midY], [midX, c.y + 1]] : [];
    return w.absent !== null && c.width > 2 && c.height > 2 ? { gray: band, clear: inside } : { gray: [], clear: [...band, ...inside] };
  };
  const misses = (ws: ReadonlyMap<string, { readonly absent: unknown }>, sample: string, drawn: boolean): string[] => {
    const off: string[] = [];
    for (const dpr of DEVICE_DPRS) {
      const chrome = committedRuntimePixels(absent.id, sample, dpr);
      for (const [id, b] of runtimeBoxes(absent, dpr)) {
        const w = ws.get(id);
        if (w === undefined) throw new Error(`${id}: no runtime-image write`);
        const o = outline(drawn ? w : { absent: null }, runtimeImagePaint(b.leaf, b.content, 0, 0, dpr).content);
        for (const [x, y] of o.gray) if (pixel(chrome, x, y) !== '192,192,192') off.push(`${sample}@${dpr} ${id} (${x}, ${y}): Chrome ${pixel(chrome, x, y)}, the outline`);
        for (const [x, y] of o.clear) if (pixel(chrome, x, y) === '192,192,192') off.push(`${sample}@${dpr} ${id} (${x}, ${y}): Chrome strokes the outline, the device draws none`);
      }
    }
    return off;
  };

  it('a missing src strokes 1 device px of rgb(192, 192, 192) inside the snapped content box over 2 device px, at DPR 2, 2.625 and 3', () => {
    const ws = writes();
    expect([...ws.values()].every((w) => w.absent !== null)).toBe(true);
    expect(misses(ws, 'none', true)).toEqual([]);
  });

  it('a pending src draws no outline (the device draws nothing before the app sets an image)', () => {
    expect(misses(writes(), 'pending', false)).toEqual([]);
  });

  it('plant runtimeAbsentOutlineDropped: a write without the outline, which Chrome contradicts', () => {
    expect(misses(new Map([...writes()].map(([id]) => [id, { absent: null }])), 'none', true).length).toBeGreaterThan(5);
  });
});

describe('REPL-r1: a src changed at run time keeps the old image until the new one is set', () => {
  const [change] = casesOfSpec('replaced-runtime-src-change') as [ParityCase];
  /** Whether two screenshots agree on every pixel of the img's snapped content box. */
  const differs = (a: RgbaImage, b: RgbaImage, c: ReplacedPaint['content']): number => {
    let n = 0;
    for (let y = c.y; y < c.y + c.height; y++) for (let x = c.x; x < c.x + c.width; x++) if (pixel(a, x, y) !== pixel(b, x, y)) n++;
    return n;
  };
  const content = (dpr: number): ReplacedPaint['content'] => {
    const b = runtimeBoxes(change, dpr).get('a');
    if (b === undefined) throw new Error('no runtime img a');
    return runtimeImagePaint(b.leaf, b.content, 0, 0, dpr).content;
  };

  it('Chrome shows the first image while the second is pending, then the second, in the same box', () => {
    for (const dpr of DEVICE_DPRS) {
      const first = committedRuntimePixels(change.id, 'png-400x300', dpr);
      expect(differs(committedRuntimePixels(change.id, 'swap-pending', dpr), first, content(dpr)), `${dpr}`).toBe(0);
      expect(differs(committedRuntimePixels(change.id, 'swap-loaded', dpr), committedRuntimePixels(change.id, 'png-100x4000', dpr), content(dpr)), `${dpr}`).toBe(0);
    }
  });

  it('plant runtimeSrcSwapClears: a device that clears the image on a new src shows the box background, which Chrome contradicts', () => {
    for (const dpr of DEVICE_DPRS) expect(differs(committedRuntimePixels(change.id, 'swap-pending', dpr), committedRuntimePixels(change.id, 'pending', dpr), content(dpr)), `${dpr}`).toBeGreaterThan(100);
  });
});
