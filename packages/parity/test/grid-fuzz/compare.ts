// The grid differential fuzzer's comparison: Dragon's result for each declaration, through the whole parse driver (webref grammar
// then the grid hook) and through the grid hook alone (grid-values.ts parseGridValue, no grammar), classified against what Chrome
// 145 parsed and computed. packages/parity/test/grid-fuzz.test.ts runs it in Chrome; this module needs no browser.
import { parse } from 'css-tree';
import type { LinkedElement } from '../../../dragon/src/analysis/link.ts';
import { resolveTree, valueToString } from '../../../dragon/src/analysis/resolve.ts';
import type { Longhand } from '../../../dragon/src/css/properties.ts';
import { NO_FAULTS } from '../../../dragon/src/faults.ts';
import { referenceDataset } from '../../../dragon/src/ua/datasets.ts';
import { list } from '../../../dragon/src/css/ast.ts';
import { canonicalizeEscapes, decodeName } from '../../../dragon/src/css/escapes.ts';
import { GRID_VALUE_PROPERTIES, parseGridValue } from '../../../dragon/src/css/grid-values.ts';
import { GRID_LONGHANDS } from '../../../dragon/src/css/properties/grid.ts';
import { parseStylesheet } from '../../../dragon/src/css/stylesheet.ts';
import { CSS_WIDE } from '../../../dragon/src/css/values.ts';
import type { Diagnostic } from '../../../dragon/src/types.ts';

const SOURCE = { uri: 'dragon-source://test/grid-fuzz.css', revision: 'r1', hash: 'sha256:0' };

/** Dragon's result: ok with its longhands as CSS text, invalid (DRAGON_CSS_INVALID_VALUE) or refused (any other code). */
export type DragonResult = { readonly kind: 'ok'; readonly longhands: readonly (readonly [string, string])[] } | { readonly kind: 'invalid' } | { readonly kind: 'refused'; readonly code: string };

/** resolved: Dragon's computed values of the compared longhands (the text its web CSS writes) when the driver accepts the value. */
export type FuzzItem = { readonly p: string; readonly v: string; readonly full: DragonResult; readonly hook: DragonResult | null; readonly resolved: readonly string[] | null };

/**
 * What Chrome did: whether it parsed the authored value, its computed values of the compared longhands, and for each of Dragon's
 * accepted results, the problems of rendering it.
 */
export type ChromeSeen = { readonly parsed: boolean; readonly authored: readonly string[]; readonly full: readonly string[]; readonly hook: readonly string[] };

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
  if (!GRID_VALUE_PROPERTIES.has(p) || CSS_WIDE.has(decodeName(v.replace(/\/\*.*?\*\//g, '').trim()).toLowerCase())) return null;
  let failed = false;
  let node: ReturnType<typeof parse>;
  try {
    // parity's css-tree declarations omit the context option that the dragon package's declare.
    node = (parse as (text: string, options: object) => ReturnType<typeof parse>)(v, { context: 'value', positions: true, onParseError: () => { failed = true; } });
  } catch {
    return { kind: 'invalid' };
  }
  if (failed) return { kind: 'invalid' };
  // The driver decodes escapes before the hook runs (escapes.ts).
  canonicalizeEscapes(node);
  const tokens = list(node, 'children').filter((n) => n.type !== 'WhiteSpace');
  if (tokens.length === 0) return { kind: 'invalid' };
  const r = parseGridValue(p, tokens, { source: SOURCE, start: 0, end: v.length });
  if (r.kind === 'ok') return { kind: 'ok', longhands: r.longhands.map((l) => [l.property, valueToString(l.value)] as const) };
  if (r.kind === 'refused') return { kind: 'refused', code: r.diagnostic.code };
  return { kind: 'invalid' };
}

/** Dragon's computed values of the compared longhands for the declaration on a div with font-size 10px, as the resolver gives them. */
export function dragonResolved(p: string, v: string): string[] | null {
  const css = `.a { font-size: 10px; ${p}: ${v}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return null;
  const origin = { kind: 'unlocated', reason: 'fuzz' } as const;
  const el = (id: string, tag: string, classes: string[], kids: LinkedElement[] = []): LinkedElement => ({
    kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'doc', sheet: 's', name })), attributes: new Map(), children: kids,
    node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
  });
  const root = resolveTree(el('html', 'html', [], [el('body', 'body', [], [el('a', 'div', ['a'])])]), rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const body = root.children[0];
  const a = body !== undefined && body.kind === 'element' ? body.children[0] : undefined;
  if (a === undefined || a.kind !== 'element') throw new Error('no resolved div');
  return COMPARED_LONGHANDS.map((l) => valueToString((a.props.get(l as Longhand) as { value: Parameters<typeof valueToString>[0] }).value));
}

export const fuzzItem = ([p, v]: readonly [string, string]): FuzzItem => {
  const full = dragonFull(p, v);
  return { p, v, full, hook: dragonHook(p, v), resolved: full.kind === 'ok' ? dragonResolved(p, v) : null };
};

// Chrome's display of a computed number (Blink FormatNumber): the stored value (a float for lengths, percentages and flex, which
// saturate at the LayoutUnit maximum for px; an int for integers, which Dragon already clamps) with 6 significant digits, ties to
// even, in %g form.
const LAYOUT_UNIT_MAX = 33554431.984375;

/** x rounded to 6 significant digits with ties to even, in C's %g form (1e+07, 1.5e-06, 37.7953). */
export function formatG6(x: number): string {
  if (x === 0) return '0';
  const sign = x < 0 ? '-' : '';
  const exact = Math.abs(x).toFixed(100).replace(/0+$/, '').replace(/\.$/, '');
  const [intPart, fracPart = ''] = exact.split('.') as [string, string?];
  const digits = (intPart === '0' ? '' : intPart) + fracPart;
  const lead = digits.search(/[1-9]/);
  let exp = intPart === '0' ? -(lead - (intPart === '0' ? 0 : 0) + 1) + 0 : intPart.length - 1;
  if (intPart === '0') exp = -(fracPart.search(/[1-9]/) + 1);
  const sig = digits.slice(lead);
  let head = sig.slice(0, 6).padEnd(6, '0');
  const rest = sig.slice(6);
  const roundUp = rest.length > 0 && (rest[0] as string) > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || Number(head[5]) % 2 === 1));
  if (roundUp) {
    const bumped = String(Number(head) + 1);
    if (bumped.length > 6) {
      head = bumped.slice(0, 6);
      exp += 1;
    } else head = bumped;
  }
  if (exp < -4 || exp >= 6) {
    const mant = `${head[0] as string}.${head.slice(1)}`.replace(/0+$/, '').replace(/\.$/, '');
    return `${sign}${mant}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  const point = exp + 1;
  const fixed = point <= 0 ? `0.${'0'.repeat(-point)}${head}` : `${head.slice(0, point).padEnd(point, '0')}.${head.slice(point)}`;
  return sign + fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** A number of Dragon's text as Chrome displays it, by its unit. */
function chromeDisplay(raw: string, unit: string): string {
  const x = Number(raw);
  if (unit === '') return formatG6(x);
  const clamped = unit === 'px' ? (x > LAYOUT_UNIT_MAX ? LAYOUT_UNIT_MAX : x < -LAYOUT_UNIT_MAX ? -LAYOUT_UNIT_MAX : x) : x;
  return formatG6(Math.fround(clamped));
}

const NUMBER_TOKEN = /(^|[\s(,[])([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(px|fr|%|)(?=$|[\s),\]])/gi;

/**
 * Dragon's computed text as Chrome would display it: every number through chromeDisplay, everything else byte for byte. Dragon keeps
 * the full value because the emitted CSS must give Chrome the value it computed; only the 6-digit display and range clamps differ.
 */
export const asChromeDisplays = (dragon: string): string => dragon.replace(NUMBER_TOKEN, (_m, pre: string, num: string, unit: string) => `${pre}${chromeDisplay(num, unit.toLowerCase())}${unit}`);

/** Values Chrome parses that Dragon reports invalid by design: anchor-center in justify-items is missing from the webref grammar. */
export function documentedGap(p: string, v: string): boolean {
  return p === 'justify-items' && /anchor-center/i.test(v);
}

export type FuzzClass =
  | 'agree-accept' | 'agree-drop' | 'refused-chrome-drops' | 'documented-refusal' | 'documented-gap'
  | 'bug:accept-chrome-drops' | 'bug:computed-differs' | 'bug:invalid-chrome-parses' | 'bug:serialization';

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
    return { parsed, authored, full: check(it.full), hook: check(it.hook) };
  })`;
}

/** Byte-exact: each of Dragon's computed values, displayed as Chrome displays numbers, equals Chrome's computed string. */
export function serializationProblems(it: FuzzItem, s: ChromeSeen): string[] {
  if (it.resolved === null || !s.parsed) return [];
  return COMPARED_LONGHANDS.flatMap((l, i) => {
    const mine = asChromeDisplays(it.resolved?.[i] as string);
    return mine === s.authored[i] ? [] : [`${l} Chrome "${s.authored[i] as string}" Dragon "${it.resolved?.[i] as string}" displayed "${mine}"`];
  });
}

export type FuzzReport = { readonly full: Record<string, number>; readonly hook: Record<string, number>; readonly serialization: number; readonly bugs: readonly string[] };

export function report(items: readonly FuzzItem[], seen: readonly ChromeSeen[]): FuzzReport {
  const full: Record<string, number> = {};
  const hook: Record<string, number> = {};
  const bugs: string[] = [];
  let serialization = 0;
  items.forEach((it, i) => {
    const s = seen[i] as ChromeSeen;
    const text = serializationProblems(it, s);
    if (text.length > 0) {
      serialization++;
      bugs.push(`resolved bug:serialization ${it.p}: ${it.v} (${text.join('; ')})`);
    }
    const f = classify(it.p, it.v, it.full, s.parsed, s.full);
    full[f] = (full[f] ?? 0) + 1;
    if (f.startsWith('bug:')) bugs.push(`full ${f} ${it.p}: ${it.v}${s.full.length > 0 ? ` (${s.full.join('; ')})` : ''}`);
    if (it.hook !== null) {
      const h = classify(it.p, it.v, it.hook, s.parsed, s.hook);
      hook[h] = (hook[h] ?? 0) + 1;
      if (h.startsWith('bug:')) bugs.push(`hook ${h} ${it.p}: ${it.v}${s.hook.length > 0 ? ` (${s.hook.join('; ')})` : ''}`);
    }
  });
  return { full, hook, serialization, bugs };
}
