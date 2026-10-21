// font-size-adjust against Chrome 145 (Blink ConsumeFontSizeAdjust, css-fonts-5 §2.6): Dragon takes a value as valid exactly when
// Chrome parses it, and none, the only value it keeps, computes as Chrome computes it. Every other value Chrome parses (a number,
// from-font, either after a metric keyword, a calculation) is refused (properties/font-size-adjust.ts, TXT-FSA), so only its validity
// is compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/font-size-adjust.css', revision: 'r1', hash: 'sha256:0' };
const P = 'font-size-adjust';

type Item = { readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(v: string): Item {
  const css = `.a { ${P}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${v}: more than one diagnostic`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const code = diagnostics[0]?.code ?? null;
  if (code === null && longhands.length !== 1) throw new Error(`${v}: accepted without exactly one longhand`);
  return { v, code, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES: readonly string[] = [
  // Accepted.
  'none', 'NONE', 'None',
  // Chrome parses these; Dragon refuses them.
  '0', '0.5', '1', '2.25', '1e0', 'from-font', 'FROM-FONT', 'ex-height 0.5', 'cap-height 0.7', 'ch-width 0.5', 'ic-width 1', 'ic-height 1',
  'ex-height from-font', 'cap-height from-font', 'calc(0.5)', 'calc(0.25 + 0.25)', 'ex-height calc(0.5)', 'calc(-1)',
  // Chrome drops these: a negative number, a metric keyword alone or after its value, two numbers, a length, a percentage, auto,
  // none with a number, two keywords.
  '-1', '-0.5', 'ex-height', '0.5 ex-height', '0.5 0.5', '10px', '50%', 'auto', 'none 0.5', 'ex-height cap-height 0.5', 'from-font 0.5',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${P}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${at}: refused, Chrome drops it`];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    return s.authored !== s.dragon ? [`${at}: Chrome computes ${s.authored}, Dragon's ${it.value as string} computes ${s.dragon}`] : [];
  });
}

describe('font-size-adjust: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, none computes alike, and the plants are caught', async () => {
    const real = VALUES.map(item);
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'negativeAccepted', items: [{ v: '-1', code: 'DRAGON_UNSUPPORTED_VALUE', value: null }] },
      { name: 'metricAloneAccepted', items: [{ v: 'ex-height', code: 'DRAGON_UNSUPPORTED_VALUE', value: null }] },
      { name: 'fromFontInvalid', items: [{ v: 'from-font', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
      { name: 'noneKeptAsNumber', items: [{ v: 'none', code: null, value: '0.5' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent's font-size-adjust is not initial, so a value that does not apply (and inherits) shows.
      await page.setContent('<!DOCTYPE html><div style="font-size-adjust: 0.25"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty('${P}', it.v);
        const parsed = a.style.getPropertyValue('${P}') !== '';
        if (it.value !== null) c.style.setProperty('${P}', it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue('${P}'), dragon: getComputedStyle(c).getPropertyValue('${P}') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).map((it) => it.value)).toEqual(['none', 'none', 'none']);
    expect(real.filter((it) => it.code === 'DRAGON_UNSUPPORTED_VALUE').length).toBe(18);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBe(11);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
