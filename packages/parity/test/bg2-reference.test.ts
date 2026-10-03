// BG2 two-stage paint proof, host stage (notes/T074-bg2-spec.md §7 item 3): the TS reference raster of every gradient box
// (paint-gradient.ts, the code the device runs translated) against the committed Chrome 145 screenshots, at every pixel a
// gradient layer paints exactly and the background alone decides in Chrome (inside the inner border edge, clear of rounded arcs:
// paint-samples/gradient.ts backgroundOnly), at DPR 2, 3 and 2.625. The measured maximum per-channel difference is printed and must not
// exceed the gradient allowance (allowances/gradient.ts, GATE_CHANNEL_DELTA: no allowance, R2). Planted faults, each a Chrome
// behaviour the reference must model, must each make some pixel differ: the libm table ignored (R3, fdlibm slopes), unpremultiplied
// stops, no dither, the page origin for a composited layer (R4), the single-tile models swapped (R5), an obscuring border ignored
// and the root scroll origin of a right-to-left page ignored (R4).
import { backgroundPixelExact, backgroundRow, gradientFaults } from '@dragon/layout';
import type { GradientFaults } from '@dragon/layout';
import { borderDevicePx, programInput } from 'dragon';
import { describe, expect, it } from 'vitest';
import { GRADIENT_CHANNEL_DELTA } from '../src/allowances/gradient.ts';
import { GATE_CHANNEL_DELTA } from '../src/compare.ts';
import { DPRS } from '../src/dpr.ts';
import { expectedEngine, nativeCases } from '../src/native-host.ts';
import { backgroundOnly, backgroundPlans, caseRootX } from '../src/paint-samples/gradient.ts';
import { linearSlope } from '../../dragon/src/analysis/paint-values/gradient.ts';
import type { NativeProgram } from 'dragon';
import { caseBoxes, committedPixels } from '../src/pixel-reference.ts';

type Tally = { pixels: number; differing: number; maxDelta: number; first: string | null };

/** The program with every linear slope taken from fdlibm alone (the libmTableIgnored plant, R3). */
function withFdlibmSlopes(p: NativeProgram): NativeProgram {
  const nodes = p.nodes.map((n) => ({
    ...n,
    writes: n.writes.map((w) => {
      if (w.kind !== 'background-layers') return w;
      const layers = (w as unknown as { layers: { gradient: { radial: boolean; direction: string; angleDeg: number; slope: number } }[] }).layers.map((l) => ({ ...l, gradient: { ...l.gradient, slope: !l.gradient.radial && l.gradient.direction === 'angle' ? (linearSlope(l.gradient.angleDeg, { libmTableIgnored: true }) as number) : l.gradient.slope } }));
      return { ...w, layers } as unknown as typeof w;
    }),
  }));
  return { ...p, nodes };
}

/** The program with each write's layer origin moved back by the root scroll origin, which cancels it (the rootScrollIgnored plant). */
function withRootScrollIgnored(p: NativeProgram, rootX: number): NativeProgram {
  const nodes = p.nodes.map((n) => ({ ...n, writes: n.writes.map((w) => (w.kind === 'background-layers' ? ({ ...w, layerOrigin: [-rootX, 0] } as unknown as typeof w) : w)) }));
  return { ...p, nodes };
}

/** Every exact painted pixel of every gradient box of every case, at every DPR, against the committed Chrome PNG. */
function compareAll(faults: GradientFaults, libmTableIgnored = false, rootScrollIgnored = false): { tally: Tally; cases: number; boxes: number } {
  const tally: Tally = { pixels: 0, differing: 0, maxDelta: 0, first: null };
  let cases = 0;
  let boxes = 0;
  const engine = expectedEngine();
  for (const n of nativeCases()) {
    const base = libmTableIgnored ? withFdlibmSlopes(n.programs['android-views']) : n.programs['android-views'];
    if (!base.nodes.some((node) => node.writes.some((w) => w.kind === 'background-layers'))) continue;
    cases++;
    for (const dpr of DPRS) {
      const program = rootScrollIgnored ? withRootScrollIgnored(base, caseRootX(base, n.case.environment.viewport, dpr)) : base;
      const chrome = committedPixels(n.case.id, dpr);
      if (chrome === null) throw new Error(`${n.case.id}: no committed Chrome PNG at DPR ${dpr} (pnpm run parity:pixel-capture)`);
      const viewport = n.case.environment.viewport;
      const borders = borderDevicePx(engine, programInput(program, viewport, dpr));
      // Chrome's border and rounded clip decide the pixels under a border and near or past a rounded corner, not the background.
      const only = backgroundOnly(program, caseBoxes(program, viewport, dpr), dpr);
      for (const { id, plan } of backgroundPlans(program, viewport, dpr, borders, faults)) {
        boxes++;
        for (let y = plan.top; y < plan.bottom; y++) {
          const row = backgroundRow(plan, y, faults);
          for (let x = plan.left; x < plan.right; x++) {
            const k = (x - plan.left) * 4;
            if (row[k + 3] !== 255 || !backgroundPixelExact(plan, x, y) || !only(id, x, y) || x < 0 || y < 0 || x >= chrome.width || y >= chrome.height) continue;
            tally.pixels++;
            const i = (y * chrome.width + x) * 4;
            let d = 0;
            for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs((chrome.data[i + c] as number) - (row[k + c] as number)));
            if (d > 0) {
              tally.differing++;
              if (tally.first === null) tally.first = `${n.case.id}@${dpr} ${id} (${x},${y}): Chrome ${[...chrome.data.subarray(i, i + 3)].join(',')}, reference ${row.slice(k, k + 3).join(',')}`;
            }
            tally.maxDelta = Math.max(tally.maxDelta, d);
          }
        }
      }
    }
  }
  return { tally, cases, boxes };
}

describe('BG2 reference raster against Chrome 145 (host stage of the two-stage paint proof)', () => {
  it('equals Chrome at every exactly painted gradient pixel, at DPR 2, 3 and 2.625; the gradient allowance is none', () => {
    expect(GRADIENT_CHANNEL_DELTA).toBe(GATE_CHANNEL_DELTA);
    const { tally, cases, boxes } = compareAll(gradientFaults('none'));
    console.log(`bg2-reference: ${cases} cases, ${boxes} box rasters, ${tally.pixels} pixels compared, ${tally.differing} differing, max per-channel difference ${tally.maxDelta}${tally.first === null ? '' : `; first ${tally.first}`}`);
    expect(cases).toBeGreaterThanOrEqual(10);
    expect(tally.pixels).toBeGreaterThan(1_000_000);
    expect(tally.maxDelta).toBeLessThanOrEqual(GRADIENT_CHANNEL_DELTA);
  }, 600_000);
  for (const plant of ['offsetOne', 'unpremultiplied', 'ditherOff', 'singleTileModelSwapped', 'obscuredBorderIgnored'] as const) {
    it(`catches the ${plant} plant`, () => {
      const { tally } = compareAll(gradientFaults(plant));
      console.log(`bg2-reference --plant ${plant}: ${tally.differing} of ${tally.pixels} pixels differ, max ${tally.maxDelta}`);
      expect(tally.differing).toBeGreaterThan(0);
    }, 600_000);
  }
  it('catches the rootScrollIgnored plant: the root layer of a right-to-left page overflowing to the left starts at its scroll origin (R4)', () => {
    const { tally } = compareAll(gradientFaults('none'), false, true);
    console.log(`bg2-reference --plant rootScrollIgnored: ${tally.differing} of ${tally.pixels} pixels differ, max ${tally.maxDelta}`);
    expect(tally.differing).toBeGreaterThan(0);
  }, 600_000);
  it('catches the libmTableIgnored plant: fdlibm slopes move Chrome pixels on the table\'s angles (R3)', () => {
    const { tally } = compareAll(gradientFaults('none'), true);
    console.log(`bg2-reference --plant libmTableIgnored: ${tally.differing} of ${tally.pixels} pixels differ, max ${tally.maxDelta}`);
    expect(tally.differing).toBeGreaterThan(0);
  }, 600_000);
});
