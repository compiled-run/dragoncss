// The filter parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, Blink Filter::ParseSingleValue): Dragon drops no
// value Chrome keeps, through filter and its alias -webkit-filter, and none computes alike. Every other value is kept and then refused
// (FX, computed-checks.ts checkFilter), so only none's computed value is compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/filter.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const code = diagnostics[0]?.code ?? null;
  if (code === null && (longhands.length !== 1 || longhands[0]?.property !== 'filter')) throw new Error(`${name}: ${v}: accepted without exactly one filter longhand`);
  return { name, v, code, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES = [
  'none', 'NONE', 'None', 'blur(4px)', 'blur()', 'blur(0)', 'grayscale(1)', 'grayscale(50%)', 'brightness(.8)', 'brightness(0)', 'contrast(2)',
  'drop-shadow(0 0 2px #000)', 'drop-shadow(red 1px 1px)', 'hue-rotate(90deg)', 'hue-rotate(0)', 'invert()', 'opacity(0)', 'opacity(.5)',
  'saturate(3)', 'sepia(1)', 'url(#f)', 'url(#f) blur(1px)', 'blur(1px) grayscale(1)', 'BLUR(1PX)', 'blur(calc(1px + 1px))',
  // Values Chrome drops: none in a list, a negative amount or blur, a spread, an unknown function or keyword, commas.
  'none blur(1px)', 'blur(1px) none', 'blur(-1px)', 'brightness(-1)', 'drop-shadow(1px 1px 1px 1px)', 'foo(1)', 'auto', 'blur(1px), grayscale(1)', '1px',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.name}: ${it.v}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${it.name}: ${it.v}: unexpected ${it.code}`];
    if (it.value === 'none') return !s.parsed ? [`${it.name}: ${it.v}: none, Chrome drops it`] : s.authored !== s.dragon ? [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's none computes ${s.dragon}`] : [];
    return s.parsed && s.authored === 'none' ? [`${it.name}: ${it.v}: refused as a filter, Chrome computes none`] : [];
  });
}

describe('filter: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, none computes alike from either name, and the plants are caught', async () => {
    const real = ['filter', '-webkit-filter'].flatMap((name) => VALUES.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'listDropped', items: [{ name: 'filter', v: 'blur(4px)', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
      { name: 'aliasDropped', items: [{ name: '-webkit-filter', v: 'none', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
      { name: 'listReadAsNone', items: [{ name: 'filter', v: 'opacity(0)', code: null, value: 'none' }] },
      { name: 'listInNoneAccepted', items: [{ name: 'filter', v: 'none blur(1px)', code: null, value: 'none' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="filter: blur(1px)"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c, both read as filter.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        if (it.value !== null) c.style.setProperty('filter', it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue('filter'), dragon: getComputedStyle(c).getPropertyValue('filter') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.value === 'none').length).toBe(6);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBeGreaterThan(40);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
