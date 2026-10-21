// The tab-size grammar against Chrome 145 (Blink TabSize::ParseSingleValue: a non-negative number first, then a non-negative
// length): Dragon takes a value as valid exactly when Chrome parses it, and each value Dragon keeps computes as Chrome computes the
// authored one (so a bare 0 stays the number 0). A calculation parses in Chrome and is refused by Dragon (properties/tab-size.ts),
// so only its validity is compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/tab-size.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(v: string): Item {
  const css = `.a { tab-size: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${v}: more than one diagnostic`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const code = diagnostics[0]?.code ?? null;
  if (code === null && longhands.length !== 1) throw new Error(`${v}: accepted without exactly one longhand`);
  return { v, code, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES = [
  '8', '4', '0', '2.5', '0.25', '1e1', '+3', '20px', '0px', '1.5em', '2rem', '10pt', '1in', '12PX',
  // Chrome parses a calculation; Dragon refuses it.
  'calc(2 * 3)', 'calc(2px + 1em)',
  // Chrome drops a negative value, a percentage, a keyword, two values and a non-length unit.
  '-1', '-1px', '-0.5', '10%', 'auto', 'normal', '4 4', '4deg', '4px 2', '1s',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.v}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${it.v}: refused, Chrome drops it`];
    if (it.code !== null) return [`${it.v}: unexpected ${it.code}`];
    if (!s.parsed) return [`${it.v}: accepted, Chrome drops it`];
    return s.authored !== s.dragon ? [`${it.v}: Chrome computes ${s.authored}, Dragon's ${it.value as string} computes ${s.dragon}`] : [];
  });
}

describe('tab-size: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, each kept value computes alike, and the plants are caught', async () => {
    const real = VALUES.map((v) => item(v));
    const as = (v: string, value: string): Item => ({ v, code: null, value });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'zeroAsLength', items: [as('0', '0px')] },
      { name: 'numberAsPx', items: [as('4', '4px'), as('2.5', '2.5px')] },
      { name: 'negativeAccepted', items: [as('-1', '-1'), as('-1px', '-1px')] },
      { name: 'percentAccepted', items: [as('10%', '10%')] },
      { name: 'lengthRejected', items: [{ v: '20px', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="tab-size: 3; font-size: 10px"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty('tab-size', it.v);
        const parsed = a.style.getPropertyValue('tab-size') !== '';
        if (it.value !== null) c.style.setProperty('tab-size', it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue('tab-size'), dragon: getComputedStyle(c).getPropertyValue('tab-size') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).length).toBeGreaterThan(10);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBeGreaterThan(8);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
