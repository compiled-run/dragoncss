// A group Chrome 145 composites in a compositor layer of its own (painted after a composited sticky box on a page that scrolls): its
// layer onto transparent pixels at the alpha byte, then that layer over the page by the compositor (groupCompositeLayered).
import { describe, expect, it } from 'vitest';
import { groupComposite, groupCompositeLayered, opacityAlpha8 } from '../src/index.ts';

const unpack = (v: number): number[] => [v % 256, Math.floor(v / 256) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 16777216) % 256];

// Captured from Chrome 145 at DPR 2 (opacity, fill, page colour, pixel): opaque fills with a 1 px border, painted after a sticky bar.
const CELLS: readonly (readonly [number, readonly number[], readonly number[], readonly number[]])[] = [
  [0.1, [0, 0, 0], [40, 60, 80], [36, 54, 72]],
  [0.33, [12, 34, 56], [40, 60, 80], [30, 51, 72]],
  [0.62549, [200, 20, 200], [40, 60, 80], [140, 35, 155]],
  [0.85, [128, 128, 128], [40, 60, 80], [115, 118, 121]],
  [0.1, [37, 211, 99], [251, 248, 241], [228, 245, 226]],
  [0.5, [250, 120, 10], [251, 248, 241], [250, 184, 125]],
  [0.7, [90, 200, 230], [251, 248, 241], [138, 214, 233]],
  [0.97, [255, 255, 255], [251, 248, 241], [255, 255, 255]],
  [0.25, [0, 0, 0], [255, 255, 255], [191, 191, 191]],
  [0.5, [12, 34, 56], [255, 255, 255], [133, 144, 155]],
  [0.7, [200, 20, 200], [255, 255, 255], [216, 90, 216]],
  [0.97, [128, 128, 128], [255, 255, 255], [132, 132, 132]],
  [0.25, [37, 211, 99], [10, 200, 30], [16, 203, 47]],
  [0.62549, [250, 120, 10], [10, 200, 30], [160, 150, 17]],
  [0.85, [90, 200, 230], [10, 200, 30], [77, 200, 199]],
  [0.1, [255, 255, 255], [40, 60, 80], [62, 80, 98]],
];

describe('groupCompositeLayered', () => {
  it('gives the bytes Chrome drew for a group in a layer of its own, where the one-step composite misses some', () => {
    const got = CELLS.map(([o, c, bg]) => unpack(groupCompositeLayered(c[0] as number, c[1] as number, c[2] as number, 255, bg[0] as number, bg[1] as number, bg[2] as number, 255, opacityAlpha8(o))).slice(0, 3));
    expect(got).toEqual(CELLS.map(([, , , px]) => px));
    const oneStep = CELLS.filter(([o, c, bg, px]) => unpack(groupComposite(c[0] as number, c[1] as number, c[2] as number, 255, bg[0] as number, bg[1] as number, bg[2] as number, 255, opacityAlpha8(o), false)).slice(0, 3).join() !== px.join());
    expect(oneStep.length).toBeGreaterThan(0);
  });
  it('is the layer unchanged over a clear page and the page unchanged under a clear layer', () => {
    expect(unpack(groupCompositeLayered(0, 0, 0, 0, 12, 34, 56, 255, 200))).toEqual([12, 34, 56, 255]);
    expect(unpack(groupCompositeLayered(200, 100, 50, 255, 0, 0, 0, 0, 255))).toEqual([200, 100, 50, 255]);
  });
});
