// The fragmentation parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, properties/fragmentation.ts): Dragon
// drops no value Chrome keeps, through the five longhands and the page-break-* and -webkit-column-break-* shorthands, and every
// value Dragon accepts computes in Chrome to the longhand values Dragon computes. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { FRAGMENTATION_LONGHANDS } from '../../dragon/src/css/properties/fragmentation.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/fragmentation.css', revision: 'r1', hash: 'sha256:0' };

/** code: Dragon's diagnostic, or null; longhands: the longhands Dragon sets as [property, text] when it accepts the value, else null. */
type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (longhands.length !== 1 || !(FRAGMENTATION_LONGHANDS as readonly string[]).includes(longhands[0]?.property ?? ''))) throw new Error(`${name}: ${v}: accepted without one fragmentation longhand`);
  return { name, v, code, longhands: code === null ? longhands.map((l) => [l.property, valueToString(l.value)] as const) : null };
}

const BETWEEN = ['auto', 'avoid', 'avoid-column', 'avoid-page', 'column', 'left', 'page', 'recto', 'right', 'verso', 'always', 'all', 'region', 'avoid-region', 'AVOID', 'Page', 'page page', '1', 'none'];
const INSIDE = ['auto', 'avoid', 'avoid-column', 'avoid-page', 'AVOID-Page', 'page', 'column', 'always', 'avoid-region', 'none'];
const COUNT = ['1', '2', '3', '+4', '10000000000', 'calc(2)', 'calc(1.5)', 'calc(2.5)', 'calc(0)', 'calc(-1)', 'min(3, 5)', '0', '-1', '1.5', '1e1', 'auto', '2 2', 'calc(1px)', 'none'];
const LEGACY = ['auto', 'always', 'avoid', 'left', 'right', 'page', 'column', 'avoid-column', 'avoid-page', 'ALWAYS', 'Avoid', 'recto', 'none'];
const VALUES: { readonly [name: string]: readonly string[] } = {
  'break-before': BETWEEN,
  'break-after': BETWEEN,
  'break-inside': INSIDE,
  orphans: COUNT,
  widows: COUNT,
  'page-break-before': LEGACY,
  'page-break-after': LEGACY,
  'page-break-inside': LEGACY,
  '-webkit-column-break-before': LEGACY,
  '-webkit-column-break-after': LEGACY,
  '-webkit-column-break-inside': LEGACY,
};

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.name}: ${it.v}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${it.name}: ${it.v}: unexpected ${it.code}`];
    if (!s.parsed) return [`${it.name}: ${it.v}: accepted, Chrome drops it`];
    return s.authored !== s.dragon ? [`${it.name}: ${it.v}: Chrome computes ${s.authored}, Dragon's longhands compute ${s.dragon}`] : [];
  });
}

describe('fragmentation: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted value computes alike from any name, and the plants are caught', async () => {
    const real = Object.entries(VALUES).flatMap(([name, vs]) => vs.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'rectoDropped', items: [{ name: 'break-before', v: 'recto', code: 'DRAGON_CSS_INVALID_VALUE', longhands: null }] },
      { name: 'alwaysAccepted', items: [{ name: 'break-after', v: 'always', code: null, longhands: [['break-after', 'always']] }] },
      { name: 'columnAlwaysAsPage', items: [{ name: '-webkit-column-break-before', v: 'always', code: null, longhands: [['break-before', 'page']] }] },
      { name: 'columnAvoidAsAvoidColumn', items: [{ name: '-webkit-column-break-inside', v: 'avoid', code: null, longhands: [['break-inside', 'avoid-column']] }] },
      { name: 'calcTruncated', items: [{ name: 'orphans', v: 'calc(1.5)', code: null, longhands: [['orphans', '1']] }] },
      { name: 'wrongCount', items: [{ name: 'widows', v: '3', code: null, longhands: [['widows', '2']] }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c, both read as the
      // five fragmentation longhands.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        const read = (e) => ${JSON.stringify(FRAGMENTATION_LONGHANDS)}.map((p) => getComputedStyle(e).getPropertyValue(p)).join(' | ');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.cssText !== '';
        for (const [p, v] of it.longhands ?? []) c.style.setProperty(p, v);
        return { parsed, authored: read(a), dragon: read(c) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // 24 break-before and -after, 5 break-inside, 22 orphans and widows, 30 legacy spellings.
    expect(real.filter((it) => it.longhands !== null).length).toBe(81);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
