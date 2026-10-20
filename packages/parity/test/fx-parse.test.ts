// The backdrop-filter and mix-blend-mode parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, Blink
// ConsumeFilterFunctionList and the mix-blend-mode keywords): Dragon keeps exactly the values Chrome keeps, and the value it emits on
// web computes as the authored one does. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/fx.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly name: string; readonly v: string; readonly kept: boolean; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (diagnostics.length > 0) {
    if (diagnostics.some((d) => d.code !== 'DRAGON_CSS_INVALID_VALUE' && d.code !== 'DRAGON_UNSUPPORTED_PROPERTY')) throw new Error(`${name}: ${v}: ${diagnostics.map((d) => d.code).join()}`);
    return { name, v, kept: false, value: null };
  }
  if (longhands.length !== 1 || longhands[0]?.property !== name) throw new Error(`${name}: ${v}: accepted without exactly one ${name} longhand`);
  return { name, v, kept: true, value: valueToString((longhands[0] as (typeof longhands)[number]).value) };
}

const BACKDROP = [
  'none', 'NONE', 'blur(10px)', 'blur()', 'blur(0)', 'BLUR(1PX)', 'blur(1px) blur(2px)', 'blur(1px)blur(2px)', 'blur(2em)', 'blur(calc(1px + 1em))',
  'blur(1Q)', 'brightness(1.5)', 'brightness(50%)', 'contrast(0)', 'grayscale(2)', 'grayscale(200%)', 'hue-rotate(0)', 'hue-rotate(1turn)',
  'hue-rotate(-90deg)', 'drop-shadow(1px 1px)', 'drop-shadow(red 1px 1px 2px)', 'drop-shadow(1px -1px 2px red)', 'url(#a)', 'url(#a) blur(1px)',
  'opacity(0)', 'invert()', 'saturate(calc(1 + 1))', 'sepia(1) blur(4px)',
  // Values Chrome drops: a negative amount or blur, a percentage blur, a spread or inset shadow, none in a list, commas, a unitless
  // blur, an unknown function, two arguments, src().
  'blur(-1px)', 'blur(1%)', 'blur(10)', 'brightness(-1)', 'hue-rotate(1px)', 'drop-shadow(1px 1px 2px 3px)', 'drop-shadow(1px 1px -2px)',
  'drop-shadow(inset 1px 1px)', 'none blur(1px)', 'blur(1px) none', 'blur(1px),blur(2px)', 'foo(1)', 'blur(1px 2px)', 'contrast(1, 2)', 'src("a")', 'auto', '1px',
];
const BLEND = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity', 'plus-lighter', 'MULTIPLY', 'Normal',
  'plus-darker', 'none', 'normal multiply', 'auto', 'multiply, screen',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (!it.kept) return s.parsed ? [`${it.name}: ${it.v}: dropped, Chrome parses it`] : [];
    if (!s.parsed) return [`${it.name}: ${it.v}: kept, Chrome drops it`];
    return s.authored !== s.dragon ? [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value} computes ${s.dragon}`] : [];
  });
}

describe('backdrop-filter and mix-blend-mode: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon keeps exactly the values Chrome keeps, each computes alike, neither has a -webkit- alias, and the plants are caught', async () => {
    const real = [...BACKDROP.map((v) => item('backdrop-filter', v)), ...BLEND.map((v) => item('mix-blend-mode', v))];
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'listDropped', items: [{ name: 'backdrop-filter', v: 'blur(4px)', kept: false, value: null }] },
      { name: 'negativeKept', items: [{ name: 'backdrop-filter', v: 'blur(-1px)', kept: true, value: 'blur(-1px)' }] },
      { name: 'listReadAsNone', items: [{ name: 'backdrop-filter', v: 'opacity(0)', kept: true, value: 'none' }] },
      { name: 'plusLighterDropped', items: [{ name: 'mix-blend-mode', v: 'plus-lighter', kept: false, value: null }] },
      { name: 'modeReadAsNormal', items: [{ name: 'mix-blend-mode', v: 'multiply', kept: true, value: 'normal' }] },
    ];
    for (const alias of ['-webkit-backdrop-filter', '-webkit-mix-blend-mode']) expect(item(alias, 'none').kept, alias).toBe(false);
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    let aliases: unknown;
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="font-size: 20px"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        if (it.value !== null) c.style.setProperty(it.name, it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue(it.name), dragon: getComputedStyle(c).getPropertyValue(it.name) };
      }))`)) as Seen[][];
      aliases = await page.evaluate(`['-webkit-backdrop-filter', '-webkit-mix-blend-mode'].map((p) => CSS.supports(p, 'initial'))`);
    } finally {
      await browser.close();
    }
    expect(aliases).toEqual([false, false]);
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBe(28 + 19);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
