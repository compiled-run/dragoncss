// The 3D transform longhands' parse against Chrome 145 (webref's keyword grammars, Chrome's css_properties.json5 keywords): through
// backface-visibility, transform-style and transform-box and the -webkit-backface-visibility and -webkit-transform-style aliases,
// Dragon keeps exactly the values Chrome keeps, and each kept value computes alike. Dragon then refuses every non-initial value
// (PNT2, analysis/transform-extra.ts), so the values are compared here as parsed. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/transform-extra.css', revision: 'r1', hash: 'sha256:0' };

const PROPERTY: { readonly [name: string]: string } = {
  'backface-visibility': 'backface-visibility',
  '-webkit-backface-visibility': 'backface-visibility',
  'transform-style': 'transform-style',
  '-webkit-transform-style': 'transform-style',
  'transform-box': 'transform-box',
};

type Item = { readonly name: string; readonly v: string; readonly property: string; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const property = PROPERTY[name] as string;
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  if (code !== null && code !== 'DRAGON_CSS_INVALID_VALUE') throw new Error(`${name}: ${v}: unexpected ${code}`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length !== 1 || longhands[0]?.property !== property)) throw new Error(`${name}: ${v}: accepted without exactly one ${property} longhand`);
  return { name, v, property, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES: { readonly [name: string]: readonly string[] } = {
  'backface-visibility': ['visible', 'hidden', 'VISIBLE', 'Hidden', 'none', 'auto', 'visible hidden', 'collapse', '0'],
  '-webkit-backface-visibility': ['visible', 'hidden', 'HIDDEN', 'none'],
  'transform-style': ['flat', 'preserve-3d', 'FLAT', 'Preserve-3D', 'preserve', '3d', 'flat preserve-3d', 'none'],
  '-webkit-transform-style': ['flat', 'preserve-3d', 'PRESERVE-3D', 'auto'],
  'transform-box': ['view-box', 'border-box', 'content-box', 'fill-box', 'stroke-box', 'VIEW-BOX', 'padding-box', 'margin-box', 'view-box border-box', 'auto'],
};

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.value === null) return s.parsed ? [`${it.name}: ${it.v}: dropped, Chrome parses it`] : [];
    if (!s.parsed) return [`${it.name}: ${it.v}: kept as ${it.value}, Chrome drops it`];
    return s.authored === s.dragon ? [] : [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value} computes ${s.dragon}`];
  });
}

describe('backface-visibility, transform-style and transform-box: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon keeps exactly the values Chrome keeps, each computes alike from either name, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'hiddenDropped', items: [{ name: 'backface-visibility', v: 'hidden', property: 'backface-visibility', value: null }] },
      { name: 'aliasDropped', items: [{ name: '-webkit-transform-style', v: 'flat', property: 'transform-style', value: null }] },
      { name: 'unknownKept', items: [{ name: 'transform-box', v: 'padding-box', property: 'transform-box', value: 'padding-box' }] },
      { name: 'preserveReadAsFlat', items: [{ name: 'transform-style', v: 'preserve-3d', property: 'transform-style', value: 'flat' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c, both read as the longhand.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        if (it.value !== null) c.style.setProperty(it.property, it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue(it.property), dragon: getComputedStyle(c).getPropertyValue(it.property) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.value !== null).length).toBe(20);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBe(20);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
