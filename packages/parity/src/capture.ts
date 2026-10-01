// Live capture of a fixture rendering in pinned Chrome: border boxes by data-dragon-id, text boxes by Range, and
// getComputedStyle for every milestone longhand on each element. Each text node "<element>:text<k>" (k counts text nodes
// that are not whitespace-only) is its Range bounding rect, followed by one "<text>:line<j>" node per Range client rect: one
// per line the text shows on, in order. A whitespace-only text node is "<element>:space<k>" and is recorded only when it has
// client rects.
import type { Browser, Page } from 'playwright';
import type { Environment } from 'dragon';
import { LONGHANDS } from 'dragon';
import { CHROME_VERSION, openPage } from './chrome.ts';
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

/**
 * extra: properties captured after LONGHANDS (a fixture's computedExtra); none for every fixture that predates them. prepare: a
 * fixture's stated-reference transform (font-reference.ts), run on the loaded page before the capture; none for every other fixture.
 */
export async function captureFixture(browser: Browser, fixture: string, html: string, env: Environment, extra: readonly string[] = [], prepare?: (page: Page) => Promise<void>): Promise<WebCapture> {
  const page = await openPage(browser, html, env);
  try {
    if (prepare !== undefined) await prepare(page);
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
    }, [...LONGHANDS, ...extra]);
    const parts = await captureRangeParts(page, [...LONGHANDS, ...extra]);
    return {
      fixture,
      chrome: CHROME_VERSION,
      browser: BROWSER_FLAVOUR,
      platform: hostPlatform(),
      viewport: { width: env.viewport.width, height: env.viewport.height },
      devicePixelRatio: env.devicePixelRatio,
      direction: env.direction,
      nodes: parts.size === 0 ? nodes : nodes.flatMap((n) => [n, ...(parts.get(n.id) ?? [])]),
    };
  } finally {
    await page.context().close();
  }
}

type DomNode = { readonly nodeId: number; readonly nodeName: string; readonly attributes?: readonly string[]; readonly children?: readonly DomNode[]; readonly shadowRoots?: readonly DomNode[] };

/**
 * FORM-a A4: the UA shadow parts of every input[type=range] with a data-dragon-id, as element nodes "<id>::container",
 * "<id>::track" and "<id>::thumb" after the input: their border boxes from DOM.getBoxModel and their computed values from
 * CSS.getComputedStyleForNode, through CDP with pierce (FORM-0, scripts/capture-form-data.ts). Script cannot reach a UA shadow
 * root. A page without a range input opens no CDP session, so every earlier capture is unchanged.
 */
async function captureRangeParts(page: Page, props: readonly string[]): Promise<Map<string, CapturedNode[]>> {
  const out = new Map<string, CapturedNode[]>();
  const count = await page.evaluate(() => document.querySelectorAll('input[type="range" i][data-dragon-id]').length);
  if (count === 0) return out;
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const doc = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const inputs: { id: string; node: DomNode }[] = [];
    const walk = (n: DomNode): void => {
      const attrs = n.attributes ?? [];
      const at = (name: string): string | undefined => {
        for (let k = 0; k + 1 < attrs.length; k += 2) if (attrs[k] === name) return attrs[k + 1];
        return undefined;
      };
      const id = at('data-dragon-id');
      if (n.nodeName === 'INPUT' && id !== undefined && at('type')?.toLowerCase() === 'range') inputs.push({ id, node: n });
      for (const c of n.children ?? []) walk(c);
    };
    walk(doc.root);
    if (inputs.length !== count) throw new Error(`the pierced document holds ${inputs.length} range inputs with a data-dragon-id, the page ${count}`);
    for (const { id, node } of inputs) {
      const container = node.shadowRoots?.[0]?.children?.[0];
      const track = container?.children?.[0];
      const thumb = track?.children?.[0];
      if (container === undefined || track === undefined || thumb === undefined) throw new Error(`${id}: CDP exposed no user-agent shadow container, track and thumb`);
      const nodes: CapturedNode[] = [];
      for (const [part, n] of [['container', container], ['track', track], ['thumb', thumb]] as const) {
        const style = (await cdp.send('CSS.getComputedStyleForNode', { nodeId: n.nodeId })) as { computedStyle: { name: string; value: string }[] };
        const byName = new Map(style.computedStyle.map((e) => [e.name, e.value]));
        const computed: Record<string, string> = {};
        for (const p of props) {
          const v = byName.get(p);
          if (v === undefined) throw new Error(`${id}::${part}: CDP gave no computed ${p}`);
          computed[p] = v;
        }
        let box: number[] | null = null;
        try {
          box = ((await cdp.send('DOM.getBoxModel', { nodeId: n.nodeId })) as { model: { border: number[] } }).model.border;
        } catch {
          // DOM.getBoxModel fails for a node that generates no box (display: none).
        }
        const [x1, y1, , , x3, y3] = box ?? [0, 0, 0, 0, 0, 0];
        nodes.push({ id: `${id}::${part}`, kind: 'element', hasBox: box !== null, x: x1 as number, y: y1 as number, width: (x3 as number) - (x1 as number), height: (y3 as number) - (y1 as number), computed });
      }
      out.set(id, nodes);
    }
  } finally {
    await cdp.detach();
  }
  return out;
}

/** Stable, byte-for-byte JSON for the committed expected files. */
export function captureJson(c: WebCapture): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}
