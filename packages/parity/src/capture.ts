// Live capture of a fixture rendering in pinned Chrome: border boxes by data-dragon-id, text boxes by Range, and
// getComputedStyle for every milestone longhand on each element. Each text node "<element>:text<k>" (k counts text nodes
// that are not whitespace-only) is its Range bounding rect, followed by one "<text>:line<j>" node per Range client rect: one
// per line the text shows on, in order. A whitespace-only text node is "<element>:space<k>" and is recorded only when it has
// client rects.
import type { Browser, Page } from 'playwright';
import type { Environment } from 'dragon';
import { LONGHANDS } from 'dragon';
import { CHROME_VERSION, harnessStyle, openPage } from './chrome.ts';
import { BROWSER_FLAVOUR, hostPlatform } from './platform.ts';

export type CapturedNode = {
  readonly id: string;
  readonly kind: 'element' | 'text' | 'line';
  /** False when the node generates no box (display: none), so Chrome reports no client rects. */
  readonly hasBox: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** getComputedStyle values for every longhand in LONGHANDS order, then the case's extra properties; null for text nodes. */
  readonly computed: { readonly [property: string]: string } | null;
};

export type WebCapture = {
  readonly fixture: string;
  readonly chrome: string;
  /** The Playwright browser build and the capture platform (process.platform-process.arch). */
  readonly browser: string;
  readonly platform: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly devicePixelRatio: number;
  /** The environment direction the harness gave the document (docs/api.md §7). */
  readonly direction: 'ltr' | 'rtl';
  readonly nodes: readonly CapturedNode[];
};

/** Runs in the page: every data-dragon-id element's box and computed values, and its text and line boxes. */
const collectNodes = (props: string[]): CapturedNode[] => {
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
    let spaces = 0;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      const rects = Array.from(range.getClientRects());
      const isBlank = blank((child as Text).data);
      const textId = isBlank ? `${id}:space${spaces++}` : `${id}:text${k++}`;
      if (isBlank && rects.length === 0) continue;
      const t = range.getBoundingClientRect();
      out.push({ id: textId, kind: 'text', hasBox: rects.length > 0, x: t.x, y: t.y, width: t.width, height: t.height, computed: null });
      rects.forEach((r, j) => out.push({ id: `${textId}:line${j}`, kind: 'line', hasBox: true, x: r.x, y: r.y, width: r.width, height: r.height, computed: null }));
    }
  }
  return out;
};

/**
 * extra: properties captured after LONGHANDS (a fixture's computedExtra); none for every fixture that predates them. prepare: a
 * fixture's stated-reference transform (font-reference.ts), run on the loaded page before the capture; none for every other fixture.
 */
export async function captureFixture(browser: Browser, fixture: string, html: string, env: Environment, extra: readonly string[] = [], prepare?: (page: Page) => Promise<void>): Promise<WebCapture> {
  const page = await openPage(browser, html, env);
  try {
    if (prepare !== undefined) await prepare(page);
    const nodes = await page.evaluate(collectNodes, [...LONGHANDS, ...extra]);
    return {
      fixture,
      chrome: CHROME_VERSION,
      browser: BROWSER_FLAVOUR,
      platform: hostPlatform(),
      viewport: { width: env.viewport.width, height: env.viewport.height },
      devicePixelRatio: env.devicePixelRatio,
      direction: env.direction,
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

/** MQ-R0: an iframe of exact device px at a zoom, where Chrome's media size is px / zoom (the zoom acts as the frame's DPR). */
export type ZoomedFrame = { readonly widthPx: number; readonly heightPx: number; readonly zoom: number };

/**
 * captureFixture inside an iframe of exact device px on a DPR 1 page, so the fixture sees a fractional media size. checks are
 * media queries that must match inside the frame (the caller proves the frame's size and band with them).
 */
export async function captureFixtureInFrame(browser: Browser, fixture: string, html: string, env: Environment, frame: ZoomedFrame, checks: readonly string[]): Promise<WebCapture> {
  if (env.devicePixelRatio !== 1) throw new Error(`a zoomed frame runs on a DPR 1 page, not ${env.devicePixelRatio}`);
  const css = (px: number): number => px / frame.zoom;
  const host = `<!DOCTYPE html><html><head></head><body style="margin:0"><iframe style="border:0;display:block;width:${css(frame.widthPx)}px;height:${css(frame.heightPx)}px;zoom:${frame.zoom}"></iframe></body></html>`;
  const page = await openPage(browser, host, { ...env, viewport: { width: Math.ceil(env.viewport.width), height: Math.ceil(env.viewport.height) } });
  try {
    const handle = await page.waitForSelector('iframe', { state: 'attached' });
    const child = await handle.contentFrame();
    if (child === null) throw new Error(`${fixture}: no iframe document`);
    const injected = html.replace(/<head>/i, `<head><style data-dragon-harness>${harnessStyle(env)}</style>`);
    if (injected === html) throw new Error('fixture HTML has no <head>');
    await child.setContent(injected);
    const failed = await child.evaluate(async (qs: string[]) => {
      await document.fonts.load('10px Ahem');
      await document.fonts.ready;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      return qs.filter((q) => !matchMedia(q).matches);
    }, [...checks]);
    if (failed.length > 0) throw new Error(`${fixture}: the ${frame.widthPx}x${frame.heightPx} device px frame at zoom ${frame.zoom} fails ${failed.join(', ')}`);
    const dpr = await child.evaluate(() => window.devicePixelRatio);
    if (dpr !== frame.zoom) throw new Error(`${fixture}: the frame's device pixel ratio is ${dpr}, not ${frame.zoom}`);
    const nodes = await child.evaluate(collectNodes, [...LONGHANDS]);
    return {
      fixture,
      chrome: CHROME_VERSION,
      browser: BROWSER_FLAVOUR,
      platform: hostPlatform(),
      viewport: { width: env.viewport.width, height: env.viewport.height },
      devicePixelRatio: frame.zoom,
      direction: env.direction,
      nodes,
    };
  } finally {
    await page.context().close();
  }
}
