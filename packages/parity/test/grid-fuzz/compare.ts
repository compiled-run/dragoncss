// The grid differential fuzzer's comparison: Dragon's result for each declaration, through the whole parse driver (webref grammar
// then the grid hook) and through the grid hook alone (grid-values.ts parseGridValue, no grammar), classified against what Chrome
// 145 parsed and computed. packages/parity/test/grid-fuzz.test.ts runs it in Chrome; this module needs no browser.
import { parse } from 'css-tree';
import { valueToString } from '../../../dragon/src/analysis/resolve.ts';
import { list } from '../../../dragon/src/css/ast.ts';
import { GRID_VALUE_PROPERTIES, parseGridValue } from '../../../dragon/src/css/grid-values.ts';
import { GRID_LONGHANDS } from '../../../dragon/src/css/properties/grid.ts';
import { parseStylesheet } from '../../../dragon/src/css/stylesheet.ts';
import { CSS_WIDE } from '../../../dragon/src/css/values.ts';
import type { Diagnostic } from '../../../dragon/src/types.ts';

const SOURCE = { uri: 'dragon-source://test/grid-fuzz.css', revision: 'r1', hash: 'sha256:0' };

/** Dragon's result: ok with its longhands as CSS text, invalid (DRAGON_CSS_INVALID_VALUE) or refused (any other code). */
export type DragonResult = { readonly kind: 'ok'; readonly longhands: readonly (readonly [string, string])[] } | { readonly kind: 'invalid' } | { readonly kind: 'refused'; readonly code: string };

export type FuzzItem = { readonly p: string; readonly v: string; readonly full: DragonResult; readonly hook: DragonResult | null };

/** What Chrome did: whether it parsed the authored value, and for each of Dragon's accepted results, the problems of rendering it. */
export type ChromeSeen = { readonly parsed: boolean; readonly full: readonly string[]; readonly hook: readonly string[] };

export const COMPARED_LONGHANDS: readonly string[] = [...GRID_LONGHANDS, 'row-gap', 'column-gap'];

export function dragonFull(p: string, v: string): DragonResult {
  const css = `.a { ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  const d = diagnostics[0];
  if (d !== undefined) return d.code === 'DRAGON_CSS_INVALID_VALUE' ? { kind: 'invalid' } : { kind: 'refused', code: d.code };
  const decl = rules[0]?.declarations[0];
  return { kind: 'ok', longhands: (decl?.longhands ?? []).map((l) => [l.property, valueToString(l.value)] as const) };
}

/** The grid hook alone, as if the grammar had accepted the value; null for the gap aliases, which the hook does not parse. */
export function dragonHook(p: string, v: string): DragonResult | null {
  // The driver resolves CSS-wide keywords before the hook, which never sees them.
  if (!GRID_VALUE_PROPERTIES.has(p) || CSS_WIDE.has(v.replace(/\/\*.*?\*\//g, '').trim().toLowerCase())) return null;
  let failed = false;
  let node: ReturnType<typeof parse>;
  try {
    // parity's css-tree declarations omit the context option that the dragon package's declare.
    node = (parse as (text: string, options: object) => ReturnType<typeof parse>)(v, { context: 'value', positions: true, onParseError: () => { failed = true; } });
  } catch {
    return { kind: 'invalid' };
  }
  if (failed) return { kind: 'invalid' };
  const tokens = list(node, 'children').filter((n) => n.type !== 'WhiteSpace');
  if (tokens.length === 0) return { kind: 'invalid' };
  const r = parseGridValue(p, tokens, { source: SOURCE, start: 0, end: v.length });
  if (r.kind === 'ok') return { kind: 'ok', longhands: r.longhands.map((l) => [l.property, valueToString(l.value)] as const) };
  if (r.kind === 'refused') return { kind: 'refused', code: r.diagnostic.code };
  return { kind: 'invalid' };
}

export const fuzzItem = ([p, v]: readonly [string, string]): FuzzItem => ({ p, v, full: dragonFull(p, v), hook: dragonHook(p, v) });

/**
 * Values Chrome parses that Dragon reports invalid by design: anchor-center in justify-items is missing from the webref grammar,
 * and the webref lexer does not decode escapes (the CSS-ESC package).
 */
export function documentedGap(p: string, v: string): boolean {
  return (p === 'justify-items' && /anchor-center/i.test(v)) || v.includes('\\');
}

export type FuzzClass =
  | 'agree-accept' | 'agree-drop' | 'refused-chrome-drops' | 'documented-refusal' | 'documented-gap'
  | 'bug:accept-chrome-drops' | 'bug:computed-differs' | 'bug:invalid-chrome-parses';

export function classify(p: string, v: string, r: DragonResult, parsed: boolean, problems: readonly string[]): FuzzClass {
  if (r.kind === 'ok') {
    if (!parsed) return 'bug:accept-chrome-drops';
    return problems.length === 0 ? 'agree-accept' : 'bug:computed-differs';
  }
  if (r.kind === 'refused') return parsed ? 'documented-refusal' : 'refused-chrome-drops';
  if (!parsed) return 'agree-drop';
  return documentedGap(p, v) ? 'documented-gap' : 'bug:invalid-chrome-parses';
}

/** The browser-side check as a string expression (the test projects have no DOM types): items in, ChromeSeen per item out. */
export function chromeExpression(items: readonly FuzzItem[]): string {
  const payload = items.map((it) => ({ p: it.p, v: it.v, full: it.full.kind === 'ok' ? it.full.longhands : null, hook: it.hook !== null && it.hook.kind === 'ok' ? it.hook.longhands : null }));
  return `(${JSON.stringify(payload)}).map((it) => {
    const L = ${JSON.stringify(COMPARED_LONGHANDS)};
    const a = document.getElementById('a'), c = document.getElementById('c');
    const reset = (e) => { e.removeAttribute('style'); e.style.fontSize = '10px'; };
    reset(a);
    a.style.setProperty(it.p, it.v);
    const parsed = a.style.getPropertyValue(it.p) !== '';
    const ca = getComputedStyle(a);
    const authored = L.map((l) => ca.getPropertyValue(l));
    const check = (longhands) => {
      if (longhands === null) return [];
      reset(c);
      for (const [l, v] of longhands) c.style.setProperty(l, v);
      const out = longhands.filter(([l]) => c.style.getPropertyValue(l) === '').map(([l, v]) => 'Chrome drops ' + l + ': ' + v);
      const cc = getComputedStyle(c);
      L.forEach((l, i) => { if (cc.getPropertyValue(l) !== authored[i]) out.push(l + ' authored "' + authored[i] + '" Dragon "' + cc.getPropertyValue(l) + '"'); });
      return out;
    };
    return { parsed, full: check(it.full), hook: check(it.hook) };
  })`;
}

export type FuzzReport = { readonly full: Record<string, number>; readonly hook: Record<string, number>; readonly bugs: readonly string[] };

export function report(items: readonly FuzzItem[], seen: readonly ChromeSeen[]): FuzzReport {
  const full: Record<string, number> = {};
  const hook: Record<string, number> = {};
  const bugs: string[] = [];
  items.forEach((it, i) => {
    const s = seen[i] as ChromeSeen;
    const f = classify(it.p, it.v, it.full, s.parsed, s.full);
    full[f] = (full[f] ?? 0) + 1;
    if (f.startsWith('bug:')) bugs.push(`full ${f} ${it.p}: ${it.v}${s.full.length > 0 ? ` (${s.full.join('; ')})` : ''}`);
    if (it.hook !== null) {
      const h = classify(it.p, it.v, it.hook, s.parsed, s.hook);
      hook[h] = (hook[h] ?? 0) + 1;
      if (h.startsWith('bug:')) bugs.push(`hook ${h} ${it.p}: ${it.v}${s.hook.length > 0 ? ` (${s.hook.join('; ')})` : ''}`);
    }
  });
  return { full, hook, bugs };
}
