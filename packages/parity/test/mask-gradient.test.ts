// MASK-CLIP gradient masks against Chrome 145 (dragon analysis/mask.ts, lower/paint/gradient.ts): Chrome paints a gradient
// mask-image as one border-box fill layer whose alpha is the translated paint-gradient.ts raster's, byte for byte, at every device
// scale and on a box at fractional px, and its DstIn keeps the box's pixel times that alpha byte / 255, rounded. Over a canvas
// whose every channel is 0 or 255 the composite is then whole numbers, which the native compositors reach too, at every pixel of
// the page; over another colour Chrome's 8-bit blend is one off that in a channel, which is why the native targets refuse it.
import { describe, expect, it } from 'vitest';
import type { GradientImage, StopColor } from '@dragon/layout';
import { backgroundRow, NO_GRADIENT_FAULTS, planBackground, referenceTileSize } from '@dragon/layout';
import { launchChrome } from '../src/chrome.ts';
import { decodePng } from '../src/pixel-reference.ts';

const ZERO = { unit: 'percent' as const, value: 0 };
const BASE: Omit<GradientImage, 'stops'> = { radial: false, repeating: false, direction: 'default', angleDeg: 180, slope: 0, sideX: 'none', sideY: 'none', circle: false, extent: 'farthest-corner', radiusX: { unit: 'px', value: 0 }, radiusY: { unit: 'px', value: 0 }, centerX: { unit: 'percent', value: 50 }, centerY: { unit: 'percent', value: 50 } };
const black = (alpha: number): StopColor => ({ r: 0, g: 0, b: 0, alpha });
const stop = (alpha: number, unit: 'auto' | 'percent' = 'auto', value = 0) => ({ color: black(alpha), unit, value });

/** Each mask and its gradient as the lowering hands it to the engine. */
const MASKS: readonly { readonly css: string; readonly image: GradientImage }[] = [
  { css: 'linear-gradient(black, transparent)', image: { ...BASE, stops: [stop(255), stop(0)] } },
  { css: 'radial-gradient(black, transparent)', image: { ...BASE, radial: true, stops: [stop(255), stop(0)] } },
  { css: 'linear-gradient(to right, black 20%, rgba(0, 0, 0, 0.5) 50%, transparent)', image: { ...BASE, direction: 'side', sideX: 'right', stops: [stop(255, 'percent', 20), stop(128, 'percent', 50), stop(0)] } },
];

const BOX = { left: 10.3, top: 9.6, width: 120.7, height: 80.45 };
const COLOR = [200, 40, 60] as const;

/** Pixels of the page where Chrome differs from the box colour times the raster alpha, rounded, over the canvas colour (and their count). */
async function mismatches(dpr: number, canvas: readonly [number, number, number]): Promise<{ readonly bad: number; readonly total: number; readonly first: string[] }> {
  const browser = await launchChrome(dpr);
  try {
    const page = await browser.newPage({ viewport: { width: 300, height: 200 }, deviceScaleFactor: dpr });
    let bad = 0;
    let total = 0;
    const first: string[] = [];
    for (const m of MASKS) {
      await page.setContent(`<!doctype html><style>html, body { margin: 0; background: rgb(${canvas.join(', ')}); } div { position: absolute; left: ${BOX.left}px; top: ${BOX.top}px; width: ${BOX.width}px; height: ${BOX.height}px; background: rgb(${COLOR.join(', ')}); mask-image: ${m.css}; }</style><div></div>`);
      const shot = decodePng(await page.screenshot());
      const lu = (v: number): number => Math.round(v * dpr * 64);
      const plan = planBackground({ box: { x: lu(BOX.left), y: lu(BOX.top), width: lu(BOX.width), height: lu(BOX.height), borders: [0, 0, 0, 0], padding: [0, 0, 0, 0], obscures: [false, false, false, false] }, color: black(0), colorClip: 'border-box', layers: [{ geometry: { sizeKind: 'length', sizeX: { unit: 'auto', value: 0 }, sizeY: { unit: 'auto', value: 0 }, positionX: ZERO, positionY: ZERO, repeatX: 'repeat', repeatY: 'repeat', origin: 'border-box', clip: 'border-box' }, image: m.image }], lastIsBottom: true, zoom: dpr, tileSize: referenceTileSize(dpr), layerX: 0, layerY: 0 }, NO_GRADIENT_FAULTS);
      expect(plan.modelled).toBe(true);
      for (let y = 0; y < shot.height; y++) {
        const row = y >= plan.top && y < plan.bottom ? backgroundRow(plan, y, NO_GRADIENT_FAULTS) : null;
        for (let x = 0; x < shot.width; x++) {
          const alpha = row === null || x < plan.left || x >= plan.right ? 0 : (row[(x - plan.left) * 4 + 3] as number);
          const want = COLOR.map((c, k) => Math.round((Math.round((c * alpha) / 255) * 255 + (canvas[k] as number) * (255 - alpha)) / 255));
          const i = (y * shot.width + x) * 4;
          const got = [shot.data[i], shot.data[i + 1], shot.data[i + 2]];
          total++;
          if (want.join() !== got.join()) {
            bad++;
            if (first.length < 3) first.push(`${m.css} ${dpr}x (${x}, ${y}): alpha ${alpha}, want ${want.join()}, Chrome ${got.join()}`);
          }
        }
      }
    }
    return { bad, total, first };
  } finally {
    await browser.close();
  }
}

describe('gradient masks in Chrome 145', () => {
  for (const dpr of [1, 2, 3]) {
    it(`keep the box's pixel times the raster's alpha over a white or black canvas, at every pixel, at ${dpr}x`, async () => {
      for (const canvas of [[255, 255, 255], [0, 0, 0], [255, 0, 255]] as const) {
        const r = await mismatches(dpr, canvas);
        expect(r.total).toBeGreaterThan(0);
        expect(r.first, canvas.join()).toEqual([]);
      }
    }, 120000);
  }
  it('blend over another canvas colour one off the rounded composite, which the native targets therefore refuse', async () => {
    const r = await mismatches(2, [30, 120, 201]);
    expect(r.bad).toBeGreaterThan(r.total / 50);
  }, 120000);
});
