// The text fill colour and stroke grammars against Chrome 145 (Blink WebkitTextFillColor, WebkitTextStrokeWidth and the
// -webkit-text-stroke shorthand): Dragon takes a value as valid exactly when Chrome parses it, and the longhands Dragon sets compute
// as Chrome computes the authored value. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/text-fill-stroke.css', revision: 'r1', hash: 'sha256:0' };
const LONGHANDS = ['-webkit-text-fill-color', '-webkit-text-stroke-width', '-webkit-text-stroke-color'];

type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly longhands: readonly (readonly [string, string])[] };
type Seen = { readonly parsed: boolean; readonly diff: readonly string[] };

function item(p: string, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = code !== null ? [] : (rules[0]?.declarations[0]?.longhands ?? []).map((l) => [l.property, valueToString(l.value)] as const);
  return { p, v, code, longhands };
}

const STROKE = '-webkit-text-stroke';
const VALUES: readonly (readonly [string, string])[] = [
  ...['currentcolor', 'red', '#0a7f5e', 'rgb(1 2 3 / 50%)', 'transparent'].map((v) => ['-webkit-text-fill-color', v] as const),
  ...['0', '0px', '1px', 'thin', 'medium', 'thick', '0.5em'].map((v) => ['-webkit-text-stroke-width', v] as const),
  ...['currentcolor', 'blue'].map((v) => ['-webkit-text-stroke-color', v] as const),
  ...['0', 'red', '0 red', 'red 0', '2px blue', 'thin', 'currentcolor thick', '1em #123'].map((v) => [STROKE, v] as const),
  // Chrome drops a length as a colour, a negative or percentage width, two widths, two colours and other keywords.
  ...['1px', 'none', 'red blue'].map((v) => ['-webkit-text-fill-color', v] as const),
  ...['-1px', '10%', '1px 2px', 'red', 'auto'].map((v) => ['-webkit-text-stroke-width', v] as const),
  ...['red blue', '1px 2px', '-1px', '10%', 'auto', 'none'].map((v) => [STROKE, v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    return s.diff.map((d) => `${at}: ${d}`);
  });
}

describe('the text fill colour and stroke: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, its longhands compute alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'strokeColorNotReset', items: [{ p: STROKE, v: '2px', code: null, longhands: [['-webkit-text-stroke-width', '2px']] }] },
      { name: 'strokeWidthNotReset', items: [{ p: STROKE, v: 'red', code: null, longhands: [['-webkit-text-stroke-color', 'red']] }] },
      { name: 'percentWidthAccepted', items: [{ p: '-webkit-text-stroke-width', v: '10%', code: null, longhands: [['-webkit-text-stroke-width', '10%']] }] },
      { name: 'keywordWidthRejected', items: [{ p: '-webkit-text-stroke-width', v: 'thin', code: 'DRAGON_CSS_INVALID_VALUE', longhands: [] }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets every longhand away from its initial value, so a longhand Dragon fails to reset shows as inherited.
      await page.setContent('<!DOCTYPE html><div style="color: green; font-size: 10px; -webkit-text-fill-color: purple; -webkit-text-stroke: 3px olive"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const L = ${JSON.stringify(LONGHANDS)};
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        for (const [l, v] of it.longhands) c.style.setProperty(l, v);
        const ca = getComputedStyle(a), cc = getComputedStyle(c);
        const diff = it.code !== null ? [] : L.filter((l) => ca.getPropertyValue(l) !== cc.getPropertyValue(l)).map((l) => l + ' Chrome ' + ca.getPropertyValue(l) + ' Dragon ' + cc.getPropertyValue(l));
        return { parsed, diff };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).length).toBeGreaterThan(18);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBeGreaterThan(10);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
