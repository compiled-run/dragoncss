// PNT1-opacity-b: Chrome 145 composites opacity with Skia's 8-bit legacy blends, which paint.ts translates for the device. This
// test draws grids of (colour, colour alpha, backdrop, opacity) in the pinned Chrome and requires every channel of every pixel to
// equal paint.ts's model: a single draw folds the opacity into its paint alpha (foldedAlpha8, then SkPMSrcOver), and a group of
// two or more draws composites its layer with SkBlendARGB32 (groupBlend8). The naive float blend round(s * a + d * (1 - a)) must
// disagree, so the grid is fine enough to tell the models apart.
import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { foldedAlpha8, groupBlend8, mulDiv255Round, opacityAlpha8, srcOver8 } from '@dragon/layout';

const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;

const OPACITIES = [0.01, 0.1, 0.28, 0.3, 0.45, 0.46, 0.5, 0.6, 0.7, 0.9, 0.99];
const COLOR_ALPHAS = [1, 0.04, 0.2, 0.5, 0.8];
const N = 16;
const v = (i: number): number => i * 17;
const CELL = 4;
const BLOCK = N * CELL + 8;
const PER_ROW = 10;

type Mode = 'fold' | 'group';
type Cell = { readonly mode: Mode; readonly opacity: number; readonly alpha: number; readonly s: number[]; readonly s2: number[]; readonly d: number[]; readonly x: number; readonly y: number; readonly y2: number };

function page(): { html: string; cells: Cell[]; width: number; height: number } {
  const cells: Cell[] = [];
  let html = '<!DOCTYPE html><html><head><style>body{margin:0}.b{position:absolute}.c{width:4px;height:4px;float:left}.k{width:4px;height:4px}.h{width:4px;height:2px}</style></head><body>';
  let block = 0;
  for (const mode of ['fold', 'group'] as const)
    for (const opacity of OPACITIES)
      for (const alpha of COLOR_ALPHAS) {
        const bx = (block % PER_ROW) * BLOCK;
        const by = Math.floor(block / PER_ROW) * BLOCK;
        block++;
        html += `<div class="b" style="left:${bx}px;top:${by}px;width:${N * CELL}px">`;
        for (let j = 0; j < N; j++)
          for (let i = 0; i < N; i++) {
            const s = [v(i), v(j), v((i * 7 + j * 3) % 16)];
            const d = [v(j), v(i), v((i * 5 + j * 11 + 3) % 16)];
            const s2 = [v((i * 3 + j) % 16), v((j * 5 + 2) % 16), v((i + j * 9) % 16)];
            const rgba = (c: number[]): string => (alpha === 1 ? `rgb(${c.join(',')})` : `rgba(${c.join(',')},${alpha})`);
            const inner =
              mode === 'fold'
                ? `<div class="k" style="background:${rgba(s)};opacity:${opacity}"></div>`
                : `<div class="k" style="opacity:${opacity}"><div class="h" style="background:${rgba(s)}"></div><div class="h" style="background:${rgba(s2)}"></div></div>`;
            html += `<div class="c" style="background:rgb(${d.join(',')})">${inner}</div>`;
            cells.push({ mode, opacity, alpha, s, s2, d, x: bx + i * CELL + 1, y: by + j * CELL, y2: by + j * CELL + 3 });
          }
        html += '</div>';
      }
  html += '</body></html>';
  return { html, cells, width: PER_ROW * BLOCK, height: Math.ceil(block / PER_ROW) * BLOCK };
}

/** paint.ts's model of one channel: the colour c of alpha `alpha`, drawn alone (fold) or in a group, at `opacity` over d. */
function model(mode: Mode, c: number, alpha: number, d: number, opacity: number): number {
  if (mode === 'fold') {
    const a = foldedAlpha8(opacityAlpha8(alpha), opacity);
    return srcOver8(mulDiv255Round(c, a), a, d);
  }
  const ca = opacityAlpha8(alpha);
  return groupBlend8(mulDiv255Round(c, ca), ca, d, opacityAlpha8(opacity));
}

const naive = (c: number, alpha: number, d: number, opacity: number): number => Math.round(c * alpha * opacity + d * (1 - alpha * opacity));

describe('opacity blends match Chrome 145 (PNT1-opacity-b)', () => {
  it('every channel of every folded and grouped translucent pixel equals paint.ts, and the naive float blend does not', async () => {
    const { launchChrome, openPage } = await load<{ launchChrome: (dpr?: number) => Promise<Browser>; openPage: (b: Browser, html: string, env: object) => Promise<import('playwright').Page> }>('chrome.ts');
    const { decodePng } = await load<{ decodePng: (b: Uint8Array) => { width: number; data: Uint8Array } }>('pixel-reference.ts');
    const { html, cells, width, height } = page();
    const browser = await launchChrome();
    try {
      const p = await openPage(browser, html, { viewport: { width, height }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' });
      const img = decodePng(await p.screenshot({ fullPage: true }));
      const px = (x: number, y: number, k: number): number => img.data[(y * img.width + x) * 4 + k] as number;
      const misses: string[] = [];
      let naiveMisses = 0;
      let checked = 0;
      for (const c of cells)
        for (const [src, y] of c.mode === 'fold' ? ([[c.s, c.y]] as const) : ([[c.s, c.y], [c.s2, c.y2]] as const))
          for (let k = 0; k < 3; k++) {
            const chrome = px(c.x, y, k);
            const want = model(c.mode, src[k] as number, c.alpha, c.d[k] as number, c.opacity);
            checked++;
            if (want !== chrome) misses.push(`${c.mode} opacity ${c.opacity} alpha ${c.alpha} c ${src[k]} d ${c.d[k]}: Chrome ${chrome}, paint.ts ${want}`);
            if (naive(src[k] as number, c.alpha, c.d[k] as number, c.opacity) !== chrome) naiveMisses++;
          }
      expect(checked).toBe(2 * OPACITIES.length * COLOR_ALPHAS.length * N * N * 3 * 1.5);
      expect(misses.slice(0, 20)).toEqual([]);
      expect(naiveMisses).toBeGreaterThan(checked / 20);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
