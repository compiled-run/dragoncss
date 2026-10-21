// MISC-PAINT, host stage of the two-stage paint proof: the TS reference raster of every gradient border image
// (paint-gradient.ts planBorderImage and backgroundRow, the code the device runs translated) against the committed Chrome 145
// screenshots, at every pixel a piece paints exactly (opaque, no fractional piece edge across it) and no other box covers, at DPR 2,
// 3 and 2.625. The measured maximum per-channel difference is printed and must not exceed the gradient allowance
// (GATE_CHANNEL_DELTA: no allowance). Each planted reading, a Chrome behaviour the reference must model, must make some pixel differ:
// the raster 1 device px right (the border-image-offset-1 plant's host twin), no dither, the slices read top for left (the
// grid's sides), fill ignored, every width read as 1 (ComputeEdgeWidth ignored), and border-image-repeat read as stretch (the
// tiling of MISC-PAINT part 2 ignored). The device stage samples the same pixels
// (paint-samples/border.ts, rule gradient:<box>) and the border-image-offset-1 plant runs on border-image-gradient
// (device-run.ts PLANT_CASES).
import { backgroundPixelExact, backgroundRow, gradientFaults } from '@dragon/layout';
import type { GradientFaults } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { borderDevicePx, programInput } from 'dragon';
import { describe, expect, it } from 'vitest';
import { GRADIENT_CHANNEL_DELTA } from '../src/allowances/gradient.ts';
import { GATE_CHANNEL_DELTA } from '../src/compare.ts';
import { PLANT_CASES, PLANT_RULES } from '../src/device-run.ts';
import { DPRS } from '../src/dpr.ts';
import { expectedEngine, nativeCases } from '../src/native-host.ts';
import { borderImagePlans, borderImagePoints } from '../src/paint-samples/border.ts';
import { caseBoxes, casePoints, committedPixels, rasterSize } from '../src/pixel-reference.ts';
import { isScanlineRule } from '../src/samples.ts';

type Tally = { pixels: number; differing: number; maxDelta: number; first: string | null };
type Reading = 'none' | 'slicesSwapped' | 'fillIgnored' | 'widthsOne' | 'repeatIgnored';

/** The program with each border image write read as the planted reading says. */
function read(p: NativeProgram, reading: Reading): NativeProgram {
  if (reading === 'none') return p;
  const nodes = p.nodes.map((n) => ({
    ...n,
    writes: n.writes.map((w) => {
      if (w.kind !== 'border-image') return w;
      const b = w as unknown as { slices: readonly unknown[]; fill: boolean; widths: readonly unknown[] };
      if (reading === 'slicesSwapped') return { ...w, slices: [b.slices[3], b.slices[2], b.slices[1], b.slices[0]] } as unknown as typeof w;
      if (reading === 'fillIgnored') return { ...w, fill: !b.fill } as unknown as typeof w;
      if (reading === 'repeatIgnored') return { ...w, repeat: ['stretch', 'stretch'] } as unknown as typeof w;
      return { ...w, widths: [0, 1, 2, 3].map(() => ({ unit: 'number', value: 1 })) } as unknown as typeof w;
    }),
  }));
  return { ...p, nodes };
}

/** Every exact border image pixel of every case at every DPR against the committed Chrome PNG. */
function compareAll(faults: GradientFaults, reading: Reading = 'none'): { tally: Tally; cases: number; boxes: number } {
  const tally: Tally = { pixels: 0, differing: 0, maxDelta: 0, first: null };
  let cases = 0;
  let boxes = 0;
  const engine = expectedEngine();
  for (const n of nativeCases()) {
    const base = n.programs['android-views'];
    if (!base.nodes.some((node) => node.writes.some((w) => w.kind === 'border-image'))) continue;
    cases++;
    const program = read(base, reading);
    for (const dpr of DPRS) {
      const chrome = committedPixels(n.case.id, dpr);
      if (chrome === null) throw new Error(`${n.case.id}: no committed Chrome PNG at DPR ${dpr} (pnpm run parity:pixel-capture)`);
      const viewport = n.case.environment.viewport;
      // The judged pixels are the unplanted reference's own (the samples' rule): a planted reading is judged where Chrome shows the image.
      const exact = new Map(borderImagePlans(base, viewport, dpr, borderDevicePx(engine, programInput(base, viewport, dpr))).map((x) => [x.id, x.plan] as const));
      const sample = caseBoxes(base, viewport, dpr);
      for (const { id, plan } of borderImagePlans(program, viewport, dpr, borderDevicePx(engine, programInput(program, viewport, dpr)), faults)) {
        boxes++;
        const own = exact.get(id);
        const box = sample.find((b) => b.id === id);
        if (own === undefined || box === undefined) throw new Error(`${n.case.id}: ${id} has no unplanted plan or sample box`);
        const others = sample.filter((b) => b.id !== id && !(b.left <= box.left && b.top <= box.top && b.right >= box.right && b.bottom >= box.bottom));
        const exactRows = new Map<number, readonly number[]>();
        for (let y = own.top; y < own.bottom; y++) {
          const want = backgroundRow(own, y, gradientFaults('none'));
          exactRows.set(y, want);
          const row = y >= plan.top && y < plan.bottom ? backgroundRow(plan, y, faults) : [];
          for (let x = own.left; x < own.right; x++) {
            const k = (x - own.left) * 4;
            if (want[k + 3] !== 255 || !backgroundPixelExact(own, x, y) || x < 0 || y < 0 || x >= chrome.width || y >= chrome.height) continue;
            if (others.some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom)) continue;
            tally.pixels++;
            const r = (x - plan.left) * 4;
            const got = x >= plan.left && x < plan.right && row.length > 0 ? [row[r] as number, row[r + 1] as number, row[r + 2] as number] : [-255, -255, -255];
            const i = (y * chrome.width + x) * 4;
            let d = 0;
            for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((chrome.data[i + c] as number) - (got[c] as number)));
            if (d > 0) {
              tally.differing++;
              if (tally.first === null) tally.first = `${n.case.id}@${dpr} ${id} (${x},${y}): Chrome ${[...chrome.data.subarray(i, i + 3)].join(',')}, reference ${got.join(',')}`;
            }
            tally.maxDelta = Math.max(tally.maxDelta, d);
          }
        }
      }
    }
  }
  return { tally, cases, boxes };
}

describe('MISC-PAINT border image reference raster against Chrome 145 (host stage of the two-stage paint proof)', () => {
  it('equals Chrome at every exactly painted border image pixel, at DPR 2, 3 and 2.625; the allowance is none', () => {
    expect(GRADIENT_CHANNEL_DELTA).toBe(GATE_CHANNEL_DELTA);
    const { tally, cases, boxes } = compareAll(gradientFaults('none'));
    console.log(`border-image-reference: ${cases} cases, ${boxes} box rasters, ${tally.pixels} pixels compared, ${tally.differing} differing, max per-channel difference ${tally.maxDelta}${tally.first === null ? '' : `; first ${tally.first}`}`);
    expect(cases).toBeGreaterThanOrEqual(2);
    expect(boxes).toBeGreaterThanOrEqual(2 * 3 * 15);
    expect(tally.pixels).toBeGreaterThan(100_000);
    expect(tally.maxDelta).toBeLessThanOrEqual(GRADIENT_CHANNEL_DELTA);
  }, 600_000);
  for (const plant of ['offsetOne', 'ditherOff'] as const) {
    it(`catches the ${plant} plant`, () => {
      const { tally } = compareAll(gradientFaults(plant));
      console.log(`border-image-reference --plant ${plant}: ${tally.differing} of ${tally.pixels} pixels differ, max ${tally.maxDelta}`);
      expect(tally.differing).toBeGreaterThan(0);
    }, 600_000);
  }
  for (const reading of ['slicesSwapped', 'fillIgnored', 'widthsOne', 'repeatIgnored'] as const) {
    it(`catches the ${reading} reading`, () => {
      const { tally } = compareAll(gradientFaults('none'), reading);
      console.log(`border-image-reference --reading ${reading}: ${tally.differing} of ${tally.pixels} pixels differ, max ${tally.maxDelta}`);
      expect(tally.differing).toBeGreaterThan(0);
    }, 600_000);
  }
});

describe('MISC-PAINT border image device samples', () => {
  it('sample every drawn border image box at every DPR, keep only the base points its image leaves unpainted, and are caught by the border-image-offset-1 twin', () => {
    expect(PLANT_CASES['border-image-offset-1']).toEqual(['border-image-gradient']);
    const engine = expectedEngine();
    let caught = 0;
    let kept = 0;
    for (const n of nativeCases().filter((c) => c.spec.id === 'border-image-gradient' || c.spec.id === 'border-image-fractional' || c.spec.id === 'border-image-repeat' || c.spec.id === 'border-image-webkit')) {
      const program = n.programs['android-views'];
      const viewport = n.case.environment.viewport;
      for (const dpr of DPRS) {
        const points = casePoints(program, viewport, dpr);
        const plans = borderImagePlans(program, viewport, dpr, borderDevicePx(engine, programInput(program, viewport, dpr)));
        for (const { id, plan } of plans) {
          if (plan.layers.length > 0) expect(points.filter((p) => p.rule === `gradient:${id}`).length, `${n.case.id}@${dpr} ${id}`).toBeGreaterThan(0);
          // The base points a border image box keeps are ones its image paints nothing at (the open border band, the unfilled
          // interior), and no edge scanline.
          for (const p of points.filter((q) => /^(border|edge|interior|radius):/.test(q.rule) && q.rule.split(':')[1] === id)) {
            expect(isScanlineRule(p.rule), `${n.case.id}@${dpr} ${p.rule}`).toBe(false);
            const painted = p.y >= plan.top && p.y < plan.bottom && p.x >= plan.left && p.x < plan.right ? (backgroundRow(plan, p.y, gradientFaults('none'))[(p.x - plan.left) * 4 + 3] as number) : 0;
            expect(painted, `${n.case.id}@${dpr} ${p.rule} (${p.x},${p.y})`).toBe(0);
            kept++;
          }
        }
        if (n.spec.id !== 'border-image-gradient') continue;
        // The plant's twin: every border image drawn 1 device px right changes some sampled Chrome pixel the rule names.
        const chrome = committedPixels(n.case.id, dpr);
        if (chrome === null) throw new Error(`${n.case.id}: no committed Chrome PNG at DPR ${dpr}`);
        const shifted = new Map(borderImagePlans(program, viewport, dpr, borderDevicePx(engine, programInput(program, viewport, dpr)), gradientFaults('offsetOne')).map((p) => [p.id, p.plan] as const));
        const size = rasterSize(viewport, dpr);
        for (const p of borderImagePoints({ program, viewport, dpr, size, boxes: caseBoxes(program, viewport, dpr), base: [] })) {
          if (!PLANT_RULES['border-image-offset-1'].test(p.rule)) continue;
          const plan = shifted.get(p.rule.slice('gradient:'.length));
          if (plan === undefined || p.y < plan.top || p.y >= plan.bottom || p.x < plan.left || p.x >= plan.right) continue;
          const row = backgroundRow(plan, p.y, gradientFaults('offsetOne'));
          const k = (p.x - plan.left) * 4;
          const i = (p.y * chrome.width + p.x) * 4;
          let d = 0;
          for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((chrome.data[i + c] as number) - (row[k + c] as number)));
          if (d > GRADIENT_CHANNEL_DELTA) caught++;
        }
      }
    }
    expect(caught).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  }, 600_000);
});
