// The 3D transform longhands' parse against Chrome 145 (webref's keyword grammars, Chrome's css_properties.json5 keywords, and
// perspective-origin's <position> parsed as object-position's): through backface-visibility, transform-style, transform-box, perspective
// and perspective-origin and their -webkit- aliases, Dragon keeps exactly the values Chrome keeps, and each kept value computes alike.
// Dragon may refuse a value as it parses (a unit or calculation it does not compute, or any -webkit-perspective but none and the
// CSS-wide keywords), which compiles nothing; every value Chrome reads through an alias unlike through its property (-webkit-perspective's
// unitless lengths) must be refused. Dragon then refuses every non-initial value (PNT2, analysis/transform-extra.ts), so the values
// are compared here as parsed. Each planted reading must be caught.
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
  perspective: 'perspective',
  '-webkit-perspective': 'perspective',
  'perspective-origin': 'perspective-origin',
  '-webkit-perspective-origin': 'perspective-origin',
};

/** value: Dragon's parsed value, null when Dragon drops the declaration, or 'refused' when it refuses it as it parses. */
type Item = { readonly name: string; readonly v: string; readonly property: string; readonly value: string | null };
const REFUSED = 'refused';
/** Chrome's reading: whether the name keeps the value and what it computes, the same through the property, and Dragon's value computed. */
type Seen = { readonly parsed: boolean; readonly authored: string; readonly plainParsed: boolean; readonly plain: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const property = PROPERTY[name] as string;
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  if (code === 'DRAGON_UNSUPPORTED_VALUE') return { name, v, property, value: REFUSED };
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
  perspective: ['none', 'NONE', '100px', '0', '0px', '-1px', '100', '50%', 'calc(10px + 5px)', 'calc(-10px)', 'none 10px', 'auto', '1e3px'],
  '-webkit-perspective': ['none', 'None', '100px', '100', '0', '-1', 'calc(10)', 'calc(infinity)', '50%', 'auto'],
  'perspective-origin': ['50% 50%', 'center', 'CENTER', 'center center', '50%', 'center 50%', '50% center', 'left 50% top 50%', 'top 50% left 50%', 'left top', 'right bottom', 'top', '10px 20px', '0 0', 'left 10px top', 'top left 10px', 'center top 10px', 'top center', 'center left', '10px top', 'top 10px', '1em 2em', 'calc(10px) 0', 'left right', 'top bottom', '50% 50% 0', 'center center center', 'auto'],
  '-webkit-perspective-origin': ['50% 50%', 'center', 'left top', '10px', 'left 10px top', 'none'],
};

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const unlike = s.parsed !== s.plainParsed || (s.parsed && s.authored !== s.plain);
    if (unlike && it.value !== REFUSED) return [`${it.name}: ${it.v}: Chrome reads it unlike ${it.property}: ${it.v}, and Dragon does not refuse it`];
    if (it.value === REFUSED) return [];
    if (it.value === null) return s.parsed ? [`${it.name}: ${it.v}: dropped, Chrome parses it`] : [];
    if (!s.parsed) return [`${it.name}: ${it.v}: kept as ${it.value}, Chrome drops it`];
    return s.authored === s.dragon ? [] : [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value} computes ${s.dragon}`];
  });
}

describe('backface-visibility, transform-style, transform-box, perspective and perspective-origin: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon keeps exactly the values Chrome keeps, each computes alike from either name, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'hiddenDropped', items: [{ name: 'backface-visibility', v: 'hidden', property: 'backface-visibility', value: null }] },
      { name: 'aliasDropped', items: [{ name: '-webkit-transform-style', v: 'flat', property: 'transform-style', value: null }] },
      { name: 'unknownKept', items: [{ name: 'transform-box', v: 'padding-box', property: 'transform-box', value: 'padding-box' }] },
      { name: 'preserveReadAsFlat', items: [{ name: 'transform-style', v: 'preserve-3d', property: 'transform-style', value: 'flat' }] },
      { name: 'unitlessKept', items: [{ name: 'perspective', v: '100', property: 'perspective', value: '100px' }] },
      { name: 'legacyAliasDropped', items: [{ name: '-webkit-perspective', v: '100', property: 'perspective', value: null }] },
      { name: 'originSwapped', items: [{ name: 'perspective-origin', v: 'left top 10px', property: 'perspective-origin', value: '0% 10px' }, { name: 'perspective-origin', v: '10px 20px', property: 'perspective-origin', value: '20px 10px' }] },
      { name: 'threeValuesKept', items: [{ name: 'perspective-origin', v: 'left 10px top', property: 'perspective-origin', value: '10px 0%' }] },
      { name: 'legacyAliasAccepted', items: [{ name: '-webkit-perspective', v: '100', property: 'perspective', value: '100px' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // Sized block boxes: Chrome resolves perspective-origin against the border box, so its computed px tell the offsets apart.
      await page.setContent('<!DOCTYPE html><style>div > div { width: 200px; height: 100px; }</style><div><div id="a"></div><div id="b"></div><div id="c"></div></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, the same value through the property on #b,
      // Dragon's value on #c, each read as the longhand.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), b = document.getElementById('b'), c = document.getElementById('c');
        for (const e of [a, b, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        b.style.setProperty(it.property, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        const plainParsed = b.style.getPropertyValue(it.property) !== '';
        if (it.value !== null && it.value !== 'refused') c.style.setProperty(it.property, it.value);
        const read = (e) => getComputedStyle(e).getPropertyValue(it.property);
        return { parsed, authored: read(a), plainParsed, plain: read(b), dragon: read(c) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(seen.map((s) => s.length)).toEqual(sets.map((s) => s.length));
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // Kept or refused by Dragon: 20 keywords, 41 perspective values; Chrome keeps all but -webkit-perspective's -1, 50% and auto.
    expect(real.filter((it) => it.value !== null).length).toBe(61);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBe(58);
    expect(real.filter((it) => it.value === REFUSED).map((it) => `${it.name}: ${it.v}`)).toEqual([
      ...['100px', '100', '0', '-1', 'calc(10)', 'calc(infinity)', '50%', 'auto'].map((v) => `-webkit-perspective: ${v}`),
      'perspective-origin: 1em 2em', 'perspective-origin: calc(10px) 0',
    ]);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
