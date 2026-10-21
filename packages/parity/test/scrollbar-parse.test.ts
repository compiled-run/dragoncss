// The scrollbar-width and scrollbar-gutter grammars against Chrome 145: Dragon takes a value as valid exactly when Chrome parses it,
// and the value Dragon keeps computes as Chrome computes the authored value. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/scrollbar.css', revision: 'r1', hash: 'sha256:0' };
const LONGHANDS = ['scrollbar-width', 'scrollbar-gutter'];

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
  ...['auto', 'thin', 'none', 'NONE', 'Thin'].map((v) => ['scrollbar-width', v] as const),
  ...['auto', 'stable', 'stable both-edges', 'both-edges stable', 'STABLE BOTH-EDGES', 'Both-Edges Stable'].map((v) => ['scrollbar-gutter', v] as const),
  // Chrome drops a length, other keywords, two keywords, a lone both-edges, auto with both-edges and a repeated keyword.
  ...['thick', 'medium', '0', '8px', 'thin none', 'auto auto', 'stable'].map((v) => ['scrollbar-width', v] as const),
  ...['both-edges', 'auto both-edges', 'stable stable', 'stable both-edges stable', 'both-edges both-edges', 'always', 'none', '0', 'stable 1px', 'thin'].map((v) => ['scrollbar-gutter', v] as const),
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

describe('scrollbar-width and scrollbar-gutter: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, its values compute alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'gutterOrderKept', items: [{ p: 'scrollbar-gutter', v: 'both-edges stable', code: null, longhands: [['scrollbar-gutter', 'both-edges']] }] },
      { name: 'loneBothEdgesAccepted', items: [{ p: 'scrollbar-gutter', v: 'both-edges', code: null, longhands: [['scrollbar-gutter', 'both-edges']] }] },
      { name: 'thinRejected', items: [{ p: 'scrollbar-width', v: 'thin', code: 'DRAGON_CSS_INVALID_VALUE', longhands: [] }] },
      { name: 'noneReadAsAuto', items: [{ p: 'scrollbar-width', v: 'none', code: null, longhands: [['scrollbar-width', 'auto']] }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets both longhands away from their initial values; neither is inherited, so the children start at auto.
      await page.setContent('<!DOCTYPE html><div style="scrollbar-width: none; scrollbar-gutter: stable"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
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
    expect(real.filter((it) => it.code === null).length).toBe(11);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBe(17);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
