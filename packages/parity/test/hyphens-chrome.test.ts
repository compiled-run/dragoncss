// TXT2-i against Chrome 145 (notes/T149-txt2-spec.md R14). Two facts Dragon's hyphens rules rest on, measured as line counts in a 1px
// box, where every break opportunity Chrome takes starts a new line:
// - <meta http-equiv="content-language" content="en"> seeds the document locale (Document::ContentLanguage), so hyphens: auto
//   hyphenates under it and not without it. The fixture reader refuses the pragma, since Dragon lowers auto as manual.
// - Chrome 145 has no -webkit-hyphens (css_properties.json5 lists -webkit-hyphenate-character but no alias for hyphens), so
//   -webkit-hyphens: none neither parses nor turns off the soft hyphen's break, and Dragon refuses the property.
import { describe, expect, it } from 'vitest';
import { fixtureToInput } from '../src/fixture-reader.ts';

type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

/** The line count of each `<div id>` in the page: its height over its line height, in a 1px box. */
async function lines(browser: Browser, head: string, body: string): Promise<Record<string, number>> {
  const page = await browser.newPage();
  await page.setContent(`<!DOCTYPE html><html><head>${head}<style>div { width: 1px; font: 10px/10px monospace; }</style></head><body>${body}</body></html>`);
  // A string expression: this test project has no DOM types.
  return (await page.evaluate(`Object.fromEntries([...document.querySelectorAll('div[id]')].map((d) => [d.id, Math.round(d.getBoundingClientRect().height / 10)]))`)) as Record<string, number>;
}

const WORD = 'extraordinary';
const SHY = 'XXX­XXX­XXX';

describe('hyphens: Chrome 145', () => {
  it('hyphenates under auto only with a content-language pragma, and -webkit-hyphens is not a property', async () => {
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let bare: Record<string, number>;
    let pragma: Record<string, number>;
    let webkit: Record<string, number>;
    let parsed: unknown;
    try {
      bare = await lines(browser, '', `<div id="auto" style="hyphens: auto">${WORD}</div>`);
      pragma = await lines(browser, '<meta http-equiv="content-language" content="en">', `<div id="auto" style="hyphens: auto">${WORD}</div><div id="manual" style="hyphens: manual">${WORD}</div>`);
      webkit = await lines(browser, '', `<div id="manual">${SHY}</div><div id="none" style="hyphens: none">${SHY}</div><div id="webkitNone" style="-webkit-hyphens: none">${SHY}</div>`);
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="a"></div>');
      parsed = await page.evaluate(`(() => { const a = document.getElementById('a'); a.style.setProperty('-webkit-hyphens', 'none'); return { supports: CSS.supports('-webkit-hyphens', 'none'), set: a.style.getPropertyValue('-webkit-hyphens'), hyphens: a.style.getPropertyValue('hyphens') }; })()`);
    } finally {
      await browser.close();
    }
    // Without a language, auto takes no hyphenation point: the word stays on one line.
    expect(bare.auto).toBe(1);
    // The pragma makes auto hyphenate the word over several lines, where manual keeps it whole.
    expect(pragma.manual).toBe(1);
    expect(pragma.auto).toBeGreaterThan(1);
    // A soft hyphen breaks under manual (three lines) and not under none (one); -webkit-hyphens: none is dropped, so it breaks as manual.
    expect([webkit.manual, webkit.none, webkit.webkitNone]).toEqual([3, 1, 3]);
    expect(parsed).toEqual({ supports: false, set: '', hyphens: '' });
  });

  it('the fixture reader refuses the content-language pragma', () => {
    const html = (meta: string): string => `<!DOCTYPE html>\n<html data-dragon-id="html">\n<head>\n${meta}<style>\n.a { hyphens: auto; }\n</style>\n</head>\n<body data-dragon-id="body"><div data-dragon-id="a" class="a">${WORD}</div></body>\n</html>\n`;
    expect(() => fixtureToInput('hyphens-pragma', html('<meta http-equiv="content-language" content="en">\n'))).toThrow(/content-language.* is unsupported/);
    expect(() => fixtureToInput('hyphens-pragma', html('<meta http-equiv="Content-Language" content="en">\n'))).toThrow(/is unsupported/);
    expect(() => fixtureToInput('hyphens-pragma', html('<meta charset="utf-8">\n'))).not.toThrow();
  });
});
