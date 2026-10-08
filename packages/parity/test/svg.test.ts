// SVG-a1 (/tmp/specs/svg-a.md): the strict outline differential (svg-compare.ts). Its viewBox and client-rect arithmetic is pinned
// against values captured from Chrome 145 at DPR 1, every svg fixture case passes it against its committed capture, and each
// planted fault fails it.
import { describe, expect, it } from 'vitest';
import { absoluteRects, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, REFERENCE_PLATFORM, validateLayoutInput } from '@dragon/layout';
import { iosLayoutProjection, svgScenes } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { committedAuthored } from '../src/committed.ts';
import { SVG } from '../src/fixture-groups/svg.ts';
import { compileFixture } from '../src/pipeline.ts';
import type { SvgFaults } from '../src/svg-compare.ts';
import { chromeViewBoxTransform, compareSvg, NO_SVG_FAULTS, shapeClientRect } from '../src/svg-compare.ts';

// [viewport width, height, viewBox, getScreenCTM [a, d, e, f]] of a 1x1 rect in an svg at the page origin.
const CHROME_CTM: readonly [number, number, readonly number[], readonly number[]][] = [
  [58, 29, [6, 6, 12, 8], [3.625, 3.625, -14.5, -21.75]],
  [47, 71, [0, -5, 17, 29], [2.4482758620689653, 2.4482758620689653, 2.6896551724137914, 12.241379310344826]],
  [74, 31, [-1, -6, 12, 21], [1.4761904761904763, 1.4761904761904763, 29.619047619047624, 8.857142857142858]],
  [63, 63, [-5, 6, 4, 28], [2.25, 2.25, 38.25, -13.5]],
  [91, 11, [10, 8, 11, 19], [0.5789473684210527, 0.5789473684210527, 36.526315789473685, -4.631578947368421]],
  [52, 69, [-10, 2, 9, 12], [5.75, 5.75, 57.62499999999999, -11.5]],
  [22, 38, [2, -2, 10, 29], [1.3103448275862069, 1.3103448275862069, 1.8275862068965525, 2.6206896551724137]],
  [76, 33, [1, -8, 21, 3], [3.619047619047619, 3.619047619047619, -3.619047619047619, 40.023809523809526]],
  [78, 41, [8, -8, 9, 14], [2.9285714285714284, 2.9285714285714284, 2.392857142857141, 23.428571428571427]],
  [23, 36, [3, -8, 26, 13], [0.8846153846153846, 0.8846153846153846, -2.6538461538461537, 19.326923076923077]],
  [15, 80, [-2, -6, 4, 11], [3.75, 3.75, 7.5, 41.875]],
  [76, 84, [-3, 7, 22, 20], [3.4545454545454546, 3.4545454545454546, 10.363636363636363, -16.72727272727273]],
];

// [rect x, y, width, height], getScreenCTM [a, d, e, f], the svg's left and top, getBoundingClientRect.
const CHROME_CLIENT_RECT: readonly [readonly number[], readonly number[], readonly number[], readonly number[]][] = [
  [[3.5, -0.5, 3.125, 6.375], [2.7142857142857144, 2.7142857142857144, 34.107142857142854, 189.75], [25.75, 170.75], [43.60714340209961, 188.39285278320312, 8.48214340209961, 17.303573608398438]],
  [[2.5, -3.75, 0.375, 14.375], [4.5625, 4.5625, 68.65625, 227.875], [30.125, 191.375], [80.0625, 210.765625, 1.7109375, 65.5859375]],
  [[12.125, 12.25, 8, 11.5], [0.9444444444444444, 0.9444444444444444, 77.65277777777777, 129.06944444444446], [79.625, 136.625], [89.10416412353516, 140.63888549804688, 7.5555572509765625, 10.861114501953125]],
  [[9.75, 10.125, 7.875, 0.25], [3.4545454545454546, 3.4545454545454546, -0.6477272727272734, 204.3181818181818], [16.625, 214], [33.034088134765625, 239.2954559326172, 27.204547882080078, 0.8636322021484375]],
  [[12.5, 5.875, 9.875, 11.5], [1.375, 1.375, 55.125, 49.25], [57.875, 46.75], [72.3125, 57.328125, 13.578125, 15.8125]],
  [[5.875, 12.875, 7.625, 8.625], [1.2142857142857142, 1.2142857142857142, 32.910714285714285, 145.01785714285714], [30.375, 149.875], [40.04464340209961, 160.6517791748047, 9.258930206298828, 10.473220825195312]],
  [[13.625, -3.25, 2.875, 9], [1.8461538461538463, 1.8461538461538463, 42.721153846153854, 258.0769230769231], [20.375, 271], [67.875, 252.07691955566406, 5.3076934814453125, 16.615402221679688]],
  [[1.375, 8.625, 6.875, 3.25], [3.8333333333333335, 3.8333333333333335, 57.666666666666664, 52.08333333333333], [80.25, 82.75], [62.9375, 85.14583587646484, 26.354164123535156, 12.458328247070312]],
  [[10, 7.25, 9.75, 0.375], [4.65, 4.65, 51.97500000000001, 321.575], [1.5, 284.375], [98.4749984741211, 355.2875061035156, 45.337501525878906, 1.743743896484375]],
  [[-0.125, -4.875, 1, 4.25], [2.111111111111111, 2.111111111111111, 74.48611111111111, 227.04166666666666], [91.375, 209.875], [74.22222137451172, 216.75, 2.111114501953125, 8.97222900390625]],
  [[1.5, 12.25, 0.125, 14], [2.3125, 2.3125, 64.1875, 215.0625], [63.75, 203.5], [67.65625, 243.390625, 0.2890625, 32.375]],
  [[-1.75, 12, 10.125, 0.125], [2.8333333333333335, 2.8333333333333335, 66.20833333333333, 237.625], [63.375, 189.875], [61.25, 271.625, 28.6875, 0.354156494140625]],
];

function measurer() {
  const m = measurerFor(REFERENCE_PLATFORM);
  if (m.kind !== 'ok') throw new Error(`${m.code}: ${m.detail}`);
  return m.measurer;
}

describe('the viewBox and client-rect arithmetic', () => {
  it("gives Chrome's getScreenCTM exactly: the limiting axis scaled, the other centred in user units, then scaled", () => {
    for (const [w, h, [x, y, vw, vh], ctm] of CHROME_CTM) {
      const m = chromeViewBoxTransform({ x: x as number, y: y as number, width: vw as number, height: vh as number }, w, h);
      expect([m.a, m.d, m.e, m.f], `${w}x${h} ${x} ${y} ${vw} ${vh}`).toEqual(ctm);
    }
  });
  it("gives Chrome's getBoundingClientRect exactly: corners to the border box in double then float32, then the origin in float32", () => {
    for (const [r, [s, , e, f], [left, top], want] of CHROME_CLIENT_RECT) {
      const local = { a: s as number, b: 0, c: 0, d: s as number, e: (e as number) - (left as number), f: (f as number) - (top as number) };
      const rect = shapeClientRect({ x: r[0] as number, y: r[1] as number, width: r[2] as number, height: r[3] as number }, local, { x: left as number, y: top as number });
      expect(rect, JSON.stringify(r)).toEqual(want);
    }
  });
});

describe('the svg fixtures against their committed Chrome captures', () => {
  const runs = SVG.filter((s) => s.kind === 'layout').flatMap((spec) => casesOf(spec, fixtureInput(spec)).map((c) => ({ spec, c })));
  const problems = async (faults: SvgFaults): Promise<string[]> => {
    const out: string[] = [];
    for (const { spec, c } of runs) {
      const { compiled } = compileFixture(spec, undefined, 'enforce', c.environment.direction);
      const p = iosLayoutProjection(compiled, c.environment, c.assignment);
      if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
      const v = validateLayoutInput(JSON.parse(JSON.stringify(p.input)));
      if (!v.ok) throw new Error(`${c.id}: layout input rejected`);
      const r = layoutWithFaults(v.input, measurer(), NO_ENGINE_FAULTS);
      if (r.kind !== 'ok') throw new Error(`${c.id}: ${r.unsupported.detail}`);
      out.push(...compareSvg(await committedAuthored(c), svgScenes(compiled, c.assignment) ?? [], absoluteRects(r.boxes), v.input, faults).map((m) => `${c.id}: ${m}`));
    }
    return out;
  };
  it('every shape of every case equals Chrome as doubles', async () => {
    expect(runs.length).toBe(8);
    expect(await problems(NO_SVG_FAULTS)).toEqual([]);
  });
  it('no SVG shape records inline line fragments: its computed display is inline, but SVG lays it out (capture.ts)', async () => {
    let shapes = 0;
    for (const { c } of runs) {
      const nodes = (await committedAuthored(c)).nodes;
      const shapeIds = new Set(nodes.filter((n) => n.svg !== undefined).map((n) => n.id));
      shapes += shapeIds.size;
      expect(nodes.filter((n) => n.kind === 'line' && shapeIds.has(n.id.replace(/:line\d+$/, ''))).map((n) => n.id), c.id).toEqual([]);
    }
    expect(shapes).toBeGreaterThan(0);
  });
  it('each planted fault fails the differential', async () => {
    for (const k of Object.keys(NO_SVG_FAULTS) as (keyof SvgFaults)[]) {
      expect((await problems({ ...NO_SVG_FAULTS, [k]: true })).length, k).toBeGreaterThan(0);
    }
  });
});
