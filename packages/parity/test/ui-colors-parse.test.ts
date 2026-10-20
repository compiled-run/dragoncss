// The caret-color and accent-color parse against Chrome 145 (scripts/gen-css-grammar.ts, properties/ui-colors.ts): Dragon drops no
// value Chrome keeps, and every value Dragon accepts Chrome keeps and computes to what Dragon writes, on a div of a fixed color: a
// colour as its rgb() (transparent as rgba(0, 0, 0, 0)), auto as auto for accent-color and as the div's color for caret-color, currentcolor as the div's color. A
// colour outside Dragon's subset is refused, so only accepted values are compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import { valueText } from '../../dragon/src/emit/web-css.ts';

const SOURCE = { uri: 'dragon-source://test/ui-colors.css', revision: 'r1', hash: 'sha256:0' };
const COLOR = 'rgb(1, 2, 3)';

/** code: Dragon's diagnostic, or null; value: the computed value Chrome must report when Dragon accepts the value, else null. */
type Item = { readonly name: string; readonly v: string; readonly code: string | null; readonly value: string | null };
type Seen = { readonly parsed: boolean; readonly computed: string };

function item(name: string, v: string): Item {
  const css = `.a { ${name}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${name}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const lh = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && (lh.length !== 1 || lh[0]?.property !== name)) throw new Error(`${name}: ${v}: accepted without one ${name} longhand`);
  const value = code === null ? lh[0]?.value : undefined;
  if (value === undefined) return { name, v, code, value: null };
  const kw = value.kind === 'keyword' ? value.value : null;
  const computed = kw === 'currentcolor' || (kw === 'auto' && name === 'caret-color') ? COLOR : kw === 'transparent' ? 'rgba(0, 0, 0, 0)' : valueText(value);
  return { name, v, code, value: computed };
}

const VALUES: readonly string[] = [
  'auto', 'AUTO', 'red', 'Blue', 'transparent', 'currentcolor', 'currentColor', '#abc', '#12345678', 'rgb(1 2 3 / 50%)', 'rgba(200, 100, 0, 0.25)',
  'hsl(120 50% 50%)', 'hsla(300, 40%, 60%, 0.5)',
  'color-mix(in srgb, red, blue)', 'oklch(0.5 0.1 120)', 'Canvas', 'AccentColor',
  'auto auto', 'red blue', 'red auto', 'auto red', 'none', '1px', '"red"', 'red, blue',
];
const NAMES: readonly string[] = ['caret-color', 'accent-color'];

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

describe('caret-color and accent-color: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon drops no value Chrome keeps, every accepted value computes alike, and the plants are caught', async () => {
    const real = NAMES.flatMap((name) => VALUES.map((v) => item(name, v)));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'twoKept', items: [{ name: 'caret-color', v: 'red blue', code: null, value: 'rgb(255, 0, 0)' }] },
      { name: 'colorDropped', items: [{ name: 'accent-color', v: 'red', code: 'DRAGON_CSS_INVALID_VALUE', value: null }] },
      { name: 'caretAutoKept', items: [{ name: 'caret-color', v: 'auto', code: null, value: 'auto' }] },
      { name: 'accentAutoResolved', items: [{ name: 'accent-color', v: 'auto', code: null, value: COLOR }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      await page.setContent(`<!DOCTYPE html><div id="a" style="color: ${COLOR}"></div>`);
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.style.removeProperty('caret-color');
        a.style.removeProperty('accent-color');
        a.style.setProperty(it.name, it.v);
        const parsed = a.style.getPropertyValue(it.name) !== '';
        return { parsed, computed: getComputedStyle(a).getPropertyValue(it.name) };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.value !== null).length).toBe(26);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
