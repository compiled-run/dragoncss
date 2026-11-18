// The root's color-scheme in a Markless export: a page that opts into dark (dark, or light dark under a dark preference) gets
// Chrome's dark canvas and UA colours; one that does not keeps the white canvas, as the owner ruled. Every colour is Chrome's.
import { readFileSync } from 'node:fs';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { compareMarklessExport, marklessDocumentHtml } from '../src/markless-style-compare.ts';
import type { MarklessExportAssignment, MarklessStyleExport, MarklessStyleInput } from '../src/markless-style-input.ts';
import { marklessStyleExport, parseMarklessStyleInput, schemeOf } from '../src/markless-style-input.ts';
import { repoPath } from '../src/paths.ts';
import { decodePng } from '../src/pixel-reference.ts';

const PATH = 'examples/markless-styles/input/scheme.native-style-input.json';
const EXAMPLE = readFileSync(repoPath(PATH), 'utf8');

/** A heading, text, a link and a styled button under the given root rules. */
const page = (css: string): string =>
  JSON.stringify({
    version: 'markless.native-style-input/0',
    component: 'Page',
    nodes: [
      { kind: 'element', id: 'm', element: 'main', parent: null, attributes: {} },
      { kind: 'element', id: 'h', element: 'h1', parent: 'm', attributes: {} },
      { kind: 'text', id: 'ht', parent: 'h', text: 'Title' },
      { kind: 'element', id: 'p', element: 'p', parent: 'm', attributes: {} },
      { kind: 'text', id: 'pt', parent: 'p', text: 'Body text' },
      { kind: 'element', id: 'a', element: 'a', parent: 'm', attributes: { href: '#x' } },
      { kind: 'text', id: 'at', parent: 'a', text: 'A link' },
      { kind: 'element', id: 'r', element: 'div', parent: 'm', attributes: { class: 'row' } },
      { kind: 'element', id: 'b', element: 'button', parent: 'r', attributes: { class: 'btn', type: 'button' } },
      { kind: 'text', id: 'bt', parent: 'b', text: 'Go' },
    ],
    css: `a { display: block; text-decoration: none; }\n.row { display: flex; }\n.btn { font-family: inherit; font-size: 18px; padding: 10px 18px; border: 2px solid #22223b; border-radius: 10px; background: #8d99ae; }\n${css}`,
    states: [],
  });

let browser: Browser;
beforeAll(async () => {
  browser = await launchChrome(1);
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

type Rgba8 = MarklessExportAssignment['canvas'];
const rgba = (css: string): Rgba8 => {
  const [r, g, b, a] = css.slice(css.indexOf('(') + 1, -1).split(',').map((v) => Number(v.trim())) as [number, number, number, number | undefined];
  return { r, g, b, alpha: a === undefined ? 255 : Math.round(a * 255) };
};

type ChromeFacts = { readonly canvas: Rgba8; readonly color: Record<string, Rgba8>; readonly background: Record<string, Rgba8> };

/** Chrome's canvas pixel (the bottom right corner, below every box) and each element's computed color and background colour. */
async function chromeFacts(input: MarklessStyleInput, values: Record<string, unknown>, colorScheme: 'light' | 'dark'): Promise<ChromeFacts> {
  const p = await browser.newPage({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 1 });
  try {
    await p.emulateMedia({ colorScheme });
    await p.setContent(marklessDocumentHtml(input, values));
    const image = decodePng(await p.screenshot());
    const i = (795 * image.width + 395) * 4;
    const canvas = { r: image.data[i]!, g: image.data[i + 1]!, b: image.data[i + 2]!, alpha: image.data[i + 3]! };
    const computed = await p.evaluate(() => [...document.querySelectorAll('[data-dragon-id]')].map((e) => {
      const s = getComputedStyle(e);
      return [e.getAttribute('data-dragon-id') as string, s.color, s.backgroundColor] as const;
    }));
    return { canvas, color: Object.fromEntries(computed.map(([id, c]) => [id, rgba(c)])), background: Object.fromEntries(computed.map(([id, , b]) => [id, rgba(b)])) };
  } finally {
    await p.close();
  }
}

/** Dragon's text colour of each element with text, and the background colour of every element, in one assignment. */
function dragonColours(a: MarklessExportAssignment): { readonly color: Record<string, unknown>; readonly background: Record<string, unknown> } {
  const color: Record<string, unknown> = {};
  const background: Record<string, unknown> = {};
  for (const n of a.nodes) {
    const text = n.writes.find((w) => w['kind'] === 'text-color');
    if (n.kind === 'text' && text !== undefined && n.parent !== null) color[n.parent] = text['color'];
    const bg = n.writes.find((w) => w['kind'] === 'background-color');
    if (n.kind === 'element' && bg !== undefined) background[n.id] = bg['color'];
  }
  return { color, background };
}

/** The preferences each assignment is shown under: its band's, or both where no band reads the preference. */
const preferencesOf = (x: NonNullable<MarklessStyleExport['targets']['ios']>, a: MarklessExportAssignment): readonly ('light' | 'dark')[] => {
  const band = a.values['@env#band'];
  return typeof band === 'number' ? [schemeOf(x.bands, band)] : ['light', 'dark'];
};

const WHITE = { r: 255, g: 255, b: 255, alpha: 255 };
const DARK_CANVAS = { r: 18, g: 18, b: 18, alpha: 255 };
const BLACK = { r: 0, g: 0, b: 0, alpha: 255 };
const LINK = { r: 0, g: 0, b: 238, alpha: 255 };
const DARK_LINK = { r: 158, g: 158, b: 255, alpha: 255 };

/** Checks every assignment of both targets under each preference it can be shown in against Chrome, and returns what each showed. */
async function againstChrome(text: string, path: string): Promise<{ readonly scheme: string; readonly canvas: Rgba8; readonly color: Record<string, unknown> }[]> {
  const input = parseMarklessStyleInput(text);
  const { exported } = marklessStyleExport(text, path);
  const seen: { scheme: string; canvas: Rgba8; color: Record<string, unknown> }[] = [];
  for (const t of ['ios', 'android'] as const) {
    const x = exported.targets[t]!;
    for (const a of x.assignments) {
      for (const preference of preferencesOf(x, a)) {
        const chrome = await chromeFacts(input, a.values, preference);
        const dragon = dragonColours(a);
        const where = `${t} ${JSON.stringify(a.values)} prefers ${preference}`;
        expect(a.canvas, where).toEqual(chrome.canvas);
        expect(dragon.color, where).toEqual(Object.fromEntries(Object.keys(dragon.color).map((id) => [id, chrome.color[id]])));
        expect(dragon.background, where).toEqual(Object.fromEntries(Object.keys(dragon.background).map((id) => [id, chrome.background[id]])));
        seen.push({ scheme: `${preference} ${a.colorScheme}`, canvas: a.canvas, color: dragon.color });
      }
    }
    for (const preference of x.bands === undefined ? (['light', 'dark'] as const) : (['light'] as const)) {
      const report = await compareMarklessExport(input, { ...exported, targets: { [t]: x } }, undefined, preference);
      expect(report.compared, `${t} prefers ${preference}`).toBeGreaterThan(5);
      expect(report.rows.filter((r) => !r.pass), `${t} prefers ${preference}`).toEqual([]);
    }
  }
  return seen;
}

describe('the root color-scheme in a Markless export, against Chrome', () => {
  it(':root { color-scheme: light dark } follows the preference: white canvas, black text and rgb(0, 0, 238) links when light; rgb(18, 18, 18), white text and rgb(158, 158, 255) links when dark', async () => {
    const seen = await againstChrome(page(':root { color-scheme: light dark; }'), 'light-dark.json');
    expect(seen.map((s) => s.scheme)).toEqual(['light light', 'dark dark', 'light light', 'dark dark']);
    for (const s of seen) {
      const dark = s.scheme === 'dark dark';
      expect(s.canvas).toEqual(dark ? DARK_CANVAS : WHITE);
      expect(s.color).toEqual({ h: dark ? WHITE : BLACK, p: dark ? WHITE : BLACK, a: dark ? DARK_LINK : LINK, b: dark ? WHITE : BLACK });
    }
  }, 240_000);

  it('html { color-scheme: dark } is dark under both preferences: rgb(18, 18, 18) canvas, white text, rgb(158, 158, 255) links', async () => {
    const seen = await againstChrome(page('html { color-scheme: dark; }'), 'dark.json');
    expect(seen.map((s) => s.scheme)).toEqual(['light dark', 'dark dark', 'light dark', 'dark dark']);
    for (const s of seen) {
      expect(s.canvas).toEqual(DARK_CANVAS);
      expect(s.color).toEqual({ h: WHITE, p: WHITE, a: DARK_LINK, b: WHITE });
    }
  }, 240_000);

  it('the example page (light dark, an accent colour under prefers-color-scheme: dark) matches Chrome in both bands', async () => {
    const seen = await againstChrome(EXAMPLE, PATH);
    expect(seen.map((s) => s.scheme)).toEqual(['light light', 'dark dark', 'light light', 'dark dark']);
    expect(seen.map((s) => s.color['h3'])).toEqual([{ r: 29, g: 78, b: 216, alpha: 255 }, { r: 147, g: 197, b: 253, alpha: 255 }, { r: 29, g: 78, b: 216, alpha: 255 }, { r: 147, g: 197, b: 253, alpha: 255 }]);
  }, 240_000);

  it('a page that does not opt in keeps the white canvas in a dark-mode band, a recorded divergence from Chrome, which paints rgb(18, 18, 18) there (owner ruling)', async () => {
    const text = page('@media (prefers-color-scheme: dark) { .row { gap: 4px; } }');
    const input = parseMarklessStyleInput(text);
    const x = marklessStyleExport(text, 'un-opted.json').exported.targets.ios!;
    const dark = x.assignments.find((a) => schemeOf(x.bands, a.values['@env#band'] as number) === 'dark')!;
    const chrome = await chromeFacts(input, dark.values, 'dark');
    expect(chrome.canvas).toEqual(DARK_CANVAS);
    expect(dark.canvas).toEqual(WHITE);
    expect(dark.colorScheme).toBe('light');
    expect(dragonColours(dark).color).toEqual({ h: chrome.color['h'], p: chrome.color['p'], a: chrome.color['a'], b: chrome.color['b'] });
    expect(chrome.color['p']).toEqual(BLACK);
  }, 120_000);
});
