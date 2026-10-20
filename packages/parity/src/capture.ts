// Live capture of a fixture rendering in pinned Chrome: border boxes by data-dragon-id, text boxes by Range, and
// getComputedStyle for every milestone longhand on each element. Each text node "<element>:text<k>" (k counts text nodes
// that are not whitespace-only) is its Range bounding rect, followed by one "<text>:line<j>" node per Range client rect: one
// per line the text shows on, in order. A whitespace-only text node is "<element>:space<k>" and is recorded only when it has
// client rects.
import type { Browser, Page } from 'playwright';
import type { Environment } from 'dragon';
import { LONGHANDS } from 'dragon';
import { CHROME_VERSION, injectHarness, launchArgsOf, openPage } from './chrome.ts';
import { type MemoStats, memoizedJson } from './chrome-memo.ts';
import { BROWSER_FLAVOUR, hostPlatform } from './platform.ts';
import { applyTransformTwin } from './transform-capture.ts';
import { capturePseudoElements, NO_PSEUDO_CAPTURE_FAULTS, pageHasGeneratedContent } from './pseudo-capture.ts';
import type { PseudoCaptureFaults } from './pseudo-capture.ts';

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
  /** SVG-a1: an SVG shape's getBBox [x, y, width, height] and getScreenCTM [a, b, c, d, e, f]; absent on every other node. */
  readonly svg?: { readonly bbox: readonly number[]; readonly ctm: readonly number[] };
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
    const shape = el.namespaceURI === 'http://www.w3.org/2000/svg' && el.localName !== 'svg' ? (el as unknown as SVGGraphicsElement) : null;
    const box = shape === null ? null : shape.getBBox();
    const m = shape === null ? null : shape.getScreenCTM();
    const svg = box === null || m === null ? {} : { svg: { bbox: [box.x, box.y, box.width, box.height], ctm: [m.a, m.b, m.c, m.d, m.e, m.f] } };
    out.push({ id, kind: 'element', hasBox: el.getClientRects().length > 0, x: r.x, y: r.y, width: r.width, height: r.height, computed, ...svg });
    // INL1a: an inline box's fragments, one "<id>:line<j>" per client rect (one per line it is on); a <br> has none. A culled
    // box (no box fragment of its own) also lists the zero-width piece of a <br> inside it beside that line's rect, and only in
    // the first layout (INL-P open question 1), so a zero-width <br> piece with another rect on its line is left out.
    // An SVG element is never a CSS inline box: an <svg> is a replaced element (an atomic inline at most) and a shape inside it
    // is laid out by SVG, not by inline formatting, though its computed display is 'inline' (Chrome's LayoutSVGShape).
    if (cs.display === 'inline' && el.tagName !== 'BR' && el.namespaceURI !== 'http://www.w3.org/2000/svg') {
      const rects = Array.from(el.getClientRects());
      const brPieces = Array.from(el.querySelectorAll('br')).flatMap((b) => Array.from(b.getClientRects()));
      const extraBrPiece = (f: DOMRect): boolean =>
        f.width === 0 && brPieces.some((b) => b.x === f.x && b.y === f.y && b.height === f.height) && rects.some((o) => o !== f && o.y === f.y && o.height === f.height);
      rects.filter((f) => !extraBrPiece(f)).forEach((f, j) => out.push({ id: `${id}:line${j}`, kind: 'line', hasBox: true, x: f.x, y: f.y, width: f.width, height: f.height, computed: null }));
    }
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
export async function captureFixture(browser: Browser, fixture: string, html: string, env: Environment, extra: readonly string[] = [], prepare?: (page: Page) => Promise<void>, faults: PseudoCaptureFaults = NO_PSEUDO_CAPTURE_FAULTS): Promise<WebCapture> {
  // A prepare script is code the memo key cannot see, and a browser launchChrome did not start has flags it cannot see.
  const args = launchArgsOf(browser);
  // A planted pseudo-capture fault changes the capture without changing the page, so it is never remembered.
  if (prepare !== undefined || args === null || faults !== NO_PSEUDO_CAPTURE_FAULTS) return captureFixtureLive(browser, fixture, html, env, extra, prepare, faults);
  const parts = { html: injectHarness(html, env), env, args, properties: [...LONGHANDS, ...extra], flavour: BROWSER_FLAVOUR };
  const nodes = await memoizedJson('capture', parts, CAPTURE_CODE, CAPTURE_MEMO, async () => (await captureFixtureLive(browser, fixture, html, env, extra)).nodes);
  return captureOf(fixture, env, nodes);
}

/** The code that decides a capture's nodes beside the page itself: the page setup, the in-page collector and the transform twin. */
const CAPTURE_CODE = ['packages/parity/src/capture.ts', 'packages/parity/src/chrome.ts', 'packages/parity/src/transform-capture.ts', 'packages/parity/src/pseudo-capture.ts'];
/** Remembered and fresh captures of this process (chrome-memo.ts). */
export const CAPTURE_MEMO: MemoStats = { hits: 0, misses: 0 };

const captureOf = (fixture: string, env: Environment, nodes: readonly CapturedNode[]): WebCapture => ({
  fixture,
  chrome: CHROME_VERSION,
  browser: BROWSER_FLAVOUR,
  platform: hostPlatform(),
  viewport: { width: env.viewport.width, height: env.viewport.height },
  devicePixelRatio: env.devicePixelRatio,
  direction: env.direction,
  nodes,
});

async function captureFixtureLive(browser: Browser, fixture: string, html: string, env: Environment, extra: readonly string[] = [], prepare?: (page: Page) => Promise<void>, faults: PseudoCaptureFaults = NO_PSEUDO_CAPTURE_FAULTS): Promise<WebCapture> {
  const page = await openPage(browser, html, env);
  try {
    if (prepare !== undefined) await prepare(page);
    // PNT2 case-kind registration (RT-13 style): a page with a transformed element is captured through the transform twin.
    const twin = await applyTransformTwin(page, [...LONGHANDS, ...extra]);
    const nodes = await page.evaluate(collectNodes, [...LONGHANDS, ...extra]);
    // GEN-a R9: the ::before and ::after boxes and their text, through CDP; a page without one opens no CDP session.
    if (await pageHasGeneratedContent(page)) {
      if (twin !== null) throw new Error(`${fixture}: a page with a transformed element and a generated box is not captured (the transform twin restyles the page)`);
      nodes.push(...(await capturePseudoElements(page, [...LONGHANDS, ...extra], faults)));
    }
    if (twin !== null) {
      for (const [i, n] of nodes.entries()) {
        if (n.kind !== 'element') continue;
        const computed = twin.get(n.id);
        if (computed === undefined) throw new Error(`${fixture}: the transform twin read no computed values for ${n.id}`);
        nodes[i] = { ...n, computed };
      }
    }
    const parts = await captureRangeParts(page, [...LONGHANDS, ...extra]);
    return captureOf(fixture, env, parts.size === 0 ? nodes : nodes.flatMap((n) => [n, ...(parts.get(n.id) ?? [])]));
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
        } catch (e) {
          // DOM.getBoxModel fails for a node that generates no box (display: none); any other failure is an error.
          if (!String(e).includes('Could not compute box model')) throw e;
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
    await child.setContent(injectHarness(html, env));
    const failed = await child.evaluate(async (qs: string[]) => {
      await document.fonts.load('10px Ahem');
      await document.fonts.ready;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      return qs.filter((q) => !matchMedia(q).matches);
    }, [...checks]);
    if (failed.length > 0) throw new Error(`${fixture}: the ${frame.widthPx}x${frame.heightPx} device px frame at zoom ${frame.zoom} fails ${failed.join(', ')}`);
    const dpr = await child.evaluate(() => window.devicePixelRatio);
    if (dpr !== frame.zoom) throw new Error(`${fixture}: the frame's device pixel ratio is ${dpr}, not ${frame.zoom}`);
    if (await child.evaluate(() => Array.from(document.querySelectorAll('*')).some((el) => ['::before', '::after'].some((p) => getComputedStyle(el, p).content !== 'none')))) {
      throw new Error(`${fixture}: a zoomed frame with a generated box is not captured (GEN-a R9 reads generated boxes through the page's CDP session)`);
    }
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
