// font-stretch against Chrome 145 (Blink FontStretch::ParseSingleValue and CSSValueFromComputedStyleInternal): Dragon takes a value
// as valid exactly when Chrome parses it, and computes each value it keeps to the percentage Chrome computes. A calculation parses
// in Chrome and is refused by Dragon (properties/font-stretch.ts), so only its validity is compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import type { ResolvedValue } from '../../dragon/src/analysis/computed.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { computeFontStretch } from '../../dragon/src/css/properties/font-stretch.ts';
import type { Longhand } from '../../dragon/src/css/properties.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/font-stretch.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly v: string; readonly code: string | null; readonly computed: string | null };
type Seen = { readonly parsed: boolean; readonly computed: string };

/** Dragon's reading of font-stretch: v, its diagnostic code or its computed value. */
function item(v: string): Item {
  const css = `.a { font-stretch: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  if (code !== null) return { v, code, computed: null };
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (longhands.length !== 1) throw new Error(`${v}: accepted without exactly one longhand`);
  const props = new Map<Longhand, ResolvedValue>([['font-stretch', { value: (longhands[0] as (typeof longhands)[number]).value, origin: 'author' } as unknown as ResolvedValue]]);
  computeFontStretch(props);
  return { v, code, computed: valueToString((props.get('font-stretch') as ResolvedValue).value) };
}

const VALUES = [
  'normal', 'ultra-condensed', 'extra-condensed', 'condensed', 'semi-condensed', 'semi-expanded', 'expanded', 'extra-expanded', 'ultra-expanded',
  'CONDENSED', '75%', '0%', '100%', '1000%', '62.5%', '33.333%',
  // Chrome parses a calculation; Dragon refuses it.
  'calc(50% + 25%)',
  // Chrome drops a negative percentage, a number, a length, two values and other keywords.
  '-10%', '75', '10px', 'condensed expanded', 'wide', 'narrower', 'auto', 'inherit-ish',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.v}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${it.v}: refused, Chrome drops it`];
    if (it.code !== null) return [`${it.v}: unexpected ${it.code}`];
    if (!s.parsed) return [`${it.v}: accepted, Chrome drops it`];
    return s.computed !== it.computed ? [`${it.v}: Chrome computes ${s.computed}, Dragon ${it.computed as string}`] : [];
  });
}

describe('font-stretch: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, computes each kept value as Chrome does, and the plants are caught', async () => {
    const real = VALUES.map((v) => item(v));
    const as = (v: string, computed: string): Item => ({ v, code: null, computed });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'keywordKept', items: [as('condensed', 'condensed'), as('normal', 'normal')] },
      { name: 'semiCondensedAt80', items: [as('semi-condensed', '80%')] },
      { name: 'extraCondensedAt60', items: [as('extra-condensed', '60%')] },
      { name: 'numberAccepted', items: [as('75', '75%')] },
      { name: 'percentRejected', items: [{ v: '75%', code: 'DRAGON_CSS_INVALID_VALUE', computed: null }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="font-stretch: 150%"><span id="a"></span></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty('font-stretch', it.v);
        return { parsed: a.style.getPropertyValue('font-stretch') !== '', computed: getComputedStyle(a).getPropertyValue('font-stretch') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).length).toBeGreaterThan(14);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBeGreaterThan(6);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
