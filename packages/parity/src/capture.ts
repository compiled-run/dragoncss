// Live capture of the authored fixture in pinned Chrome: border boxes by data-dragon-id, and text boxes by Range.
import type { Browser } from 'playwright';
import { CHROME_VERSION, openPage } from './chrome.ts';

export type CapturedNode = {
  readonly id: string;
  readonly kind: 'element' | 'text';
  /** False when the node generates no box (display: none), so Chrome reports no client rects. */
  readonly hasBox: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type WebCapture = {
  readonly fixture: string;
  readonly chrome: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: 1;
  readonly nodes: readonly CapturedNode[];
};

export async function captureFixture(
  browser: Browser,
  fixture: string,
  html: string,
  viewport: { readonly width: number; readonly height: number },
): Promise<WebCapture> {
  const page = await openPage(browser, html, { width: viewport.width, height: viewport.height });
  try {
    const nodes = await page.evaluate(() => {
      const out: {
        id: string;
        kind: 'element' | 'text';
        hasBox: boolean;
        x: number;
        y: number;
        width: number;
        height: number;
      }[] = [];
      const blank = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';
      for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
        const id = el.getAttribute('data-dragon-id') as string;
        const r = el.getBoundingClientRect();
        out.push({ id, kind: 'element', hasBox: el.getClientRects().length > 0, x: r.x, y: r.y, width: r.width, height: r.height });
        let k = 0;
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType !== Node.TEXT_NODE || blank((child as Text).data)) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          const t = range.getBoundingClientRect();
          out.push({ id: `${id}:text${k++}`, kind: 'text', hasBox: range.getClientRects().length > 0, x: t.x, y: t.y, width: t.width, height: t.height });
        }
      }
      return out;
    });
    return { fixture, chrome: CHROME_VERSION, viewport: { width: viewport.width, height: viewport.height }, devicePixelRatio: 1, nodes };
  } finally {
    await page.context().close();
  }
}

/** Stable, byte-for-byte JSON for the committed expected files. */
export function captureJson(c: WebCapture): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}
