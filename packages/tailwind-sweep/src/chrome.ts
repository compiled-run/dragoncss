// The Chrome half of the sweep, in the parity lanes' pinned Chrome 145.
//   dual: the chrome-dual computed check for a whole document. The published Tailwind sheet as authored, and Dragon's web output,
//         each rendered in the sweep environment; on every element the border box and every standard computed property
//         (getComputedStyle's full list, custom properties excluded) must be equal. There is no tolerance.
//   parses: whether Chrome keeps a declaration or selector that Dragon reports invalid (CSS.supports).
import { availableParallelism } from 'node:os';
import type { Browser, Page } from 'playwright';
import { harnessStyle, launchChrome } from '../../parity/src/chrome.ts';
import { ELEMENT_IDS, SWEEP_ENVIRONMENT } from './dragon.ts';

export type DualCase = { readonly key: string; readonly authoredHtml: string; readonly compiledHtml: string };

type Captured = { readonly id: string; readonly box: readonly number[]; readonly computed: readonly (readonly [string, string])[] };

const injected = (html: string): string => {
  const out = html.replace('<head>', `<head><style data-dragon-harness>${harnessStyle(SWEEP_ENVIRONMENT)}</style>`);
  if (out === html) throw new Error('sweep fixture has no <head>');
  return out;
};

const isNumbers = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');
const isPairs = (v: unknown): v is [string, string][] => Array.isArray(v) && v.every((x) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string' && typeof x[1] === 'string');

/** What the page returned, checked: one entry per fixture element (ELEMENT_IDS, in order), each a four-number box and property pairs. */
export function checkCaptured(raw: unknown): Captured[] {
  if (!Array.isArray(raw)) throw new Error('the page capture is not a list');
  const out = raw.map((n: unknown): Captured => {
    const o = n as { id?: unknown; box?: unknown; computed?: unknown } | null;
    if (typeof o !== 'object' || o === null || typeof o.id !== 'string' || !isNumbers(o.box) || o.box.length !== 4 || !isPairs(o.computed)) throw new Error(`a captured element is malformed: ${JSON.stringify(n)}`);
    return { id: o.id, box: o.box, computed: o.computed };
  });
  if (out.map((n) => n.id).join(' ') !== ELEMENT_IDS.join(' ')) throw new Error(`captured elements ${out.map((n) => n.id).join(' ')}, expected ${ELEMENT_IDS.join(' ')}`);
  return out;
}

/** Marks a number JSON cannot carry (-0, NaN, ±Infinity) so the page's JSON string stays lossless; fromPageJson restores it. */
const NUMBER_TAG = '__dragonNumber';

/** The page result, parsed from the JSON string capture returns (Playwright's own serializer is ~5x slower on these dumps). */
export function fromPageJson(text: unknown): unknown {
  if (typeof text !== 'string') throw new Error(`the page capture is not a JSON string: ${typeof text}`);
  return JSON.parse(text, (_k, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return v;
    const keys = Object.keys(v);
    if (keys.length !== 1 || keys[0] !== NUMBER_TAG) return v;
    const t = (v as Record<string, unknown>)[NUMBER_TAG];
    if (t === '-0') return -0;
    if (t === 'NaN') return NaN;
    if (t === 'Infinity') return Infinity;
    if (t === '-Infinity') return -Infinity;
    throw new Error(`the page capture tags an unknown number ${JSON.stringify(t)}`);
  });
}

async function capture(page: Page, html: string): Promise<Captured[]> {
  await page.setContent(injected(html));
  // As parity's openPage: Ahem loaded and two frames drawn, so a font-relative value (ch, ex) is never read off a fallback font.
  const fonts = await page.evaluate(`(async () => {
    await document.fonts.load('10px Ahem');
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    return document.fonts.status;
  })()`);
  if (fonts !== 'loaded') throw new Error(`the page's fonts are ${JSON.stringify(fonts)}, not loaded, so a capture would measure a fallback font`);
  return checkCaptured(fromPageJson(await page.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('[data-dragon-id]')).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const computed = [];
    for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (!p.startsWith('--')) computed.push([p, cs.getPropertyValue(p)]); }
    return { id: el.getAttribute('data-dragon-id'), box: [r.x, r.y, r.width, r.height], computed };
  }), (k, v) => typeof v === 'number' && (Object.is(v, -0) || !Number.isFinite(v)) ? { ${NUMBER_TAG}: Object.is(v, -0) ? '-0' : String(v) } : v)`)));
}

/** Every difference between the two renderings; none means Chrome agrees with Dragon. */
export function compareCaptures(authored: readonly Captured[], compiled: readonly Captured[]): string[] {
  const problems: string[] = [];
  if (authored.map((n) => n.id).join(' ') !== compiled.map((n) => n.id).join(' ')) return ['the renderings have different elements'];
  if (authored.length === 0) return ['the renderings have no elements'];
  authored.forEach((a, i) => {
    const c = compiled[i] as Captured;
    if (a.box.join(',') !== c.box.join(',')) problems.push(`${a.id}: box authored [${a.box.join(', ')}] compiled [${c.box.join(', ')}]`);
    const mine = new Map(c.computed);
    if (a.computed.length === 0 || a.computed.length !== c.computed.length) problems.push(`${a.id}: ${a.computed.length} authored and ${c.computed.length} compiled computed properties`);
    for (const [p, v] of a.computed) {
      const w = mine.get(p);
      if (w !== v) problems.push(`${a.id}: ${p} authored "${v}" compiled "${w ?? '(missing)'}"`);
    }
  });
  return problems;
}

export type ChromeSession = {
  /** How many calls the session serves at once, each on its own page. */
  readonly pages: number;
  dual(c: DualCase): Promise<string[]>;
  /** CSS.supports for "property: value" or for "selector(...)". */
  supports(condition: string): Promise<boolean>;
  close(): Promise<void>;
};

/** Pages a session opens by default: one per core, at most 8. */
export const DEFAULT_PAGES = Math.max(1, Math.min(8, availableParallelism()));

/** One browser with `pages` pages, each in its own context; a call waits for a free page, so calls may overlap. */
export async function openChrome(pages: number = DEFAULT_PAGES): Promise<ChromeSession> {
  if (!Number.isInteger(pages) || pages < 1) throw new Error(`a Chrome session needs a whole number of pages, at least 1, not ${pages}`);
  const browser: Browser = await launchChrome();
  try {
    const free: Page[] = [];
    for (let i = 0; i < pages; i++) {
      const context = await browser.newContext({ viewport: { ...SWEEP_ENVIRONMENT.viewport }, deviceScaleFactor: SWEEP_ENVIRONMENT.devicePixelRatio });
      free.push(await context.newPage());
    }
    const waiting: ((p: Page) => void)[] = [];
    const withPage = async <T>(run: (page: Page) => Promise<T>): Promise<T> => {
      const page = free.pop() ?? (await new Promise<Page>((r) => waiting.push(r)));
      try {
        return await run(page);
      } finally {
        const next = waiting.shift();
        if (next === undefined) free.push(page);
        else next(page);
      }
    };
    return {
      pages,
      dual: (c) => withPage(async (page) => compareCaptures(await capture(page, c.authoredHtml), await capture(page, c.compiledHtml))),
      supports: (condition) =>
        withPage(async (page) => {
          await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>');
          return (await page.evaluate(`CSS.supports(${JSON.stringify(condition)})`)) as boolean;
        }),
      close: () => browser.close(),
    };
  } catch (e) {
    await browser.close();
    throw e;
  }
}
