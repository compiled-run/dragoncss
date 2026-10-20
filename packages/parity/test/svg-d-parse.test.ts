// The SVG-d grammar against Chrome 145 (css/properties/svg-d.ts, scripts/gen-css-grammar.ts SYNTAX_OVERRIDES): Dragon accepts a d value
// exactly when Chrome parses it, and an accepted value computes in Chrome as Dragon's value does. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/svg-d.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(p: string, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const code = diagnostics[0]?.code ?? null;
  if (code === null && longhands.length !== 1) throw new Error(`${p}: ${v}: accepted without exactly one longhand`);
  return { p, v, code, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES: readonly (readonly [string, string])[] = [
  'none', 'NONE', 'path("M10 10 H50 V50 Z")', 'path("m10 10 h40")', 'PATH("M1 1 H2")', 'Path("M 1,1 L 2 2")', 'path(\'M0 0 H5\')',
  'path("")', 'path("  ")', 'path("M0,0L1,1")', 'path("M1e2 0 H.5 v-3")', 'path("M0 0 10 10 20 20")', 'path("m1 1 2 2 3 3z")',
  'path("M0 0 C1 1 2 2 3 3 S4 4 5 5 Q6 6 7 7 T8 8 Z")', 'path("M0 0 Z L 4 4")',
  'path("M0 0 L 10")', 'path("Z")', 'path("L 1 1")', 'path("M0 0 X 1")', 'path(evenodd, "M0 0 H5")', 'path(nonzero, "M0 0 H5")',
  '"M0 0 H5"', 'path()', 'path("M0 0 H5") none', 'path("M0 0") path("M1 1")', 'auto', 'url(#p)', '0',
].map((v) => ['d', v] as const);

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === null) {
      if (!s.parsed) return [`${it.p}: ${it.v}: accepted, Chrome drops it`];
      return s.authored === s.dragon ? [] : [`${it.p}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${String(it.value)} computes ${s.dragon}`];
    }
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.p}: ${it.v}: invalid, Chrome parses it`] : [];
    return [`${it.p}: ${it.v}: unexpected ${it.code}`];
  });
}

describe('d: Chrome 145 parsing and computed values', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon accepts exactly the values Chrome parses and computes them alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'relativeKeptAsAbsolute', items: real.filter((it) => it.v === 'path("m10 10 h40")').map((it) => ({ ...it, value: 'path("M10 10 H40")' })) },
      { name: 'fillRuleAccepted', items: real.filter((it) => it.v === 'path(evenodd, "M0 0 H5")').map((it) => ({ ...it, code: null, value: 'path(evenodd, "M0 0 H5")' })) },
      { name: 'partialPathAccepted', items: real.filter((it) => it.v === 'path("M0 0 L 10")').map((it) => ({ ...it, code: null, value: 'path("M0 0")' })) },
      { name: 'emptyPathKept', items: real.filter((it) => it.v === 'path("")').map((it) => ({ ...it, value: 'path("M0 0")' })) },
    ];
    for (const p of planted) expect(p.items.length, p.name).toBeGreaterThan(0);
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><svg><path id="a"/><path id="c"/></svg>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        if (it.value !== null) c.style.setProperty(it.p, it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue(it.p), dragon: getComputedStyle(c).getPropertyValue(it.p) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).length).toBeGreaterThan(10);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
