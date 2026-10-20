// The text-shadow grammar against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, Blink TextShadow::ParseSingleValue): Dragon
// takes a value as valid exactly when Chrome parses it, and none computes alike. A shadow list parses and is then checked per target (TXT-FX,
// analysis/text-shadow.ts checkTextShadows), so only its validity is compared here. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/text-shadow.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly authored: string; readonly dragon: string };

function item(v: string): Item {
  const css = `.a { text-shadow: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${v}: more than one diagnostic`);
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const code = diagnostics[0]?.code ?? null;
  if (code === null && longhands.length !== 1) throw new Error(`${v}: accepted without exactly one longhand`);
  return { v, code, value: code === null ? valueToString((longhands[0] as (typeof longhands)[number]).value) : null };
}

const VALUES = [
  'none', 'NONE', '1px 1px', '1px 1px 2px', '1px 1px red', 'red 1px 1px', 'red 1px 1px 2px', '0 1px 2px rgba(0, 0, 0, 0.5)', '-2px -3px 0 #123',
  '1px 1px currentcolor', '1em 0.5em 1rem blue', '1px 1px, 2px 2px blue', '0 0 4px', '1px 1px 0px', '0 0',
  // Chrome forbids a spread, inset, a negative blur, a lone length, none inside a list, two colours and a unitless non-zero length.
  '1px 1px 1px 1px', 'inset 1px 1px', '1px 1px inset', '1px 1px -1px', '1px', 'none, 1px 1px', '1px 1px red blue', '1 1px', 'red', '1px 1px,', 'auto',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.v}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${it.v}: unexpected ${it.code}`];
    if (!s.parsed) return [`${it.v}: accepted, Chrome drops it`];
    return it.value === 'none' && s.authored !== s.dragon ? [`${it.v}: Chrome computes ${s.authored}, Dragon's none computes ${s.dragon}`] : [];
  });
}

describe('text-shadow: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, none computes alike, and the plants are caught', async () => {
    const real = VALUES.map((v) => item(v));
    const accept = (v: string): Item => ({ v, code: null, value: v });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'spreadAccepted', items: [accept('1px 1px 1px 1px')] },
      { name: 'insetAccepted', items: [accept('inset 1px 1px'), accept('1px 1px inset')] },
      { name: 'negativeBlurAccepted', items: [accept('1px 1px -1px')] },
      { name: 'listRejected', items: [{ v: '1px 1px, 2px 2px blue', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div style="text-shadow: 1px 1px red"><span id="a"></span><span id="c"></span></div>');
      // A string expression: this test project has no DOM types. The authored value on #a, Dragon's value on #c.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a'), c = document.getElementById('c');
        for (const e of [a, c]) e.removeAttribute('style');
        a.style.setProperty('text-shadow', it.v);
        const parsed = a.style.getPropertyValue('text-shadow') !== '';
        if (it.value !== null) c.style.setProperty('text-shadow', it.value);
        return { parsed, authored: getComputedStyle(a).getPropertyValue('text-shadow'), dragon: getComputedStyle(c).getPropertyValue('text-shadow') };
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
