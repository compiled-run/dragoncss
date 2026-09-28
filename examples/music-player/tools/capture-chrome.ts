// Chrome reference of the north-star screen: pinned Chrome (Playwright 1.58.2, chromium-1208, the parity lane's flags with
// --force-device-scale-factor=N and the lane's zoom guard), an iPhone-like and an Android-like mobile viewport, every screen
// state. Writes examples/music-player/chrome/<device>/<state>.png (viewport at scroll 0), <state>-bottom.png (viewport scrolled
// to the end) and <state>.boxes.json (per element: getBoundingClientRect, text line rects, computed values of the used
// properties). Network is closed: styles.css is served from disk, the four YouTube covers by a same-size stand-in.
//   node --conditions=dragon-internal examples/music-player/tools/capture-chrome.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { CHROME_VERSION, chromeArgsAt, launchChrome, PLAYWRIGHT_VERSION } from '../../../packages/parity/src/chrome.ts';
import { zoomGuard } from '../../../packages/parity/src/dpr.ts';
import type { StateId } from './snapshot.ts';
import { coverStandIn, examplePath, readSnapshot, STATES, stateHtml } from './snapshot.ts';
import { usedProperties } from './css-inventory.ts';

// Playwright's types come through the parity package's launcher; the example has no node_modules of its own.
type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;

export const DEVICES = [
  { id: 'iphone-390x844-dpr3', viewport: { width: 390, height: 844 }, devicePixelRatio: 3 },
  { id: 'android-412x915-dpr2.625', viewport: { width: 412, height: 915 }, devicePixelRatio: 2.625 },
] as const;

const ORIGIN = 'https://north-star.dragon.test';

async function openState(browser: Browser, device: (typeof DEVICES)[number], html: string, css: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.devicePixelRatio,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url === `${ORIGIN}/`) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    if (url === `${ORIGIN}/styles.css`) return route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: css });
    const cover = /^https:\/\/i\.ytimg\.com\/vi\/([^/]+)\/maxresdefault\.jpg$/.exec(url);
    if (cover !== null) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: coverStandIn(cover[1] as string) });
    return route.abort();
  });
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? Promise.resolve() : img.decode())));
    // Deterministic dumps: every CSS animation (the playing state's spinning record) is frozen at its start frame.
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = 0;
    }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
  const dpr = await page.evaluate(() => window.devicePixelRatio);
  if (dpr !== device.devicePixelRatio) throw new Error(`${device.id}: devicePixelRatio ${dpr}`);
  return page;
}

type Dump = {
  readonly id: string;
  readonly tag: string;
  readonly className: string;
  readonly rect: { x: number; y: number; width: number; height: number };
  readonly textRects: readonly { x: number; y: number; width: number; height: number }[];
  readonly computed: Readonly<Record<string, string>>;
};

async function dumpBoxes(page: Page, properties: readonly string[]): Promise<{ root: Record<string, string>; scrollHeight: number; elements: Dump[] }> {
  return page.evaluate((props) => {
    const r = (b: DOMRect) => ({ x: b.x, y: b.y, width: b.width, height: b.height });
    const elements = [...document.querySelectorAll('[data-dragon-id]')].map((el) => {
      const cs = getComputedStyle(el);
      const computed: Record<string, string> = {};
      for (const p of props) computed[p] = cs.getPropertyValue(p);
      const textRects: { x: number; y: number; width: number; height: number }[] = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== Node.TEXT_NODE) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const b of range.getClientRects()) textRects.push(r(b));
      }
      return { id: el.getAttribute('data-dragon-id') as string, tag: el.localName, className: el.getAttribute('class') ?? '', rect: r(el.getBoundingClientRect()), textRects, computed };
    });
    const rootStyle = getComputedStyle(document.documentElement);
    const root: Record<string, string> = {};
    for (const name of [...rootStyle].filter((n) => n.startsWith('--')).sort()) root[name] = rootStyle.getPropertyValue(name).trim();
    return { root, scrollHeight: document.scrollingElement?.scrollHeight ?? 0, elements };
  }, properties);
}

async function main(): Promise<void> {
  const { html, css } = readSnapshot();
  const properties = usedProperties(css);
  const summary: Record<string, unknown>[] = [];
  for (const device of DEVICES) {
    const browser = await launchChrome(device.devicePixelRatio);
    try {
      const guard = await zoomGuard(browser, device.devicePixelRatio);
      const dir = examplePath(`chrome/${device.id}`);
      mkdirSync(dir, { recursive: true });
      for (const state of STATES) {
        const page = await openState(browser, device, stateHtml(html, state.id as StateId), css);
        const dump = await dumpBoxes(page, properties);
        await page.screenshot({ path: `${dir}/${state.id}.png`, animations: 'disabled', caret: 'hide' });
        await page.evaluate(() => window.scrollTo(0, document.scrollingElement?.scrollHeight ?? 0));
        await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
        await page.screenshot({ path: `${dir}/${state.id}-bottom.png`, animations: 'disabled', caret: 'hide' });
        const file = {
          schema: 'dragon-north-star-chrome/1',
          chrome: CHROME_VERSION,
          playwright: PLAYWRIGHT_VERSION,
          args: chromeArgsAt(device.devicePixelRatio),
          host: process.platform,
          device: { ...device, isMobile: true, hasTouch: true, colorScheme: 'dark' },
          zoomGuard: guard,
          state: state.id,
          stateDescription: state.description,
          properties,
          ...dump,
        };
        writeFileSync(`${dir}/${state.id}.boxes.json`, `${JSON.stringify(file, null, 1)}\n`);
        summary.push({ device: device.id, state: state.id, elements: dump.elements.length, scrollHeight: dump.scrollHeight });
        await page.context().close();
      }
    } finally {
      await browser.close();
    }
  }
  for (const s of summary) console.log(`${s['device']} ${s['state']}: ${s['elements']} elements, scrollHeight ${s['scrollHeight']}`);
}

await main();
