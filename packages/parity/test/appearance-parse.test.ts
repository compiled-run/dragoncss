// The appearance parse against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, properties/appearance.ts): Dragon drops no
// value Chrome keeps, through appearance and its -webkit-appearance alias, and every keyword Dragon accepts Chrome keeps and computes
// to the keyword Dragon computes, on a div, which has no native appearance. Every other keyword is refused, so only the accepted
// values are compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/appearance.css', revision: 'r1', hash: 'sha256:0' };

/** code: Dragon's diagnostic, or null; value: the keyword Dragon computes when it accepts the value, else null. */
type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly computed: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const lh = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (lh.length !== 1 || lh[0]?.property !== 'appearance' || lh[0].value.kind !== 'keyword')) throw new Error(`${name}: ${v}: accepted without one appearance keyword`);
  const value = code === null && lh[0]?.value.kind === 'keyword' ? lh[0].value.value : null;
  return { name, v, code, value };
}

const VALUES: readonly string[] = [
  'none', 'NONE', 'auto', 'Auto', 'searchfield', 'textarea', 'checkbox', 'radio', 'menulist', 'listbox', 'meter', 'progress-bar', 'button',
  'BUTTON', 'textfield', 'menulist-button', 'Menulist-Button',
  'base-select', 'base', 'push-button', 'square-button', 'slider-horizontal', 'slider-vertical', 'sliderthumb-horizontal', 'inner-spin-button',
  'searchfield-cancel-button', 'media-slider', 'bogus', 'none auto', 'button button', '1px', '"none"', 'none, none',
];
const NAMES: readonly string[] = ['appearance', '-webkit-appearance'];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${it.name}: ${it.v}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return [];
    if (it.code !== null) return [`${it.name}: ${it.v}: unexpected ${it.code}`];
    if (!s.parsed) return [`${it.name}: ${it.v}: accepted, Chrome drops it`];
    return s.computed !== it.value ? [`${it.name}: ${it.v}: Chrome computes ${s.computed}, Dragon ${it.value}`] : [];
  });
}

describe('appearance: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted keyword computes alike from either name, and the plants are caught', async () => {
    const real = NAMES.flatMap((name) => VALUES.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'aliasDropped', items: [{ name: '-webkit-appearance', v: 'none', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
      { name: 'acceptedUnparsed', items: [{ name: 'appearance', v: 'bogus', code: null, value: 'bogus' }] },
      { name: 'caseKept', items: [{ name: 'appearance', v: 'BUTTON', code: null, value: 'BUTTON' }] },
      { name: 'autoReadAsNone', items: [{ name: 'appearance', v: 'auto', code: null, value: 'none' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><div id="a"></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        return { parsed, computed: getComputedStyle(a).getPropertyValue('appearance') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.value !== null).length).toBe(34);
    expect((seen[0] as Seen[]).filter((s) => s.parsed).length).toBeGreaterThanOrEqual(34);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
