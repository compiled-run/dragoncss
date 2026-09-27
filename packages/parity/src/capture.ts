// Live capture of a fixture rendering in pinned Chrome: border boxes by data-dragon-id, text boxes by Range, and
// getComputedStyle for every milestone longhand on each element.
import type { Browser } from 'playwright';
import type { Environment } from 'dragon';
import { LONGHANDS } from 'dragon';
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
  /** getComputedStyle values for every longhand in LONGHANDS order; null for text nodes. */
  readonly computed: { readonly [property: string]: string } | null;
};

export type WebCapture = {
  readonly fixture: string;
  readonly chrome: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  readonly nodes: readonly CapturedNode[];
};

export async function captureFixture(browser: Browser, fixture: string, html: string, env: Environment): Promise<WebCapture> {
  const page = await openPage(browser, html, env);
  try {
    const nodes = await page.evaluate((props) => {
      const out: CapturedNode[] = [];
      const blank = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';
      for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
        const id = el.getAttribute('data-dragon-id') as string;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const computed: Record<string, string> = {};
        for (const p of props) computed[p] = cs.getPropertyValue(p);
        out.push({ id, kind: 'element', hasBox: el.getClientRects().length > 0, x: r.x, y: r.y, width: r.width, height: r.height, computed });
        let k = 0;
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType !== Node.TEXT_NODE || blank((child as Text).data)) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          const t = range.getBoundingClientRect();
          out.push({ id: `${id}:text${k++}`, kind: 'text', hasBox: range.getClientRects().length > 0, x: t.x, y: t.y, width: t.width, height: t.height, computed: null });
        }
      }
      return out;
    }, [...LONGHANDS]);
    return {
      fixture,
      chrome: CHROME_VERSION,
      viewport: { width: env.viewport.width, height: env.viewport.height },
      devicePixelRatio: env.devicePixelRatio,
      nodes,
    };
  } finally {
    await page.context().close();
  }
}

/** Stable, byte-for-byte JSON for the committed expected files. */
export function captureJson(c: WebCapture): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}
