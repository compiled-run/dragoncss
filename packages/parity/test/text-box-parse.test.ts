// The text-box-trim, text-box-edge and text-box grammars against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, Blink
// ConsumeTextBoxTrim, ConsumeTextBoxEdge and TextBox::ParseShorthand): Dragon takes a value as valid exactly when Chrome parses it,
// and the longhands it sets compute as Chrome computes them. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/text-box.css', revision: 'r1', hash: 'sha256:0' };

type Property = 'text-box-trim' | 'text-box-edge' | 'text-box';
/** Dragon's reading of `p: v`: its diagnostic code, or the computed text-box-trim and text-box-edge it sets ('' where it sets none). */
type Item = { readonly p: Property; readonly v: string; readonly code: string | null; readonly trim: string | null; readonly edge: string | null };
type Seen = { readonly parsed: boolean; readonly trim: string; readonly edge: string };

function item(p: Property, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  if (code === null && longhands.length === 0) throw new Error(`${p}: ${v}: accepted without a longhand`);
  const of = (name: string): string | null => {
    const l = longhands.find((x) => x.property === name);
    return code !== null ? null : l === undefined ? '' : valueToString(l.value);
  };
  return { p, v, code, trim: of('text-box-trim'), edge: of('text-box-edge') };
}

const TRIMS = ['none', 'trim-start', 'trim-end', 'trim-both', 'TRIM-BOTH',
  // Chrome drops these.
  'auto', 'normal', 'trim-start trim-end', 'both', '0'];
const EDGES = ['auto', 'text', 'text text', 'text alphabetic', 'cap text', 'cap alphabetic', 'ex text', 'ex alphabetic', 'Text Alphabetic',
  // Chrome drops these: cap and ex need an under edge, alphabetic is no over edge, and auto takes no second value.
  'cap', 'ex', 'alphabetic', 'alphabetic text', 'text cap', 'auto text', 'text text text', 'ideographic', 'none'];
const SHORTHANDS = ['normal', 'none', 'auto', 'trim-both', 'trim-start', 'text', 'text alphabetic', 'cap alphabetic', 'trim-end text', 'text trim-end',
  'none auto', 'auto none', 'trim-both ex text', 'ex text trim-start', 'text text trim-start', 'NORMAL',
  // Chrome drops these.
  'normal trim-both', 'trim-both normal', 'trim-both trim-end', 'auto auto', 'cap', 'cap trim-both', 'text alphabetic text', 'trim-both cap', 'normal auto'];

const VALUES: readonly (readonly [Property, string])[] = [
  ...TRIMS.map((v) => ['text-box-trim', v] as const),
  ...EDGES.map((v) => ['text-box-edge', v] as const),
  ...SHORTHANDS.map((v) => ['text-box', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    const out: string[] = [];
    if (it.trim !== '' && it.trim !== s.trim) out.push(`${at}: Chrome computes text-box-trim ${s.trim}, Dragon ${String(it.trim)}`);
    if (it.edge !== '' && it.edge !== s.edge) out.push(`${at}: Chrome computes text-box-edge ${s.edge}, Dragon ${String(it.edge)}`);
    return out;
  });
}

describe('text-box: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, each kept value computes as in Chrome, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'loneCapAccepted', items: [{ p: 'text-box-edge', v: 'cap', code: null, trim: '', edge: 'cap' }] },
      { name: 'textTextKept', items: [{ p: 'text-box-edge', v: 'text text', code: null, trim: '', edge: 'text text' }] },
      { name: 'shorthandTrimNone', items: [{ p: 'text-box', v: 'text', code: null, trim: 'none', edge: 'text' }] },
      { name: 'shorthandNormalRejected', items: [{ p: 'text-box', v: 'normal', code: 'DRAGON_CSS_INVALID_VALUE', trim: null, edge: null }] },
      { name: 'underEdgeDropped', items: [{ p: 'text-box-edge', v: 'text alphabetic', code: null, trim: '', edge: 'text' }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets non-initial values, so an inherited text-box-edge Dragon kept from it would show; text-box-trim is not inherited.
      await page.setContent('<!DOCTYPE html><div style="text-box: trim-start ex alphabetic"><span id="a"></span></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets.map((items) => items.map((it) => [it.p, it.v])))}).map((items) => items.map(([p, v]) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty(p, v);
        const parsed = a.style.getPropertyValue(p) !== '';
        const cs = getComputedStyle(a);
        return { parsed, trim: cs.getPropertyValue('text-box-trim'), edge: cs.getPropertyValue('text-box-edge') };
      }))`)) as Seen[][];
    } finally {
      await browser.close();
    }
    expect(judge(real, seen[0] as Seen[])).toEqual([]);
    expect(real.filter((it) => it.code === null).length).toBe(5 + 9 + 16);
    expect(real.filter((it) => it.code === 'DRAGON_CSS_INVALID_VALUE').length).toBe(5 + 9 + 9);
    planted.forEach((p, i) => expect(judge(p.items, seen[i + 1] as Seen[]).length, p.name).toBe(p.items.length));
  }, 120_000);
});
