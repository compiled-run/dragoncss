// The font-variant longhands and shorthand against Chrome 145 (webref grammars, properties/font-variant.ts, shorthands/font-variant.ts):
// Dragon takes a value as valid exactly when Chrome parses it, and each value it keeps sets every font-variant longhand as Chrome
// computes it (the keywords in Chrome's order, normal for what a shorthand omits). The caps, position and emoji keywords and the
// alternates functions parse in Chrome and are refused by Dragon, so only their validity is compared. Each planted reading must be caught.
// One grammar gap is pinned: Chrome takes a repeated historical-forms, which Dragon refuses as invalid.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { FONT_VARIANT_LONGHANDS } from '../../dragon/src/css/properties/font-variant.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/font-variant.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly set: { readonly [longhand: string]: string } };
type Seen = { readonly parsed: boolean; readonly computed: { readonly [longhand: string]: string } };

/** Dragon's reading of `p: v`: its diagnostic code, or the font-variant longhands it sets. */
function item(p: string, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && longhands.length === 0) throw new Error(`${p}: ${v}: accepted without a longhand`);
  return { p, v, code, set: code === null ? Object.fromEntries(longhands.map((l) => [l.property, valueToString(l.value)])) : {} };
}

const VALUES: readonly (readonly [string, string])[] = [
  ...['normal', 'none', 'common-ligatures', 'no-common-ligatures', 'contextual discretionary-ligatures', 'no-contextual historical-ligatures no-discretionary-ligatures common-ligatures', 'NO-COMMON-LIGATURES',
    // dropped: none with another, a group twice, an unknown keyword
    'none common-ligatures', 'common-ligatures no-common-ligatures', 'normal contextual', 'ligatures'].map((v) => ['font-variant-ligatures', v] as const),
  ...['normal', 'tabular-nums', 'slashed-zero ordinal', 'stacked-fractions oldstyle-nums proportional-nums', 'ordinal lining-nums diagonal-fractions tabular-nums slashed-zero',
    'tabular-nums proportional-nums', 'ordinal ordinal', 'none'].map((v) => ['font-variant-numeric', v] as const),
  ...['normal', 'ruby', 'full-width jis78', 'ruby proportional-width traditional', 'simplified', 'jis04 jis90', 'none'].map((v) => ['font-variant-east-asian', v] as const),
  ...['normal', 'historical-forms', 'HISTORICAL-FORMS', 'none', 'historical-forms historical-forms',
    // Chrome parses the functions; Dragon refuses them
    'stylistic(a)', 'swash(a) historical-forms'].map((v) => ['font-variant-alternates', v] as const),
  ...['normal', 'small-caps', 'all-small-caps', 'titling-caps', 'none', 'small-caps unicase'].map((v) => ['font-variant-caps', v] as const),
  ...['normal', 'sub', 'super', 'none', 'sub super'].map((v) => ['font-variant-position', v] as const),
  ...['normal', 'emoji', 'text', 'unicode', 'none', 'auto'].map((v) => ['font-variant-emoji', v] as const),
  ...['normal', 'none', 'common-ligatures', 'no-contextual tabular-nums', 'jis04 historical-forms slashed-zero', 'full-width ruby oldstyle-nums discretionary-ligatures',
    // refused: caps, position, emoji, an alternates function
    'small-caps', 'tabular-nums sub', 'emoji', 'styleset(a)',
    // dropped
    'none tabular-nums', 'normal ruby', 'tabular-nums tabular-nums', 'common-ligatures no-common-ligatures', 'bold'].map((v) => ['font-variant', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${at}: refused, Chrome drops it`];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    // Every longhand: the one set, or for a longhand the value leaves alone the parent's (inherited) value.
    return Object.entries(it.set).filter(([l, v]) => s.computed[l] !== v).map(([l, v]) => `${at}: Chrome computes ${l} ${String(s.computed[l])}, Dragon ${v}`);
  });
}

describe('font-variant: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, each kept value sets the longhands Chrome sets, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const as = (p: string, v: string, set: { readonly [l: string]: string }): Item => ({ p, v, code: null, set });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'authorOrderKept', items: [as('font-variant-numeric', 'slashed-zero ordinal', { 'font-variant-numeric': 'slashed-zero ordinal' })] },
      { name: 'shorthandOmittedKept', items: [as('font-variant', 'common-ligatures', { 'font-variant-ligatures': 'common-ligatures', 'font-variant-numeric': 'tabular-nums' })] },
      { name: 'noneSetsAll', items: [as('font-variant', 'none', { 'font-variant-ligatures': 'none', 'font-variant-numeric': 'none' })] },
      { name: 'duplicateAccepted', items: [as('font-variant-east-asian', 'jis04 jis90', { 'font-variant-east-asian': 'jis04' })] },
      { name: 'historicalRejected', items: [{ p: 'font-variant-alternates', v: 'historical-forms', code: 'DRAGON_CSS_INVALID_VALUE', set: {} }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets every longhand off its initial value, so a longhand Dragon leaves out of a shorthand shows as inherited.
      await page.setContent('<!DOCTYPE html><div style="font-variant-ligatures: no-contextual; font-variant-numeric: tabular-nums; font-variant-east-asian: ruby; font-variant-alternates: historical-forms; font-variant-caps: unicase; font-variant-position: super; font-variant-emoji: text"><span id="a"></span></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        const cs = getComputedStyle(a);
        const computed = {};
        for (const l of ${JSON.stringify(FONT_VARIANT_LONGHANDS)}) computed[l] = cs.getPropertyValue(l);
        return { parsed, computed };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    // Chrome's alternates parser takes historical-forms more than once, outside the webref grammar: Dragon calls it invalid, an error
    // that blocks the build, so it is a refusal and never an acceptance.
    const GRAMMAR_GAPS = ['font-variant-alternates: historical-forms historical-forms: invalid, Chrome parses it'];
    expect(judge(real, seen[0] as Seen[]).filter((p) => !GRAMMAR_GAPS.includes(p))).toEqual([]);
    expect(judge(real, seen[0] as Seen[]).filter((p) => GRAMMAR_GAPS.includes(p))).toEqual(GRAMMAR_GAPS);
    expect(real.filter((it) => it.code === null).length).toBeGreaterThan(25);
    expect(real.filter((it) => it.code === 'DRAGON_UNSUPPORTED_VALUE').length).toBeGreaterThan(10);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBeGreaterThan(15);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
