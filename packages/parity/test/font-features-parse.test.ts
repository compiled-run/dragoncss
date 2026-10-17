// font-feature-settings and font-variation-settings against Chrome 145 (Blink ConsumeFontFeatureSettings and
// ConsumeFontVariationSettings): Dragon takes a value as valid exactly when Chrome parses it, and the value it keeps computes as
// Chrome computes the authored one. A calculation parses in Chrome and is refused by Dragon (properties/font-features.ts), so only
// its validity is compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/font-features.css', revision: 'r1', hash: 'sha256:0' };

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

const FEATURE = 'font-feature-settings';
const VARIATION = 'font-variation-settings';
const VALUES: readonly (readonly [string, string])[] = [
  ...['normal', 'NORMAL', '"liga"', '"liga" 1', '"liga" 0', '"liga" on', '"liga" OFF', '"ss01" 3', '"cv01" 99', "'tnum'", '"liga", "kern" 0', '"liga" 0, "liga" 1', '"a b "', '"~~~~"', '"liga" +2'].map((v) => [FEATURE, v] as const),
  ...['normal', '"wght" 500', '"wght" 0', '"wdth" 75.5', '"wght" -1', '"opsz" 12, "wght" 300', '"wght" 1e2', '"wght" 500, "wght" 600'].map((v) => [VARIATION, v] as const),
  // Chrome parses a calculation; Dragon refuses it.
  [FEATURE, '"liga" calc(1 + 1)'], [VARIATION, '"wght" calc(400 + 100)'],
  // Chrome drops a tag of three or five characters, an unquoted tag, a negative or fractional feature value, two values, a
  // dangling comma, normal in a list, a non-ASCII tag and a variation without a number or with a keyword.
  ...['"lig" 1', '"ligat"', 'liga', '"liga" -1', '"liga" 1.5', '"liga" 1 2', '"liga",', 'normal, "liga"', '"ligé"', '""'].map((v) => [FEATURE, v] as const),
  ...['"wght"', '"wght" on', '"wgh" 1', 'wght 500', '"wght" 500,', '"wght" 5px'].map((v) => [VARIATION, v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${at}: refused, Chrome drops it`];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    return s.authored !== s.dragon ? [`${at}: Chrome computes ${s.authored}, Dragon's ${it.value as string} computes ${s.dragon}`] : [];
  });
}

describe('font-feature-settings and font-variation-settings: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, each kept value computes alike, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const as = (p: string, v: string, value: string): Item => ({ p, v, code: null, value });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'offAsOne', items: [as(FEATURE, '"liga" OFF', '"liga"')] },
      { name: 'firstDuplicateKept', items: [as(FEATURE, '"liga" 0, "liga" 1', '"liga" 0')] },
      { name: 'threeLetterTagAccepted', items: [as(FEATURE, '"lig" 1', '"lig"'), as(VARIATION, '"wgh" 1', '"wgh" 1')] },
      { name: 'fractionalFeatureAccepted', items: [as(FEATURE, '"liga" 1.5', '"liga" 1.5')] },
      { name: 'negativeAxisRejected', items: [{ p: VARIATION, v: '"wght" -1', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="font-feature-settings: &quot;zero&quot;; font-variation-settings: &quot;slnt&quot; 3"><span id="a"></span><span id="c"></span></div>');
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
    expect(real.filter((it) => it.code === null).length).toBeGreaterThan(15);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBeGreaterThan(12);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
