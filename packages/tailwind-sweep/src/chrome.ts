// The Chrome half of the sweep, in the parity lanes' pinned Chrome 145.
//   dual: the chrome-dual computed check for a whole document. The published Tailwind sheet as authored, and Dragon's web output,
//         each rendered in the sweep environment; on every element the border box and every standard computed property
//         (getComputedStyle's full list, custom properties excluded) must be equal. There is no tolerance.
//   parses: whether Chrome keeps a declaration or selector that Dragon reports invalid (CSS.supports).
import type { Browser, Page } from 'playwright';
import { harnessStyle, launchChrome } from '../../parity/src/chrome.ts';
import { SWEEP_ENVIRONMENT } from './dragon.ts';

export type DualCase = { readonly key: string; readonly authoredHtml: string; readonly compiledHtml: string };

type Captured = { readonly id: string; readonly box: readonly number[]; readonly computed: readonly (readonly [string, string])[] };

const injected = (html: string): string => {
  const out = html.replace('<head>', `<head><style data-dragon-harness>${harnessStyle(SWEEP_ENVIRONMENT)}</style>`);
  if (out === html) throw new Error('sweep fixture has no <head>');
  return out;
};

async function capture(page: Page, html: string): Promise<Captured[]> {
  await page.setContent(injected(html));
  return (await page.evaluate(`Array.from(document.querySelectorAll('[data-dragon-id]')).map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const computed = [];
    for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (!p.startsWith('--')) computed.push([p, cs.getPropertyValue(p)]); }
    return { id: el.getAttribute('data-dragon-id'), box: [r.x, r.y, r.width, r.height], computed };
  })`)) as Captured[];
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
  dual(c: DualCase): Promise<string[]>;
  /** CSS.supports for "property: value" or for "selector(...)". */
  supports(condition: string): Promise<boolean>;
  close(): Promise<void>;
};

export async function openChrome(): Promise<ChromeSession> {
  const browser: Browser = await launchChrome();
  try {
    const context = await browser.newContext({ viewport: { ...SWEEP_ENVIRONMENT.viewport }, deviceScaleFactor: SWEEP_ENVIRONMENT.devicePixelRatio });
    const page = await context.newPage();
    return {
      dual: async (c) => compareCaptures(await capture(page, c.authoredHtml), await capture(page, c.compiledHtml)),
      supports: async (condition) => {
        await page.setContent('<!DOCTYPE html><html><head></head><body></body></html>');
        return (await page.evaluate(`CSS.supports(${JSON.stringify(condition)})`)) as boolean;
      },
      close: () => browser.close(),
    };
  } catch (e) {
    await browser.close();
    throw e;
  }
}
