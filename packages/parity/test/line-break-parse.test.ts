// The line-break grammar against Chrome 145 (webref's auto | loose | normal | strict | anywhere, properties/line-break.ts): Dragon takes
// a value as valid exactly when Chrome parses it, and each value it keeps computes as Chrome computes it. anywhere parses in Chrome and
// is refused by Dragon, so only its validity is compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/line-break.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly value: string };

/** Dragon's reading of `line-break: v`: its diagnostic code, or the value it sets. */
function item(v: string): Item {
  const css = `.a { line-break: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`line-break: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const l = (rules[0]?.declarations[0]?.longhands ?? []).find((x) => x.property === 'line-break');
  if (code === null && l === undefined) throw new Error(`line-break: ${v}: accepted without the longhand`);
  return { v, code, value: code === null && l !== undefined ? valueToString(l.value) : null };
}

const VALUES: readonly string[] = [
  'auto', 'loose', 'normal', 'strict', 'AUTO', 'Loose', 'STRICT',
  // Chrome parses anywhere; Dragon refuses it.
  'anywhere', 'ANYWHERE',
  // Chrome drops these.
  'none', 'manual', 'after-white-space', 'loose strict', 'strict normal', '0', 'break-all', 'anywhere auto',
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `line-break: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${at}: refused, Chrome drops it`];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    return it.value === s.value ? [] : [`${at}: Chrome computes ${s.value}, Dragon ${String(it.value)}`];
  });
}

describe('line-break: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, each kept value computes as in Chrome, and the plants are caught', async () => {
    const real = VALUES.map(item);
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'strictAsNormal', items: [{ v: 'strict', code: null, value: 'normal' }] },
      { name: 'anywhereAsAuto', items: [{ v: 'anywhere', code: null, value: 'auto' }] },
      { name: 'manualAccepted', items: [{ v: 'manual', code: null, value: 'auto' }] },
      { name: 'looseRejected', items: [{ v: 'loose', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
      { name: 'caseKept', items: [{ v: 'STRICT', code: null, value: 'STRICT' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets a non-initial value, so a value Dragon reads as inherited would show.
      await page.setContent('<!DOCTYPE html><div style="line-break: loose"><span id="a"></span></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty('line-break', it.v);
        const parsed = a.style.getPropertyValue('line-break') !== '';
        return { parsed, value: getComputedStyle(a).getPropertyValue('line-break') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).length).toBe(7);
    expect(real.filter((it) => it.code === 'DRAGON_UNSUPPORTED_VALUE').length).toBe(2);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBe(8);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
