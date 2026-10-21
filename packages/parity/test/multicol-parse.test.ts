// The column-width, column-count and columns grammars against Chrome 145 (css/properties/multicol.ts, Blink ConsumeColumnWidth,
// ConsumeColumnCount and Columns::ParseShorthand): every value Dragon reads Chrome parses, to the computed column-width and
// column-count Dragon gives, and every value Chrome drops Dragon reads as none (it is kept as written and refused, or invalid).
// Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { NON_INITIAL_VALUE_TYPE } from '../../dragon/src/css/properties/initial-only.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/multicol.css', revision: 'r1', hash: 'sha256:0' };

type Property = 'column-width' | 'column-count' | 'columns';
/** Dragon's reading of `p: v`: whether it reads it, and the column-width and column-count it sets ('' where it sets none). */
type Item = { readonly p: Property; readonly v: string; readonly read: boolean; readonly width: string; readonly count: string };
type Seen = { readonly parsed: boolean; readonly width: string; readonly count: string };

function item(p: Property, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const longhands = diagnostics.length > 0 ? [] : (rules[0]?.declarations[0]?.longhands ?? []);
  const read = longhands.length > 0 && longhands.every((l) => !(l.value.kind === 'other' && l.value.type === NON_INITIAL_VALUE_TYPE));
  const of = (name: string): string => {
    const l = longhands.find((x) => x.property === name);
    return l === undefined ? '' : valueToString(l.value);
  };
  return { p, v, read, width: of('column-width'), count: of('column-count') };
}

const WIDTHS = ['auto', 'AUTO', '0', '0px', '80px', '12.5px', '100PX',
  // Chrome keeps these, and Dragon refuses them as written.
  '5em', 'calc(10px + 5px)',
  // Chrome drops these.
  '-1px', '10%', '10', '10px 20px', 'none', 'auto auto'];
const COUNTS = ['auto', 'Auto', '1', '2', '+3', '17',
  // Chrome drops these.
  '0', '-2', '1.5', '2 3', 'none', '2px'];
const SHORTHANDS = ['auto', 'auto auto', '2', '80px', '2 80px', '80px 2', 'auto 2', '2 auto', '80px auto', 'auto 80px', '0', '2 0',
  // Chrome keeps this, and Dragon refuses it as written.
  '5em 2',
  // Chrome drops these.
  '2 3', '10px 20px', '0 0', '1.5', '2 80px 3', 'auto auto auto', '0px 0', 'none'];

const VALUES: readonly (readonly [Property, string])[] = [
  ...WIDTHS.map((v) => ['column-width', v] as const),
  ...COUNTS.map((v) => ['column-count', v] as const),
  ...SHORTHANDS.map((v) => ['columns', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (!it.read) return [];
    if (!s.parsed) return [`${at}: read, Chrome drops it`];
    const out: string[] = [];
    if (it.width !== '' && it.width !== s.width) out.push(`${at}: Chrome computes column-width ${s.width}, Dragon ${it.width}`);
    if (it.count !== '' && it.count !== s.count) out.push(`${at}: Chrome computes column-count ${s.count}, Dragon ${it.count}`);
    return out;
  });
}

describe('column-width, column-count and columns: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('every value Dragon reads Chrome parses to the same computed values, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'zeroCountRead', items: [{ p: 'column-count', v: '0', read: true, width: '', count: '0' }] },
      { name: 'percentWidthRead', items: [{ p: 'column-width', v: '10%', read: true, width: '10%', count: '' }] },
      { name: 'swappedShorthand', items: [{ p: 'columns', v: '2 80px', read: true, width: 'auto', count: '2' }] },
      { name: 'twoCountsRead', items: [{ p: 'columns', v: '2 3', read: true, width: 'auto', count: '3' }] },
      { name: 'unitlessWidthRead', items: [{ p: 'column-width', v: '10', read: true, width: '10px', count: '' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="a"></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets.map((items) => items.map((it) => [it.p, it.v])))}).map((items) => items.map(([p, v]) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty(p, v);
        const parsed = a.style.getPropertyValue(p) !== '';
        const cs = getComputedStyle(a);
        return { parsed, width: cs.getPropertyValue('column-width'), count: cs.getPropertyValue('column-count') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    // Every value Chrome drops is one Dragon does not read.
    expect(real.filter((it, i) => !(seen[0] as Seen[])[i]?.parsed && it.read)).toEqual([]);
    expect(real.filter((it) => it.read).map((it) => `${it.p}: ${it.v}`)).toEqual([
      ...['auto', 'AUTO', '0', '0px', '80px', '12.5px', '100PX'].map((v) => `column-width: ${v}`),
      ...['auto', 'Auto', '1', '2', '+3', '17'].map((v) => `column-count: ${v}`),
      ...['auto', 'auto auto', '2', '80px', '2 80px', '80px 2', 'auto 2', '2 auto', '80px auto', 'auto 80px', '0', '2 0'].map((v) => `columns: ${v}`),
    ]);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
