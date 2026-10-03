// BG2 R4 (notes/T074-bg2-spec.md): the composited layer each gradient box rasters in, which starts the cc tiles, the dither and
// the shader matrix, is the one the compiler predicts. Every gradient case opens in Chrome 145 at DPR 2; CDP LayerTree lists the
// composited layers with the DOM node each paints for. The compiler puts every box Dragon draws in the root scroller's layer
// (gradientLayerOf, origin 0, 0, in the write), so no gradient box may own a layer of its own, and the root layer must start at the
// page origin. The planted prediction (each box in a layer of its own) must be caught.
import type { CDPSession, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { launchChrome, openPage } from '../src/chrome.ts';
import { atDpr } from '../src/dpr.ts';
import { BACKEND_OF, nativeCases } from '../src/native-host.ts';

type Layer = { readonly layerId: string; readonly parentLayerId?: string; readonly backendNodeId?: number; readonly offsetX: number; readonly offsetY: number; readonly drawsContent: boolean };
type Prediction = { readonly id: string; readonly origin: readonly [number, number] };

/** The composited layers of the page once LayerTree has reported them; two frames make Chrome commit, and 20 s without a report fails. */
async function layers(cdp: CDPSession, page: Page): Promise<readonly Layer[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const got = new Promise<readonly Layer[]>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('LayerTree reported no layers within 20 s')), 20_000);
    cdp.on('LayerTree.layerTreeDidChange', (e: { layers?: Layer[] }) => {
      if (e.layers !== undefined && e.layers.length > 0) resolve(e.layers);
    });
  });
  await cdp.send('LayerTree.enable');
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  try {
    return await got;
  } finally {
    clearTimeout(timer);
  }
}

/** The problems of a page's layers against the predictions: a gradient box in a layer of its own, or a root layer off the origin. */
export function layerProblems(found: readonly Layer[], nodeOf: ReadonlyMap<string, number>, predictions: readonly Prediction[]): string[] {
  const problems: string[] = [];
  const root = found.find((l) => l.parentLayerId === undefined);
  if (root === undefined) return ['no root layer'];
  for (const p of predictions) {
    const node = nodeOf.get(p.id);
    if (node === undefined) {
      problems.push(`${p.id}: no DOM node`);
      continue;
    }
    const own = found.find((l) => l.backendNodeId === node && l.drawsContent);
    if (p.origin[0] === 0 && p.origin[1] === 0) {
      if (own !== undefined) problems.push(`${p.id}: Chrome gives it a layer of its own at ${own.offsetX}, ${own.offsetY}; the compiler predicts the root layer`);
    } else if (own === undefined || own.offsetX !== p.origin[0] || own.offsetY !== p.origin[1]) problems.push(`${p.id}: the compiler predicts a layer at ${p.origin.join(', ')}, Chrome has ${own === undefined ? 'none' : `${own.offsetX}, ${own.offsetY}`}`);
  }
  if (root.offsetX !== 0 || root.offsetY !== 0) problems.push(`the root layer starts at ${root.offsetX}, ${root.offsetY}`);
  return problems;
}

describe('BG2 R4: each gradient box rasters in the layer the compiler predicts (CDP LayerTree, Chrome 145 at DPR 2)', () => {
  const cases = nativeCases().filter((n) => n.programs[BACKEND_OF.android].nodes.some((node) => node.writes.some((w) => w.kind === 'background-layers')));
  it('opens every gradient case and finds no gradient box composited apart from the root layer', async () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    const browser = await launchChrome(2);
    let boxes = 0;
    try {
      for (const n of cases) {
        const page = await openPage(browser, n.case.authoredHtml, atDpr(n.case.environment, 2));
        try {
          const cdp = await page.context().newCDPSession(page);
          const found = await layers(cdp, page);
          const predictions = n.programs[BACKEND_OF.android].nodes.flatMap((node) => node.writes.filter((w) => w.kind === 'background-layers').map((w) => ({ id: node.id, origin: (w as unknown as { layerOrigin: readonly [number, number] }).layerOrigin })));
          const nodeOf = new Map<string, number>();
          const doc = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: { nodeId: number } };
          for (const p of predictions) {
            const q = (await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: `[data-dragon-id="${p.id}"]` })) as { nodeId: number };
            if (q.nodeId === 0) continue;
            const d = (await cdp.send('DOM.describeNode', { nodeId: q.nodeId })) as { node: { backendNodeId: number } };
            nodeOf.set(p.id, d.node.backendNodeId);
          }
          boxes += predictions.length;
          expect(layerProblems(found, nodeOf, predictions), n.case.id).toEqual([]);
          // The plant: predicting each box in a layer of its own at its page origin must be caught.
          if (predictions.length > 0) expect(layerProblems(found, nodeOf, predictions.map((p) => ({ ...p, origin: [1, 1] as const }))).length, `${n.case.id} plant`).toBeGreaterThan(0);
        } finally {
          await page.context().close();
        }
      }
    } finally {
      await browser.close();
    }
    console.log(`bg2-layers: ${cases.length} cases, ${boxes} gradient boxes, all in the root layer as predicted`);
    expect(boxes).toBeGreaterThan(50);
  }, 1_800_000);
  it('reports a box Chrome composites apart from a root prediction', () => {
    const found: Layer[] = [{ layerId: 'r', offsetX: 0, offsetY: 0, drawsContent: true }, { layerId: 'a', parentLayerId: 'r', backendNodeId: 7, offsetX: 10, offsetY: 4, drawsContent: true }];
    expect(layerProblems(found, new Map([['box', 7]]), [{ id: 'box', origin: [0, 0] }])).toEqual(['box: Chrome gives it a layer of its own at 10, 4; the compiler predicts the root layer']);
    expect(layerProblems(found, new Map([['box', 7]]), [{ id: 'box', origin: [10, 4] }])).toEqual([]);
    expect(layerProblems(found, new Map([['other', 8]]), [{ id: 'other', origin: [0, 0] }])).toEqual([]);
  });
});
