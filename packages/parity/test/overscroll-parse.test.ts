// The overscroll-behavior and overflow-anchor grammars against Chrome 145: Dragon takes a value as valid exactly when Chrome parses it,
// and the longhands Dragon sets (each overscroll longhand with its logical pair) compute as Chrome computes the authored value. Each
// planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { OVERSCROLL_LONGHANDS } from '../../dragon/src/css/properties/overscroll.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/overscroll.css', revision: 'r1', hash: 'sha256:0' };

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

const VALUES: readonly (readonly [string, string])[] = [
  ...['auto', 'contain', 'none', 'NONE', 'contain none', 'none auto', 'Auto Contain', 'auto auto'].map((v) => ['overscroll-behavior', v] as const),
  ...['auto', 'contain', 'none', 'CONTAIN'].map((v) => ['overscroll-behavior-x', v] as const),
  ...['none', 'contain'].map((v) => ['overscroll-behavior-y', v] as const),
  ...['contain', 'none'].map((v) => ['overscroll-behavior-inline', v] as const),
  ...['none', 'auto'].map((v) => ['overscroll-behavior-block', v] as const),
  ...['auto', 'none', 'NONE'].map((v) => ['overflow-anchor', v] as const),
  // Chrome 145 drops chain (css-overscroll-1 adds it), a third value, a second value on a longhand, lengths and other keywords.
  ...['chain', 'auto auto auto', 'contain chain', '0'].map((v) => ['overscroll-behavior', v] as const),
  ...['chain', 'auto auto', 'contain none', '1px'].map((v) => ['overscroll-behavior-x', v] as const),
  ['overscroll-behavior-y', 'visible'],
  ['overscroll-behavior-inline', 'chain'],
  ['overscroll-behavior-block', 'none none'],
  ...['visible', 'auto none', 'contain', 'chain'].map((v) => ['overflow-anchor', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  if (seen.length !== items.length) return [`Chrome returned ${String(seen.length)} readings for ${String(items.length)} items`];
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    return s.diff.map((d) => `${at}: ${d}`);
  });
}

describe('overscroll-behavior and overflow-anchor: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, its longhands compute alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'chainAccepted', items: [{ p: 'overscroll-behavior-x', v: 'chain', code: null, longhands: [['overscroll-behavior-x', 'chain']] }] },
      { name: 'noneReadAsContain', items: [{ p: 'overscroll-behavior-y', v: 'none', code: null, longhands: [['overscroll-behavior-y', 'contain'], ['overscroll-behavior-block', 'contain']] }] },
      { name: 'secondValueIgnored', items: [{ p: 'overscroll-behavior', v: 'contain none', code: null, longhands: OVERSCROLL_LONGHANDS.slice(0, 4).map((l) => [l, 'contain'] as const) }] },
      { name: 'anchorNoneDropped', items: [{ p: 'overflow-anchor', v: 'none', code: 'DRAGON_CSS_INVALID_VALUE', longhands: [] }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets every longhand away from auto; none is inherited, so the children start at auto.
      await page.setContent('<!DOCTYPE html><div style="overscroll-behavior: none contain; overflow-anchor: none"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's longhands on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const L = ${JSON.stringify(OVERSCROLL_LONGHANDS)};
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
    expect(real.filter((it) => it.code === null).length).toBe(21);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBe(15);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
