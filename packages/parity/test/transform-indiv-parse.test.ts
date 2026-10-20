// translate, rotate and scale (css-transforms-2 §4) parsed against Chrome 145 (longhands_custom.cc Translate, Rotate and Scale
// ParseSingleValue, through webref's grammars): Dragon keeps exactly the values Chrome keeps, and each kept value computes alike. Dragon
// may refuse a value as it parses (a calculation, a viewport unit, a z translation, a rotation about another axis than z, a z scale),
// which compiles nothing. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/transform-indiv.css', revision: 'r1', hash: 'sha256:0' };

/** value: Dragon's parsed value, null when Dragon drops the declaration, or 'refused' when it refuses it as it parses. */
type Item = { readonly name: string; readonly v: string; readonly value: string | null };
const REFUSED = 'refused';
/** Chrome's reading: whether it keeps the value and what it computes, and what Dragon's value computes. */
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  if (code === 'DRAGON_UNSUPPORTED_VALUE') return { name, v, value: REFUSED };
  if (code !== null && code !== 'DRAGON_CSS_INVALID_VALUE') throw new Error(`${name}: ${v}: unexpected ${code}`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length !== 1 || longhands[0]?.property !== name)) throw new Error(`${name}: ${v}: accepted without exactly one ${name} longhand`);
  return { name, v, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES: { readonly [name: string]: readonly string[] } = {
  translate: ['none', 'NONE', '10px', '10px 20px', '10px 0', '10px 0px', '10px 0%', '0 0', '0', '10px 20px 0', '10px 20px 0px', '10px 20px 5px', '10px 0 5px', '10px 20px 5%', '50%', '50% 25%', '1em 2rem', '10', '10px,20px', '10px 20px 30px 40px', 'calc(10px + 5%)', 'calc(1deg)', 'none 10px', 'auto', '1e3px', '-0px', '5vw', '10px 20px 1em', '0px 0px 0px', '1in 2pt', '-7.5px -0.25%'],
  rotate: ['none', '45deg', '0', '0deg', '1turn', '0.5rad', '100grad', 'z 45deg', '45deg z', 'x 45deg', 'y 45deg', '45deg x', '0 0 1 45deg', '0 0 2 45deg', '0 0 -1 45deg', '1 0 0 45deg', '0 1 0 45deg', '0 0 0 45deg', '1 1 0 45deg', '45deg 0 0 1', 'x', '45', '45deg 10deg', 'Z 45DEG', 'calc(45deg)', 'calc(1px)', '-90deg', '720deg', 'x 0deg', 'z 0deg', '0 0 0.5 30deg', 'z z 45deg', '0 0 45deg', '1e2deg', 'calc(1) 0 0 45deg'],
  scale: ['none', '2', '2 3', '2 2', '2 2 1', '2 3 1', '2 3 4', '1 1 2', '50%', '50% 200%', '200% 2', '2 200%', '0', '-1', '-1 1', '2,3', '2px', '2 3 4 5', 'calc(2)', 'calc(2px)', 'none 2', '1 1 1', '100% 100%', '50% 50% 100%', '1.5 -0.5', '1e1'],
};

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.value === REFUSED) return [];
    if (it.value === null) return s.parsed ? [`${it.name}: ${it.v}: dropped, Chrome parses it`] : [];
    if (!s.parsed) return [`${it.name}: ${it.v}: kept as ${it.value}, Chrome drops it`];
    return s.authored === s.dragon ? [] : [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value} computes ${s.dragon}`];
  });
}

describe('translate, rotate and scale: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon keeps exactly the values Chrome keeps, each computes alike, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'zAxisDropped', items: [{ name: 'rotate', v: 'z 45deg', value: null }] },
      { name: 'unitlessZeroKept', items: [{ name: 'rotate', v: '0', value: '0deg' }] },
      { name: 'turnAsDegrees', items: [{ name: 'rotate', v: '1turn', value: '1deg' }] },
      { name: 'percentScaleAsNumber', items: [{ name: 'scale', v: '50%', value: '50' }] },
      { name: 'yScaleDropped', items: [{ name: 'scale', v: '2 3', value: '2' }] },
      { name: 'percentYDropped', items: [{ name: 'translate', v: '10px 5%', value: '10px' }] },
      { name: 'zLengthKept', items: [{ name: 'translate', v: '10px 20px 5%', value: '10px 20px' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // Sized block boxes in a 10px root: percentages and em stay apart in Chrome's computed px.
      await page.setContent('<!DOCTYPE html><style>html { font-size: 16px; } div > div { width: 200px; height: 100px; font-size: 10px; }</style><div><div id="a"></div><div id="c"></div></div>');
      // A string expression: this test project has no DOM types. The authored value on #a and Dragon's value on #c, each read as the longhand.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        if (it.value !== null && it.value !== 'refused') c.style.setProperty(it.name, it.value);
        const read = (e) => getComputedStyle(e).getPropertyValue(it.name);
        return { parsed, authored: read(a), dragon: read(c) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(seen.map((s) => s.length)).toEqual(sets.map((s) => s.length));
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.value !== null).length).toBe(KEPT);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBe(KEPT);
    expect(real.filter((it) => it.value === REFUSED).map((it) => `${it.name}: ${it.v}`)).toEqual(REFUSED_VALUES);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});

/** The values Dragon keeps or refuses, which are exactly the values Chrome keeps: 92 values, 19 of them dropped. */
const KEPT = 73;
/** The 3D parts (PNT2-m), the calculations and the viewport unit Dragon refuses as it parses. */
const REFUSED_VALUES: readonly string[] = [
  ...['10px 20px 5px', '10px 0 5px', 'calc(10px + 5%)', '5vw', '10px 20px 1em'].map((v) => `translate: ${v}`),
  ...['x 45deg', 'y 45deg', '45deg x', '0 0 -1 45deg', '1 0 0 45deg', '0 1 0 45deg', '0 0 0 45deg', '1 1 0 45deg', 'calc(45deg)', 'x 0deg', 'calc(1) 0 0 45deg'].map((v) => `rotate: ${v}`),
  ...['2 3 4', '1 1 2', 'calc(2)'].map((v) => `scale: ${v}`),
];
