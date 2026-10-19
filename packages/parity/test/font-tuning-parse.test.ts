// font-kerning, font-optical-sizing and font-language-override against Chrome 145 (webref grammars, properties/font-tuning.ts):
// Dragon takes a value as valid exactly when Chrome parses it, and each value it keeps computes as Chrome computes it. Each planted
// reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/font-tuning.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly value: string };

/** Dragon's reading of `p: v`: its diagnostic code, or the value it sets. */
function item(p: string, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const l = (rules[0]?.declarations[0]?.longhands ?? []).find((x) => x.property === p);
  if (code === null && l === undefined) throw new Error(`${p}: ${v}: accepted without the longhand`);
  return { p, v, code, value: code === null && l !== undefined ? valueToString(l.value) : null };
}

const VALUES: readonly (readonly [string, string])[] = [
  ...['auto', 'normal', 'none', 'NONE', 'Normal', 'auto none', 'off', '0', '"none"'].map((v) => ['font-kerning', v] as const),
  ...['auto', 'none', 'AUTO', 'normal', 'auto auto', '1'].map((v) => ['font-optical-sizing', v] as const),
  ...['normal', '"TRK"', "'SRB'", '"DEU "', '"DE  "', '"T"', '"trk"', '"TR K"', '" TRK"', 'NORMAL', 'TRK', '"TRK" "SRB"', 'none', '0', '""', '"ABCDE"', '"\u00c4BC"'].map((v) => ['font-language-override', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${at}: refused, Chrome drops it`];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    return it.value === s.value ? [] : [`${at}: Chrome computes ${s.value}, Dragon ${String(it.value)}`];
  });
}

describe('font-kerning, font-optical-sizing and font-language-override: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, each kept value computes as in Chrome, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'normalAsAuto', items: [{ p: 'font-kerning', v: 'normal', code: null, value: 'auto' }] },
      { name: 'opticalNormalAccepted', items: [{ p: 'font-optical-sizing', v: 'normal', code: null, value: 'auto' }] },
      { name: 'overrideIdentAccepted', items: [{ p: 'font-language-override', v: 'TRK', code: null, value: '"TRK"' }] },
      { name: 'overrideUnquoted', items: [{ p: 'font-language-override', v: '"TRK"', code: null, value: 'TRK' }] },
      { name: 'noneRejected', items: [{ p: 'font-kerning', v: 'none', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets each property off its initial value, so a value Dragon reads as inherited would show.
      await page.setContent('<!DOCTYPE html><div style="font-kerning: none; font-optical-sizing: none; font-language-override: &quot;NLD&quot;"><span id="a"></span></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        return { parsed, value: getComputedStyle(a).getPropertyValue(it.p) };
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
