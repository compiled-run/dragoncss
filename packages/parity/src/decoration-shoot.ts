// The decoration capture's screenshots (TDEC-a, notes/T148J-tdec.md): a case rendered by CDP Page.captureScreenshot with chrome.ts
// flags at a DPR, checked against the raster rule, and the frames-and-lines guard that the stripped copy lays out as the decorated
// case. Shared by pnpm run parity:decoration-capture and the live skip-ink test (decoration-skip-ink.test.ts).
import type { Browser, Page } from 'playwright';
import type { ParityCase } from './cases.ts';
import { openPage } from './chrome.ts';
import { atDpr } from './dpr.ts';
import { decodePng, rasterSize } from './pixel-reference.ts';

export async function shootDecoration(browser: Browser, html: string, c: ParityCase, dpr: number, prepare: ((page: Page) => Promise<void>) | undefined): Promise<Buffer> {
  const page = await openPage(browser, html, atDpr(c.environment, dpr));
  try {
    if (prepare !== undefined) await prepare(page);
    const cdp = await page.context().newCDPSession(page);
    const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
    const png = Buffer.from(r.data, 'base64');
    const img = decodePng(png);
    const want = rasterSize(c.environment.viewport, dpr);
    if (img.width !== want.width || img.height !== want.height) throw new Error(`${c.id}@${dpr}: ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
    return png;
  } finally {
    await page.context().close();
  }
}

export const layoutFrames = (nodes: readonly { id: string; kind: string; hasBox: boolean; x: number; y: number; width: number; height: number }[]): string =>
  JSON.stringify(nodes.map((n) => [n.id, n.kind, n.hasBox, n.x, n.y, n.width, n.height]));

