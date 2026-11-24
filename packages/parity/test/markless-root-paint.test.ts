// The page's own paint in a Markless export: the canvas colour (html's background, else body's, over the page's white base) and
// body's background in its own box when html has one. Every colour is the pixel Chrome shows there, read from its screenshot.
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchChrome } from '../src/chrome.ts';
import { marklessDocumentHtml } from '../src/markless-style-compare.ts';
import type { MarklessExportAssignment } from '../src/markless-style-input.ts';
import { marklessStyleExport, parseMarklessStyleInput } from '../src/markless-style-input.ts';
import { decodePng } from '../src/pixel-reference.ts';

const inputText = (css: string): string =>
  JSON.stringify({
    version: 'markless.native-style-input/0',
    component: 'Page',
    nodes: [{ kind: 'element', id: 'h0', element: 'div', parent: null, attributes: { class: 'box' } }],
    css: `.box { height: 100px; }\n${css}`,
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
/** Chrome's pixels inside body's 100px box and below it, where only the canvas shows. */
async function chromePixels(css: string): Promise<{ readonly body: Rgba8; readonly canvas: Rgba8 }> {
  const page = await browser.newPage({ viewport: { width: 200, height: 300 }, deviceScaleFactor: 1 });
  try {
    await page.setContent(marklessDocumentHtml(parseMarklessStyleInput(inputText(css)), {}));
    const image = decodePng(await page.screenshot());
    const at = (x: number, y: number): Rgba8 => {
      const i = (y * image.width + x) * 4;
      return { r: image.data[i]!, g: image.data[i + 1]!, b: image.data[i + 2]!, alpha: image.data[i + 3]! };
    };
    return { body: at(100, 50), canvas: at(100, 250) };
  } finally {
    await page.close();
  }
}

const dragonPaint = (css: string, t: 'ios' | 'android'): MarklessExportAssignment =>
  marklessStyleExport(inputText(css), 'root-paint.json').exported.targets[t]!.assignments[0]!;

describe('the page background a Markless export gives the hosts', () => {
  const cases = [
    'body { background: #123456; }',
    'html { background: #fefae0; }',
    'html { background: #fefae0; }\nbody { background: #264653; }',
    'body { background: rgba(0, 0, 0, 0.5); }',
    'html { background: rgba(38, 70, 83, 0.3); }',
    'html { background: rgba(38, 70, 83, 0.3); }\nbody { background: rgba(231, 111, 81, 0.6); }',
    'html { background: #fefae0; }\nbody { background: rgba(231, 111, 81, 0.25); }',
  ];
  for (const css of cases)
    it(`paints what Chrome paints: ${css.replace('\n', ' ')}`, async () => {
      const chrome = await chromePixels(css);
      for (const t of ['ios', 'android'] as const) {
        const a = dragonPaint(css, t);
        expect(a.canvas, t).toEqual(chrome.canvas);
        expect(a.bodyBackground ?? a.canvas, t).toEqual(chrome.body);
      }
    });

  // Dark pages: Chrome blends the root background into its rgb(18, 18, 18) base rounding to nearest, then draws body's box with Skia.
  const dark = [
    'html { background: rgba(0, 100, 255, 0.3); }',
    'html { background: rgba(52, 0, 0, 0.01); }',
    'html { background: rgba(201, 77, 140, 0.66); }',
    'html { background: rgba(9, 250, 33, 0.95); }',
    'body { background: rgba(0, 100, 255, 0.3); }',
    'body { background: rgba(128, 128, 0, 0.5); }',
    'html { background: rgba(0, 0, 64, 0.3); }\nbody { background: rgba(128, 128, 0, 0.05); }',
    'html { background: rgb(64, 0, 64); }\nbody { background: rgba(128, 0, 0, 0.05); }',
  ].map((css) => `:root { color-scheme: dark; }\n${css}`);
  for (const css of dark)
    it(`paints what Chrome paints on its dark base: ${css.replaceAll('\n', ' ')}`, async () => {
      const chrome = await chromePixels(css);
      for (const t of ['ios', 'android'] as const) {
        const a = dragonPaint(css, t);
        expect(a.colorScheme, t).toBe('dark');
        expect(a.canvas, t).toEqual(chrome.canvas);
        expect(a.bodyBackground ?? a.canvas, t).toEqual(chrome.body);
      }
    });

  it('gives body no colour of its own when its background is the canvas', () => {
    expect(dragonPaint('body { background: #123456; }', 'ios').bodyBackground).toBeNull();
    expect(dragonPaint('html { background: #fefae0; }', 'ios').bodyBackground).toBeNull();
    expect(dragonPaint('html { background: #fefae0; }\nbody { background: #264653; }', 'ios').bodyBackground).toEqual({ r: 38, g: 70, b: 83, alpha: 255 });
  });

  it('refuses a see-through page background in a dark-mode band, where Chrome draws it over a dark base', () => {
    const css = 'html { background: #fefae0; }\n@media (prefers-color-scheme: dark) { html { background: rgba(0, 0, 0, 0.5); } }';
    expect(() => dragonPaint(css, 'ios')).toThrow('see-through in a dark-mode band');
    const opaque = marklessStyleExport(inputText('html { background: #fefae0; }\n@media (prefers-color-scheme: dark) { html { background: #10212a; } body { background: rgba(231, 111, 81, 0.35); } }'), 'root-paint.json').exported.targets.ios!;
    expect(opaque.assignments.map((a) => a.bodyBackground === null)).toEqual(opaque.assignments.map((a) => a.values['@env#band'] === 0));
  });

  it('accepts a page-wide :focus-visible outline and draws none on html or body, which neither Chrome nor a phone focuses', async () => {
    const nodes = [
      { kind: 'element', id: 'h0', element: 'div', parent: null, attributes: { class: 'box' } },
      { kind: 'element', id: 'h1', element: 'a', parent: 'h0', attributes: { href: '/x' } },
      { kind: 'text', id: 'h1:text0', parent: 'h1', text: 'Go' },
    ];
    const css = '.box { height: 100px; } a { display: block; height: 20px; text-decoration: none; color: #000; } :focus-visible { outline: 2px solid #c00; outline-offset: 2px; }';
    const text = JSON.stringify({ version: 'markless.native-style-input/0', component: 'Page', nodes, css, states: [] });
    // Chrome 145: html and body take no focus, so only CSS.forcePseudoState reaches their :focus-visible state; the link does.
    const page = await browser.newPage({ viewport: { width: 200, height: 300 }, deviceScaleFactor: 1 });
    try {
      await page.setContent(marklessDocumentHtml(parseMarklessStyleInput(text), {}));
      const focused = await page.evaluate(() => [document.documentElement, document.body, document.querySelector('a') as HTMLElement].map((e) => {
        e.focus({ focusVisible: true } as FocusOptions);
        return [document.activeElement === e && e !== document.body, e.matches(':focus-visible')];
      }));
      expect(focused).toEqual([[false, false], [false, false], [true, true]]);
    } finally {
      await page.close();
    }
    for (const t of ['ios', 'android'] as const) {
      const level = marklessStyleExport(text, 'focus-ring.json').exported.targets[t]!.interaction!.levels[0]!;
      const outlined = level.states.map((s, k) => [level.matches[k]!.focusVisible, s.nodes.filter((n) => n.writes.some((w) => w['kind'] === 'outline')).map((n) => n.id)]);
      // Every element the rule reaches has a state; only html's and body's lose their ring, and a plain div keeps its own.
      expect(outlined, t).toEqual([['h1', ['h1']], ['html', []], ['body', []], ['h0', ['h0']]]);
    }
  });

  it('still refuses an outline on html outside its own focus state', () => {
    expect(() => dragonPaint('html { outline: 2px solid red; }', 'ios')).toThrow('html has a outline write, which the hosts do not draw on html');
  });

  it('refuses paint of html or body the hosts do not draw, naming it', () => {
    expect(() => dragonPaint('body { border: 2px solid red; }', 'ios')).toThrow('body has a border, which the hosts do not draw on body');
    expect(() => dragonPaint('html { border-top: 1px solid red; }', 'ios')).toThrow('html has a border');
  });
});
