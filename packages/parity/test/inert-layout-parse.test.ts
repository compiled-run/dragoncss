// The vertical-align, float and clear grammars against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES): Dragon accepts a
// value exactly when Chrome parses it, and an accepted value computes in Chrome as Dragon's value does. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/vertical-align.css', revision: 'r1', hash: 'sha256:0' };

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

const KEYWORDS = ['baseline', 'sub', 'super', 'text-top', 'text-bottom', 'middle', 'top', 'bottom', '-webkit-baseline-middle', 'MIDDLE', 'Text-Top'];
// css-inline-3's longhands and their values, which Chrome 145 does not take in vertical-align.
const INLINE_3 = ['first', 'last', 'center', 'central', 'alphabetic', 'ideographic', 'mathematical', 'text-before-edge', 'first baseline', 'last middle', 'middle first', 'sub 10px'];
const OTHER = ['10px', '-10px', '0', '0px', '5', '-3.5px', '1.5em', '2rem', '50%', '-25%', '0%', 'calc(5% + 3px)', 'calc(10px - 50%)', 'calc(2 * 4px)', 'min(10px, 5%)', 'auto', 'none', 'length', 'top bottom', '10px 5px'];
// css-page-floats-3 and css-logical-1 values Chrome 145 does not take, beside the ones it does.
const FLOAT = ['none', 'left', 'right', 'inline-start', 'inline-end', 'LEFT', 'Inline-End', 'both', 'top', 'bottom', 'block-start', 'block-end', 'snap-block', 'footnote', 'auto', 'left right', '0'];
const CLEAR = ['none', 'left', 'right', 'both', 'inline-start', 'inline-end', 'BOTH', 'top', 'bottom', 'block-start', 'both-inline', 'both-block', 'all', 'auto', 'left right', '0'];
const VALUES: readonly (readonly [string, string])[] = [
  ...[...KEYWORDS, ...INLINE_3, ...OTHER].map((v) => ['vertical-align', v] as const),
  ...FLOAT.map((v) => ['float', v] as const),
  ...CLEAR.map((v) => ['clear', v] as const),
];

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

describe('vertical-align, float and clear: Chrome 145 parsing and computed values', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon accepts exactly the values Chrome parses and computes them alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'webkitBaselineMiddleAsMiddle', items: real.filter((it) => it.v === '-webkit-baseline-middle').map((it) => ({ ...it, value: 'middle' })) },
      { name: 'firstAccepted', items: real.filter((it) => it.v === 'first').map((it) => ({ ...it, code: null, value: 'first' })) },
      { name: 'clearBothAsLeft', items: real.filter((it) => it.p === 'clear' && it.v === 'both').map((it) => ({ ...it, value: 'left' })) },
      { name: 'floatTopAccepted', items: real.filter((it) => it.p === 'float' && it.v === 'top').map((it) => ({ ...it, code: null, value: 'top' })) },
    ];
    for (const p of planted) expect(p.items.length, p.name).toBeGreaterThan(0);
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="font-size: 10px"><div><span id="a"></span><span id="c"></span></div></div>');
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
    for (const p of ['vertical-align', 'float', 'clear']) expect(real.filter((it) => it.p === p && it.code === null).length, p).toBeGreaterThan(4);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
