// The sizing grammars against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, css/size-keywords.ts): Dragon accepts a
// width, height, min-, max- or logical size value, or a flex-basis value, exactly when Chrome parses it, refuses one it parses only
// where it has no support, and an accepted value computes in Chrome as Dragon's value does. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/size-keywords.css', revision: 'r1', hash: 'sha256:0' };

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

const SIZES = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'inline-size', 'min-block-size', 'max-inline-size'];
const KEYWORDS = ['min-content', 'max-content', 'fit-content', 'stretch', '-webkit-fill-available', '-webkit-min-content', '-webkit-max-content', '-webkit-fit-content', 'Stretch', '-WEBKIT-FILL-AVAILABLE'];
// css-sizing-4 values and spellings Chrome 145 does not take, beside lengths, auto and none.
const OTHER = ['contain', 'fit-content(10px)', '-webkit-fit-content(10px)', 'fill-available', '-moz-available', 'content', 'auto', 'none', '10px', '50%', '-1px', 'calc(10px + 5%)', 'stretch stretch', 'min-content 10px'];
const VALUES: readonly (readonly [string, string])[] = [
  ...SIZES.flatMap((p) => [...KEYWORDS, ...OTHER].map((v) => [p, v] as const)),
  ...[...KEYWORDS, ...OTHER].map((v) => ['flex-basis', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === null) {
      if (!s.parsed) return [`${it.p}: ${it.v}: accepted, Chrome drops it`];
      return s.authored === s.dragon ? [] : [`${it.p}: ${it.v}: Chrome computes ${s.authored}, Dragon's ${String(it.value)} computes ${s.dragon}`];
    }
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.p}: ${it.v}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${it.p}: ${it.v}: refused as unsupported, Chrome drops it`];
    return [`${it.p}: ${it.v}: unexpected ${it.code}`];
  });
}

describe('sizing keywords: Chrome 145 parsing and computed values', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon accepts exactly the values Chrome parses and computes them alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'fillAvailableAsMaxContent', items: real.filter((it) => it.v === '-webkit-fill-available' && it.p.startsWith('m')).map((it) => ({ ...it, value: 'max-content' })) },
      { name: 'containAccepted', items: real.filter((it) => it.v === 'contain').map((it) => ({ ...it, code: null, value: 'contain' })) },
      { name: 'prefixedFlexBasisAccepted', items: real.filter((it) => it.p === 'flex-basis' && it.v === '-webkit-min-content').map((it) => ({ ...it, code: null, value: 'min-content' })) },
      { name: 'stretchInvalid', items: real.filter((it) => it.v === 'stretch').map((it) => ({ ...it, code: 'DRAGON_CSS_INVALID_VALUE', value: null })) },
    ];
    for (const p of planted) expect(p.items.length, p.name).toBeGreaterThan(0);
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="width: 300px; height: 200px; display: flex"><div id="a">x</div><div id="c">x</div></div>');
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
    for (const p of [...SIZES, 'flex-basis']) expect(real.filter((it) => it.p === p && it.code === null).length, p).toBeGreaterThan(6);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
