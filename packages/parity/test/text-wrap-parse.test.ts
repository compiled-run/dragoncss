// The text-wrap and text-wrap-style grammars against Chrome 145 (scripts/gen-css-grammar.ts SYNTAX_OVERRIDES, Blink TextWrapStyle
// and the text-wrap shorthand): Dragon takes a value as valid exactly when Chrome parses it, and each value it keeps sets the
// longhands Chrome sets (text-wrap-mode and text-wrap-style computed alike). balance and pretty parse in Chrome and are refused by
// Dragon (properties/text-wrap.ts), so only their validity is compared. Each planted reading must be caught.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../dragon/src/index.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';

const SOURCE = { uri: 'dragon-source://test/text-wrap.css', revision: 'r1', hash: 'sha256:0' };

type Item = { readonly p: string; readonly v: string; readonly code: string | null; readonly mode: string | null; readonly style: string | null };
type Seen = { readonly parsed: boolean; readonly mode: string; readonly style: string };

/** Dragon's reading of `p: v`: its diagnostic code, or the text-wrap-mode and text-wrap-style it sets (null where it sets none). */
function item(p: string, v: string): Item {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 1) throw new Error(`${p}: ${v}: more than one diagnostic`);
  const code = diagnostics[0]?.code ?? null;
  const longhands = rules[0]?.declarations[0]?.longhands ?? [];
  const of = (name: string): string | null => {
    const l = longhands.find((x) => x.property === name);
    return l === undefined ? null : valueToString(l.value);
  };
  if (code === null && longhands.length === 0) throw new Error(`${p}: ${v}: accepted without a longhand`);
  return { p, v, code, mode: code === null ? of('text-wrap-mode') : null, style: code === null ? of('text-wrap-style') : null };
}

const VALUES: readonly (readonly [string, string])[] = [
  ...['nowrap', 'wrap', 'auto', 'stable', 'nowrap stable', 'stable nowrap', 'wrap auto', 'NOWRAP', 'Stable Wrap'].map((v) => ['text-wrap', v] as const),
  ...['auto', 'stable', 'STABLE'].map((v) => ['text-wrap-style', v] as const),
  // Chrome parses balance and pretty; Dragon refuses them.
  ...['balance', 'pretty', 'nowrap balance', 'pretty wrap'].map((v) => ['text-wrap', v] as const),
  ...['balance', 'pretty'].map((v) => ['text-wrap-style', v] as const),
  // Chrome drops two modes, two styles, css-text-4's avoid-orphans, none and a number.
  ...['nowrap wrap', 'auto stable', 'balance pretty', 'avoid-orphans', 'none', '1', 'nowrap nowrap'].map((v) => ['text-wrap', v] as const),
  ...['avoid-orphans', 'nowrap', 'wrap', 'auto stable', 'none'].map((v) => ['text-wrap-style', v] as const),
];

function judge(items: readonly Item[], seen: readonly Seen[]): string[] {
  return items.flatMap((it, i) => {
    const s = seen[i] as Seen;
    const at = `${it.p}: ${it.v}`;
    if (it.code === 'DRAGON_CSS_INVALID_VALUE') return s.parsed ? [`${at}: invalid, Chrome parses it`] : [];
    if (it.code === 'DRAGON_UNSUPPORTED_VALUE') return s.parsed ? [] : [`${at}: refused, Chrome drops it`];
    if (it.code !== null) return [`${at}: unexpected ${it.code}`];
    if (!s.parsed) return [`${at}: accepted, Chrome drops it`];
    const out: string[] = [];
    if (it.mode !== null && it.mode !== s.mode) out.push(`${at}: Chrome computes text-wrap-mode ${s.mode}, Dragon ${it.mode}`);
    if (it.style !== null && it.style !== s.style) out.push(`${at}: Chrome computes text-wrap-style ${s.style}, Dragon ${it.style}`);
    return out;
  });
}

describe('text-wrap: Chrome 145 parsing', () => {
  type Browser = { newPage(): Promise<{ setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> }>; close(): Promise<void> };

  it('Dragon takes as valid exactly the values Chrome parses, each kept value sets the longhands Chrome sets, and the plants are caught', async () => {
    const real = VALUES.map(([p, v]) => item(p, v));
    const as = (p: string, v: string, mode: string | null, style: string | null): Item => ({ p, v, code: null, mode, style });
    const planted: { readonly name: string; readonly items: Item[] }[] = [
      { name: 'styleNotReset', items: [as('text-wrap', 'nowrap', 'nowrap', 'stable')] },
      { name: 'modeNotReset', items: [as('text-wrap', 'stable', 'nowrap', 'stable')] },
      { name: 'avoidOrphansAccepted', items: [as('text-wrap-style', 'avoid-orphans', null, 'auto'), as('text-wrap', 'avoid-orphans', 'wrap', 'auto')] },
      { name: 'stableRejected', items: [{ p: 'text-wrap', v: 'stable', code: 'DRAGON_CSS_INVALID_VALUE', mode: null, style: null }] },
    ];
    const sets = [real, ...planted.map((p) => p.items)];
    const { launchChrome } = (await import(new URL('../src/chrome.ts', import.meta.url).href)) as { launchChrome: () => Promise<Browser> };
    const browser = await launchChrome();
    let seen: Seen[][];
    try {
      const page = await browser.newPage();
      // The parent sets the opposite of each initial value, so a longhand Dragon leaves out of a shorthand shows as inherited.
      await page.setContent('<!DOCTYPE html><div style="text-wrap-mode: nowrap; text-wrap-style: stable"><span id="a"></span></div>');
      // A string expression: this test project has no DOM types.
      seen = (await page.evaluate(`(${JSON.stringify(sets)}).map((items) => items.map((it) => {
        const a = document.getElementById('a');
        a.removeAttribute('style');
        a.style.setProperty(it.p, it.v);
        const parsed = a.style.getPropertyValue(it.p) !== '';
        const cs = getComputedStyle(a);
        return { parsed, mode: cs.getPropertyValue('text-wrap-mode'), style: cs.getPropertyValue('text-wrap-style') };
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
