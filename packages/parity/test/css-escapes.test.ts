// CSS-ESC differential check against the pinned Chrome 145: escaped keywords, function names, units, hash names, property and custom
// property names, !important, ids, classes, attribute names, values and flags, type and pseudo-class names. Three gates:
// - twins: every keyword the webref grammar of each subset property reaches, and a function and unit list, escaped several ways; Chrome
//   must read each escaped declaration exactly as its plain twin (the generator's premise), and so must Dragon (every declaration,
//   longhand and diagnostic equal);
// - edges: escapes that change the value (NUL, surrogates, a value past U+10FFFF, escapes at EOF, hex escapes followed by white space,
//   an escaped exponent or percent sign); Dragon's accepted declarations must compute as Chrome's, and its invalid ones be dropped;
// - selectors: Dragon's matches equal Chrome's Element.matches() on elements carrying the decoded names.
// Planted faults at each gate must be caught.
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../../dragon/src/analysis/link.ts';
import { selectorMatches } from '../../dragon/src/analysis/match.ts';
import { valueToString } from '../../dragon/src/analysis/resolve.ts';
import { properties as grammar, subset, types } from '../../dragon/src/css/grammar.generated.ts';
import { canonicalizeEscapes, preprocessInput } from '../../dragon/src/css/escapes.ts';
import { parseSelectorList } from '../../dragon/src/css/selectors.ts';
import type { Declaration, Rule, Selector } from '../../dragon/src/css/stylesheet.ts';
import { parseStylesheet } from '../../dragon/src/css/stylesheet.ts';
import type { CssValue } from '../../dragon/src/css/values.ts';
import type { VarPart } from '../../dragon/src/css/variables.ts';
import { NO_FAULTS } from '../../dragon/src/faults.ts';
import type { Diagnostic } from '../../dragon/src/types.ts';
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';

const SOURCE = { uri: 'dragon-source://test/escapes.css', revision: 'r1', hash: 'sha256:0' };
const USE = { id: 's', owner: 'doc', scope: 'document' } as const;
const load = async <T>(file: string): Promise<T> => (await import(new URL(`../src/${file}`, import.meta.url).href)) as T;
type Page = { setContent(html: string): Promise<void>; evaluate(expression: string): Promise<unknown> };
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

// ---- Dragon's reading of a declaration -------------------------------------------------------------------------------------

/** A rule's block text: eof leaves the block (and the escape ending it) unterminated, at the end of the input. */
const sheetOf = (decls: string, eof: boolean): string => `.a{${decls}${eof ? '' : '}'}`;

function dragonSheet(css: string): { rules: Rule[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, USE, 0, diagnostics);
  return { rules, diagnostics };
}

const IDENT = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
/** A CssValue as CSS text Chrome can set; a family name that is not an identifier is quoted. */
const cssText = (v: CssValue): string => (v.kind === 'family' && !IDENT.test(v.value) ? JSON.stringify(v.value) : valueToString(v));
const partsText = (parts: readonly VarPart[]): string =>
  parts.map((p) => (p.kind === 'text' ? p.text : `var(${p.name}${p.fallback === null ? '' : `,${partsText(p.fallback)}`})`)).join('');

/** What a declaration set in Chrome must equal: longhands with their values, a custom property with its text, or a pending value. */
function settable(d: Declaration): [string, string, string][] {
  const priority = d.important === true ? 'important' : '';
  if (d.custom !== undefined) return [[d.custom.name, d.custom.wide ?? partsText(d.custom.parts), priority]];
  if (d.pending !== undefined) return [[d.property, partsText(d.pending.parts), priority]];
  return d.longhands.map((l) => [l.property, cssText(l.value), priority]);
}

/**
 * Everything Dragon read from a declaration list except source positions and a custom property's text, for comparing twins; a
 * message quoting the authored text quotes it as written, so written is read as plain there.
 */
function summary(css: string, written: string, plain: string): string {
  const { rules, diagnostics } = dragonSheet(css);
  const decls = rules.flatMap((r) => r.declarations).map((d) => ({
    property: d.property,
    important: d.important === true,
    text: d.pending === undefined && d.custom === undefined ? d.text : null,
    longhands: d.longhands.map((l) => [l.property, l.explicit, l.direction ?? null, l.value]),
    custom: d.custom === undefined ? null : { name: d.custom.name, wide: d.custom.wide },
    pending: d.pending === undefined ? null : { longhands: d.pending.longhands, names: partsText(d.pending.parts) },
  }));
  return JSON.stringify({ decls, diagnostics: diagnostics.map((d) => [d.code, d.message.split(written).join(plain)]) });
}

// ---- Case generation -----------------------------------------------------------------------------------------------------

const hex = (c: string): string => (c.codePointAt(0) as number).toString(16);
const TERMINATORS = [' ', '\t', '\n', '\r\n', '\f'];

/**
 * Escaped spellings of a name with the plain spelling each stands for: a hex escape (rotating terminators, or six digits with none),
 * an identity escape, and an uppercase form.
 */
function spellings(name: string, seed: number): [string, string][] {
  const at = seed % name.length;
  const c = name[at] as string;
  const term = TERMINATORS[seed % (TERMINATORS.length + 1)];
  const hexForm = term === undefined ? `\\${hex(c).padStart(6, '0')}` : `\\${seed % 2 === 0 ? hex(c) : hex(c).toUpperCase()}${term}`;
  const out: [string, string][] = [[`${name.slice(0, at)}${hexForm}${name.slice(at + 1)}`, name]];
  const plain = [...name].findIndex((ch) => !/[0-9a-fA-F\n\r\f]/.test(ch));
  if (plain >= 0) out.push([`${name.slice(0, plain)}\\${name[plain] as string}${name.slice(plain + 1)}`, name]);
  if (seed % 3 === 0 && /^[a-z]/.test(name)) out.push([`\\${hex((name[0] as string).toUpperCase())} ${name.slice(1).toUpperCase()}`, name.toUpperCase()]);
  return out;
}

/** The keywords and function names a grammar reaches through its types and property references. */
function reach(syntax: string, words: Set<string>, fns: Set<string>, seen: Set<string>): void {
  const refs = [...syntax.matchAll(/<'?([a-z0-9-]+(?:\(\))?)'?(?:\s*\[[^\]]*\])?>/g)].map((m) => m[1] as string);
  for (const m of syntax.matchAll(/(?<![<'\w-])([a-z][a-z0-9-]*)\(/g)) fns.add(m[1] as string);
  const bare = syntax.replace(/<[^>]*>/g, ' ').replace(/'[^']*'/g, ' ').replace(/[a-z][a-z0-9-]*\(/g, ' ');
  for (const m of bare.matchAll(/(?<![\w-])([a-z][a-z0-9-]*)(?![\w-])/g)) words.add(m[1] as string);
  for (const r of refs) {
    if (seen.has(r)) continue;
    seen.add(r);
    const next = (types as Record<string, string>)[r] ?? (grammar as Record<string, { syntax: string }>)[r]?.syntax;
    if (next !== undefined) reach(next, words, fns, seen);
  }
}

/** An escaped declaration and its plain twin; written and plain are the parts that differ. */
type Twin = { readonly decl: string; readonly plain: string; readonly written: string; readonly plainPart: string };
const twin = (decl: string, plain: string, written: string, plainPart: string): Twin => ({ decl, plain, written, plainPart });

function twinCases(): Twin[] {
  const out: Twin[] = [];
  let seed = 0;
  for (const p of subset) {
    const words = new Set<string>();
    reach((grammar as Record<string, { syntax: string }>)[p]?.syntax ?? '', words, new Set(), new Set());
    for (const w of [...words].sort()) for (const [e, w0] of spellings(w, seed++)) out.push(twin(`${p}: ${e}`, `${p}: ${w0}`, e, w0));
    for (const [e, p0] of spellings(p, seed++)) out.push(twin(`${e}: inherit`, `${p0}: inherit`, e, p0));
  }
  for (const w of ['inherit', 'initial', 'unset', 'revert', 'revert-layer']) for (const [e, w0] of spellings(w, seed++)) out.push(twin(`width: ${e}`, `width: ${w0}`, e, w0));
  const functions: [string, string, string][] = [
    ['color', 'rgb', '(1, 2, 3)'], ['color', 'rgba', '(1, 2, 3, 0.5)'], ['color', 'hsl', '(120deg, 50%, 50%)'], ['color', 'hsla', '(120deg 50% 50% / 0.5)'],
    ['border-top-color', 'rgb', '(1 2 3)'], ['width', 'calc', '(10px + 5%)'], ['width', 'min', '(1px, 2px)'], ['width', 'max', '(1px, 2px)'],
    ['width', 'clamp', '(1px, 2px, 3px)'], ['width', 'fit-content', '(10px)'], ['grid-template-columns', 'repeat', '(2, 10px)'],
    ['grid-template-columns', 'minmax', '(10px, 1fr)'], ['grid-template-columns', 'fit-content', '(10px)'], ['grid-auto-rows', 'minmax', '(auto, 2fr)'],
  ];
  for (const [p, f, args] of functions) for (const [e, f0] of spellings(f, seed++)) out.push(twin(`${p}: ${e}${args}`, `${p}: ${f0}${args}`, `${e}${args}`, `${f0}${args}`));
  const units: [string, string, string][] = [
    ...['px', 'em', 'rem', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'vw', 'vh', 'vmin', 'vmax', 'ex', 'ch', 'lh', 'cqw', 'PX', 'Em'].map((u) => ['width', '10', u] as [string, string, string]),
    ['grid-template-columns', '1', 'fr'], ['grid-auto-columns', '2.5', 'fr'], ['font-size', '1.5', 'em'], ['line-height', '2', 'px'], ['margin-left', '-3', 'px'],
  ];
  for (const [p, n, u] of units) for (const [e, u0] of spellings(u, seed++)) out.push(twin(`${p}: ${n}${e}`, `${p}: ${n}${u0}`, `${n}${e}`, `${n}${u0}`));
  for (const [e, plain] of [['#\\66 00', '#f00'], ['#\\46 00', '#F00'], ['#a\\62 c', '#abc'], ['#\\31 23', '#123'], ['#\\000031 23456', '#123456'], ['#f0\\30 f', '#f00f']]) {
    out.push(twin(`color: ${e as string}`, `color: ${plain as string}`, e as string, plain as string), twin(`background-color: ${e as string}`, `background-color: ${plain as string}`, e as string, plain as string));
  }
  for (const [e, plain] of [
    ['display: flex !\\69mportant', 'display: flex !important'], ['display: flex !IMPORT\\41 NT', 'display: flex !important'],
    ['--\\61: 5px', '--a: 5px'], ['\\2d\\2d b: 5px', '--b: 5px'], ['-\\2d c: 5px', '--c: 5px'], ['--d\\ e: 5px', '--d\\ e: 5px'],
    ['--x: \\69nherit', '--x: inherit'],
    ['justify-self: \\66irst baseline', 'justify-self: first baseline'], ['align-items: \\6c ast \\62 aseline', 'align-items: last baseline'],
    ['font-family: \\41 rial', 'font-family: Arial'], ['font-family: \\73 erif', 'font-family: serif'],
    ['grid-template-areas: "\\61  b"', 'grid-template-areas: "a b"'], ['grid-template-columns: [\\61 bc] 10px', 'grid-template-columns: [abc] 10px'],
    ['grid-area: \\61 bc / 2', 'grid-area: abc / 2'], ['flex: \\6e one', 'flex: none'], ['border: 1\\70 x \\73olid r\\65 d', 'border: 1px solid red'],
  ] as const) out.push(twin(e, plain, e, plain));
  return out;
}

/** Escapes whose value differs from any plain spelling, each checked directly against Chrome. eof: the escape ends the input. */
type Edge = { readonly decl: string; readonly eof?: boolean };
const EDGES: readonly Edge[] = [
  { decl: 'display: \\0 block' }, { decl: 'display: \\0block' }, { decl: 'display: bl\\0ock' }, { decl: 'display: block\u0000' }, { decl: '--x: \u0000' },
  { decl: 'display: \\D800 block' }, { decl: 'display: \\DFFF block' }, { decl: 'display: \\110000 block' }, { decl: 'display: \\FFFFFF block' },
  { decl: 'display: \\1F600 block' }, { decl: 'display: \u{1F600}block' }, { decl: 'display: \\62  lock' }, { decl: 'display: \\62\t\tlock' },
  { decl: 'display: \\0000062lock' }, { decl: 'display: \\000062 lock' }, { decl: 'display: \\62\r\n lock' },
  { decl: 'display: block\\', eof: true }, { decl: 'display: \\', eof: true }, { decl: 'width: 1p\\', eof: true }, { decl: 'color: #f0\\', eof: true },
  { decl: '--x: a\\', eof: true }, { decl: '--x: 5px; width: var(--x\\', eof: true }, { decl: 'display: block !important\\', eof: true },
  { decl: 'font-family: "A\\\r\nB\\', eof: true }, { decl: 'font-family: "A\\\nB\\', eof: true }, { decl: 'font-family: "A\\\rB\\', eof: true },
  { decl: 'font-family: "A\\\fB\\', eof: true }, { decl: 'font-family: "A\\\r\nB"', eof: false }, { decl: '--x: "A\\\r\nB\\', eof: true },
  { decl: 'font-family: A\\', eof: true }, { decl: 'font-family: "A\r\n', eof: true },
  { decl: 'grid-column: \\17fpan 2' }, { decl: 'grid-column: \u017Fpan 2' }, { decl: 'grid-row-start: \\212a  2' }, { decl: 'display: bloc\\212a' },
  { decl: 'display: bloc\u212A' }, { decl: 'grid-row-start: \u212A 2' }, { decl: 'grid-row-start: \\130 nherit' }, { decl: 'display: \\131 nline' }, { decl: 'grid-row-start: \\212a uto' },
  { decl: 'width: 1\\65 3' }, { decl: 'width: 1\\45 3' }, { decl: 'width: 1\\65 -3' }, { decl: 'width: 1\\25' }, { decl: 'width: 1\\31 px' },
  { decl: 'width: 1\\-px' }, { decl: 'width: \\31 0px' }, { decl: 'width: \\2d 1px' }, { decl: 'color: \\#f00' }, { decl: 'color: #\\0 00' },
  { decl: 'grid-template-columns: [\\31 foo \\-] 10px' }, { decl: 'grid-template-columns: [\\1F600 a\\ b] 10px' }, { decl: 'grid-template-columns: [\\0] 10px' },
  { decl: 'grid-row-start: \\31 foo' }, { decl: 'grid-row-start: \\73 pan \\31 x' }, { decl: 'grid-row-start: \\D800' }, { decl: 'grid-template-columns: [\\D800] 10px' },
  { decl: 'grid-template-columns: repeat(\\61uto-fill, 10px)' }, { decl: 'grid: \\61uto-flow / 10px' }, { decl: 'grid: 10px / \\61uto-flow \\64 ense' },
  { decl: 'grid-template-columns: \\6d in-content 10px' }, { decl: 'grid-template-columns: \\73ubgrid' }, { decl: 'grid-template-rows: \\6eone' },
  { decl: 'grid-auto-columns: \\61uto' }, { decl: 'grid-auto-flow: \\64 ense' }, { decl: 'justify-self: \\63 enter' }, { decl: 'justify-items: \\6c egacy \\6c eft' },
  { decl: 'grid-row-start: \\69nherit' }, { decl: 'grid-row-start: span \\61uto' }, { decl: 'grid-row-start: \\64 efault' }, { decl: 'grid-row: \\61uto / 2' },
  { decl: 'font-family: \\31 abc' }, { decl: 'font-family: \\0' }, { decl: '--\\0: 1px; width: var(--\\0, 2px)' }, { decl: '--\\D800: 1px; width: var(--\uFFFD, 2px)' },
  { decl: '\\63 olor: red' }, { decl: 'c\\6f lor: red' }, { decl: '\\2d-: red' }, { decl: 'col\\0or: red' }, { decl: 'color: red !\\0important' },
  { decl: 'background: u\\72l(x.png)' }, { decl: 'font-family: A\\ B' }, { decl: '--x: 5px; width: var(--\\78)' }, { decl: '--x: 5px; width: v\\61r(--x)' },
  { decl: '--x: 5px; width: var(\\2d\\2d x, 1px)' }, { decl: '--x: 5px; width: var(-\\2d x, 1px)' }, { decl: '--\\61: 3px; width: var(--a)' }, { decl: 'width: v\\61r(--y, 4px)' }, { decl: 'width: \\76 ar(--y, 4px)' },
];

// ---- Selectors -----------------------------------------------------------------------------------------------------------

type El = { readonly tag: string; readonly id?: string; readonly classes?: readonly string[]; readonly attrs?: readonly (readonly [string, string])[] };
type SelectorCase = { readonly selector: string; readonly eof?: boolean };

const ELEMENTS: readonly El[] = [
  { tag: 'div', id: '1a', classes: ['1a', 'ab'], attrs: [['data-a', 'A'], ['data-x', 'a b']] },
  { tag: 'span', id: 'a b', classes: ['a\uFFFD', '\u{1F600}', 'x:y'], attrs: [['data-x', 'Ai'], ['title', 'A']] },
  { tag: 'p', id: '\uFFFD', classes: ['-', '--', '\uFFFDb', 'a\u{10FFFF}'], attrs: [['data-\uFFFD', '\uFFFD'], ['a|b', '1']] },
  { tag: 'div', id: '-1', classes: ['a', 'b'], attrs: [['data-a', 'a'], ['data-x', 'A']] },
];

const SELECTORS: readonly SelectorCase[] = [
  { selector: '.\\31 a' }, { selector: '.\\31a' }, { selector: '.a\\62' }, { selector: '.\\61 \\62' }, { selector: '.\\61  .b' }, { selector: '#\\31 a' },
  { selector: '#a\\ b' }, { selector: '#\\2d 1' }, { selector: '#-\\31' }, { selector: '#\\0' }, { selector: '#\\D800' }, { selector: '#\\110000' },
  { selector: '.a\\0' }, { selector: '.a\\DFFF' }, { selector: '.\\1F600' }, { selector: '.\\1f600' }, { selector: '.\u{1F600}' }, { selector: '.a\\10FFFF' },
  { selector: '.\\-' }, { selector: '.--' }, { selector: '.\\2d\\2d' }, { selector: '.x\\:y' }, { selector: '.\\0 b' }, { selector: '.\\0000000b' },
  { selector: '[data-\\41]' }, { selector: '[d\\61 ta-a=\\41]' }, { selector: '[data-x=\\41 i]' }, { selector: '[data-x=\\41  \\69]' }, { selector: '[data-x=\\41  I]' },
  { selector: '[data-x="\\41 i"]' }, { selector: '[data-x=a\\ b]' }, { selector: '[data-\\0]' }, { selector: '[data-\\0=\\0]' }, { selector: '[a\\|b]' },
  { selector: '[title=\\61 ]' }, { selector: '[data-a=a \\69]' }, { selector: '\\64 iv' }, { selector: '\\44 IV' }, { selector: 'd\\69 v.\\61' },
  { selector: '\\73 pan:\\6e ot(.\\78\\3a y)' }, { selector: ':\\72oot' }, { selector: 'div:\\66irst-child' }, { selector: ':n\\74h-child(\\6f dd)' },
  { selector: ':n\\74h-child(odd)' }, { selector: ':\\6e th-last-child(2 of .\\61)' }, { selector: ':\\77here(.\\31 a)' }, { selector: '.\\31 a:\\68 as(+ .\\31 a)' },
  { selector: ':\\69s(#\\31 a, .\\2d)' }, { selector: '.a\\', eof: true }, { selector: '#\\31', eof: true }, { selector: '[data-a=\\', eof: true },
  { selector: '.\\31 a,' }, { selector: 'div:\\68over' }, { selector: '.a\\\n' }, { selector: '#\uD800' }, { selector: '.\uD800' }, { selector: '#\u0000' }, { selector: '.a\u0000' }, { selector: '.\u0000a' },
];

const toLinked = (el: El, children: LinkedElement[] = []): LinkedElement => ({
  kind: 'element', address: el.tag, node: null as never, instance: '', owner: '', tag: el.tag,
  classes: (el.classes ?? []).map((name) => ({ owner: USE.owner, sheet: USE.id, name })),
  attributes: new Map<string, string>([...(el.id === undefined ? [] : [['id', el.id] as [string, string]]), ...(el.classes === undefined ? [] : [['class', el.classes.join(' ')] as [string, string]]), ...(el.attrs ?? [])]),
  children,
});

/** A selector ending at the input's end has no rule block, so its list is parsed alone, as Element.matches() parses it. */
function selectorAlone(text: string, diagnostics: Diagnostic[]): Selector[] | null | 'invalid' {
  let failed = false;
  let prelude: CssNode;
  const css = preprocessInput(text);
  try {
    prelude = (parse as (text: string, options: object) => CssNode)(css, { context: 'selectorList', positions: true, onParseError: () => { failed = true; } });
  } catch {
    return 'invalid';
  }
  if (failed) return 'invalid';
  canonicalizeEscapes(prelude);
  return parseSelectorList(prelude, { source: SOURCE, start: 0, end: css.length }, USE, diagnostics);
}

/** Dragon's match of each element (in a section under body), 'invalid' where it drops the rule, or the refusal's codes. */
function dragonMatches(c: SelectorCase): boolean[] | 'invalid' | string {
  const diagnostics: Diagnostic[] = [];
  const selectors = c.eof === true ? selectorAlone(c.selector, diagnostics) : dragonSheet(`${c.selector}{width:1px}`).rules[0]?.selectors ?? null;
  const { diagnostics: sheetDiagnostics } = c.eof === true ? { diagnostics } : dragonSheet(`${c.selector}{width:1px}`);
  if (selectors === 'invalid' || sheetDiagnostics.some((d) => d.code === 'DRAGON_SELECTOR_DROPPED' || d.code === 'DRAGON_CSS_PARSE')) return 'invalid';
  if (selectors === null || sheetDiagnostics.length > 0) return sheetDiagnostics.map((d) => d.code).join(',');
  const rule: Rule = { sheet: USE.id, owner: USE.owner, selectors, declarations: [] };
  const kids = ELEMENTS.map((e) => toLinked(e));
  const section = toLinked({ tag: 'section' }, kids);
  const body = toLinked({ tag: 'body' }, [toLinked({ tag: 'div' }), section]);
  const html = toLinked({ tag: 'html' }, [body]);
  return kids.map((k) => selectors.some((s) => selectorMatches(rule, s, [html, body, section, k], 3, 0, NO_FAULTS)));
}

// ---- Chrome ---------------------------------------------------------------------------------------------------------------

/** Chrome's declarations of each rule text as [property, value, priority], or null when the sheet holds no style rule. */
const chromeDeclared = (sheets: readonly string[]): string => `(${JSON.stringify(sheets)}).map((css) => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const rule = sheet.cssRules[0];
  if (rule === undefined || rule.style === undefined) return null;
  const out = [];
  for (let i = 0; i < rule.style.length; i++) { const p = rule.style[i]; out.push([p, rule.style.getPropertyValue(p), rule.style.getPropertyPriority(p)]); }
  return out;
})`;

type Declared = [string, string, string][] | null;

/** For each edge: the computed values of every property either side declares, on the authored rule and on Dragon's declarations. */
const chromeComputed = (items: readonly { chrome: Declared; dragon: [string, string, string][] }[]): string => `(${JSON.stringify(items)}).map((it) => {
  const a = document.getElementById('a'), c = document.getElementById('c');
  a.removeAttribute('style'); c.removeAttribute('style');
  for (const [p, v, pr] of it.chrome ?? []) a.style.setProperty(p, v, pr);
  for (const [p, v, pr] of it.dragon) c.style.setProperty(p, v, pr);
  const dropped = it.dragon.filter(([p]) => c.style.getPropertyValue(p) === '').map(([p, v]) => p + ': ' + v);
  const names = [...new Set([...(it.chrome ?? []).map(([p]) => p), ...it.dragon.map(([p]) => p), 'width', 'display', 'color'])];
  const ca = getComputedStyle(a), cc = getComputedStyle(c);
  const diff = names.filter((p) => ca.getPropertyValue(p) !== cc.getPropertyValue(p)).map((p) => p + ' authored "' + ca.getPropertyValue(p) + '" Dragon "' + cc.getPropertyValue(p) + '"');
  return { dropped, diff };
})`;

const chromeMatches = (selectors: readonly string[]): string => `(() => {
  const section = document.createElement('section');
  document.body.appendChild(section);
  const els = ${JSON.stringify(ELEMENTS)}.map((e) => {
    const el = document.createElement(e.tag);
    if (e.id !== undefined) el.id = e.id;
    if (e.classes !== undefined) el.className = e.classes.join(' ');
    for (const [n, v] of e.attrs ?? []) el.setAttribute(n, v);
    section.appendChild(el);
    return el;
  });
  return (${JSON.stringify(selectors)}).map((s) => { try { return els.map((el) => el.matches(s)); } catch { return 'invalid'; } });
})()`;

// ---- Judges ---------------------------------------------------------------------------------------------------------------

type TwinSeen = { readonly twin: Twin; readonly dragon: string; readonly dragonPlain: string; readonly chrome: Declared; readonly chromePlain: Declared };
const judgeTwins = (seen: readonly TwinSeen[]): string[] => seen.flatMap((s) => {
  const out: string[] = [];
  if (JSON.stringify(s.chrome) !== JSON.stringify(s.chromePlain)) out.push(`${JSON.stringify(s.twin.decl)}: Chrome reads it as ${JSON.stringify(s.chrome)}, its plain twin as ${JSON.stringify(s.chromePlain)}`);
  if (s.dragon !== s.dragonPlain) out.push(`${JSON.stringify(s.twin.decl)}: Dragon reads it as ${s.dragon}, its plain twin as ${s.dragonPlain}`);
  return out;
});

type EdgeItem = { readonly edge: Edge; readonly kind: 'ok' | 'invalid' | 'refused'; readonly codes: string; readonly dragon: [string, string, string][]; readonly nulReported: boolean };
function edgeItem(edge: Edge): EdgeItem {
  const { rules, diagnostics } = dragonSheet(sheetOf(edge.decl, edge.eof === true));
  const codes = diagnostics.map((d) => d.code).join(',');
  const dragon = rules.flatMap((r) => r.declarations).flatMap(settable);
  const kind = diagnostics.length === 0 ? 'ok' : diagnostics.every((d) => d.code === 'DRAGON_CSS_INVALID_VALUE' || d.code === 'DRAGON_CSS_PARSE') ? 'invalid' : 'refused';
  return { edge, kind, codes, dragon, nulReported: diagnostics.some((d) => d.code === 'DRAGON_CSS_PARSE' && d.message.includes('U+0000')) };
}
/**
 * Edges Dragon reports though Chrome parses them, each an error the author sees and never a wrong value. css-tree reads an escaped
 * url( as a function, where Chrome reads a url token; and a var( left open at the end of the input (with or without an escape) is
 * malformed to the var() splitter (variables.ts), where Chrome closes the block.
 */
const EDGE_GAPS: Record<string, string> = {
  'background: u\\72l(x.png)': 'css-tree tokenizes an escaped url( as a function token',
  '--x: 5px; width: var(--x\\': 'the var() splitter rejects a var( left open at the end of the input',
};
/** Edges Chrome parses that Dragon refuses as an unsupported feature once decoded, with the refusal's reason. */
const EDGE_REFUSALS: Record<string, string> = { 'grid-template-columns: \\73ubgrid': 'subgrid needs the grid engine and its subgrid package' };
type EdgeSeen = { readonly declared: Declared; readonly dropped: readonly string[]; readonly diff: readonly string[] };
const judgeEdges = (items: readonly EdgeItem[], seen: readonly EdgeSeen[]): string[] => items.flatMap((it, i) => {
  const s = seen[i] as EdgeSeen;
  const name = JSON.stringify(it.edge.decl);
  // Chrome reads a literal U+0000 differently by position, so Dragon reports every stylesheet holding one.
  if (it.edge.decl.includes('\u0000')) return it.nulReported ? [] : [`${name}: a literal U+0000 is not reported`];
  const chromeHas = s.declared !== null && s.declared.length > 0;
  if (EDGE_GAPS[it.edge.decl] !== undefined) return it.kind !== 'ok' ? [] : [`${name}: a documented gap is now accepted; remove it from EDGE_GAPS`];
  // A refusal of a value Chrome drops is never a wrong acceptance (an unknown property name is refused, for example).
  if (it.kind === 'refused') return chromeHas && EDGE_REFUSALS[it.edge.decl] === undefined ? [`${name}: refused (${it.codes}), Chrome parses it`] : [];
  const out: string[] = [];
  const chromeNames = new Set((s.declared ?? []).map(([p]) => p));
  const dragonNames = new Set(it.dragon.map(([p]) => p));
  if ([...chromeNames].sort().join() !== [...dragonNames].sort().join()) out.push(`${name}: Dragon declares [${[...dragonNames].join(', ')}], Chrome [${[...chromeNames].join(', ')}] (${it.codes})`);
  const priority = (list: readonly [string, string, string][]): string => list.map(([p, , pr]) => `${p}${pr}`).sort().join();
  if (chromeHas && priority(it.dragon) !== priority(s.declared ?? [])) out.push(`${name}: priorities differ`);
  out.push(...s.dropped.map((d) => `${name}: Chrome drops Dragon's ${d}`), ...s.diff.map((d) => `${name}: ${d}`));
  return out;
});

type SelectorSeen = { readonly c: SelectorCase; readonly dragon: boolean[] | 'invalid' | string; readonly chrome: boolean[] | 'invalid' };
/** Selectors Chrome parses that Dragon refuses or reports, each with its reason; none is a wrong match. */
const SELECTOR_REFUSALS: Record<string, string> = {
  'div:\\68over': 'interactive state is runtime state, which a later package models',
  ':n\\74h-child(\\6f dd)': 'css-tree\'s An+B parser does not read escapes, so the argument stays Raw and is refused',
  '[data-a=\\': 'css-tree reports a block left open at the end of the input',
};
const judgeSelectors = (seen: readonly SelectorSeen[]): string[] => seen.flatMap((s) => {
  const name = JSON.stringify(s.c.selector);
  if (s.c.selector.includes('\u0000')) return s.dragon === 'invalid' ? [] : [`${name}: a literal U+0000 is not reported`];
  if (SELECTOR_REFUSALS[s.c.selector] !== undefined) return typeof s.dragon === 'string' && s.chrome !== 'invalid' ? [] : [`${name}: listed as a refusal, but Dragon ${JSON.stringify(s.dragon)}, Chrome ${JSON.stringify(s.chrome)}`];
  if (typeof s.dragon === 'string' && s.dragon !== 'invalid') return [`${name}: refused (${s.dragon}), Chrome ${JSON.stringify(s.chrome)}`];
  return JSON.stringify(s.dragon) === JSON.stringify(s.chrome) ? [] : [`${name}: Dragon ${JSON.stringify(s.dragon)}, Chrome ${JSON.stringify(s.chrome)}`];
});

describe('CSS escapes: Dragon decodes as Chrome 145 does', () => {
  it('escaped twins read as their plain spelling, edge escapes compute like Chrome, selectors match like Chrome, and the plants are caught', async () => {
    const twins = twinCases();
    const edges = EDGES.map(edgeItem);
    const { launchChrome } = await load<{ launchChrome: () => Promise<Browser> }>('chrome.ts');
    const browser = await launchChrome();
    let twinSeen: TwinSeen[];
    let edgeSeen: EdgeSeen[];
    let selectorSeen: SelectorSeen[];
    const planted: { name: string; problems: () => string[] }[] = [];
    try {
      const page = await browser.newPage();
      await page.setContent('<!DOCTYPE html><body><div id="p" style="font-size:10px"><div id="a"></div><div id="c"></div></div></body>');
      const declared = async (sheets: readonly string[]): Promise<Declared[]> => (await page.evaluate(chromeDeclared(sheets))) as Declared[];
      const [chromeEsc, chromePlain] = [await declared(twins.map((t) => sheetOf(t.decl, false))), await declared(twins.map((t) => sheetOf(t.plain, false)))];
      twinSeen = twins.map((t, i) => ({ twin: t, dragon: summary(sheetOf(t.decl, false), t.written, t.plainPart), dragonPlain: summary(sheetOf(t.plain, false), t.written, t.plainPart), chrome: chromeEsc[i] as Declared, chromePlain: chromePlain[i] as Declared }));

      const edgeDeclared = await declared(edges.map((e) => sheetOf(e.edge.decl, e.edge.eof === true)));
      const computed = async (items: readonly EdgeItem[], decl: readonly Declared[]): Promise<EdgeSeen[]> => {
        const r = (await page.evaluate(chromeComputed(items.map((it, i) => ({ chrome: decl[i] as Declared, dragon: it.dragon }))))) as { dropped: string[]; diff: string[] }[];
        return r.map((x, i) => ({ declared: decl[i] as Declared, ...x }));
      };
      edgeSeen = await computed(edges, edgeDeclared);

      const selectorCases = SELECTORS;
      const chromeSel = (await page.evaluate(chromeMatches(selectorCases.map((c) => c.selector)))) as (boolean[] | 'invalid')[];
      selectorSeen = selectorCases.map((c, i) => ({ c, dragon: dragonMatches(c), chrome: chromeSel[i] as boolean[] | 'invalid' }));

      // Plants: each is a way Dragon could misread escapes, applied to its results, and must be caught by the same judges.
      const byDecl = (d: string): number => edges.findIndex((e) => e.edge.decl === d);
      const plantEdge = async (name: string, decl: string, dragon: [string, string, string][]): Promise<void> => {
        const i = byDecl(decl);
        const item: EdgeItem = { ...(edges[i] as EdgeItem), kind: 'ok', dragon };
        const seen = await computed([item], [edgeDeclared[i] as Declared]);
        planted.push({ name, problems: () => judgeEdges([item], seen) });
      };
      await plantEdge('nulDropped', 'display: \\0 block', [['display', 'block', '']]);
      await plantEdge('exponentUnit', 'width: 1\\65 3', [['width', '1000px', '']]);
      await plantEdge('surrogateEscapeDropped', 'grid-template-columns: [\\D800] 10px', [['grid-template-columns', '[D800] 10px', '']]);
      await plantEdge('eofEscapeDropped', 'width: 1p\\', [['width', '1px', '']]);
      await plantEdge('hexSpaceKept', 'display: \\62  lock', [['display', 'block', '']]);
      planted.push({ name: 'escapedKeywordInvalid', problems: () => judgeTwins(twinSeen.filter((s) => s.twin.decl.startsWith('display: ')).map((s) => ({ ...s, dragon: '{"decls":[],"diagnostics":[["DRAGON_CSS_INVALID_VALUE",""]]}' }))) });
      planted.push({ name: 'classUndecoded', problems: () => judgeSelectors(selectorSeen.filter((s) => s.c.selector === '.\\31 a').map((s) => ({ ...s, dragon: [false, false, false, false] }))) });
      planted.push({ name: 'attributeNulKept', problems: () => judgeSelectors(selectorSeen.filter((s) => s.c.selector === '[data-\\0]').map((s) => ({ ...s, dragon: [false, false, false, false] }))) });
    } finally {
      await browser.close();
    }
    expect(judgeTwins(twinSeen)).toEqual([]);
    expect(judgeEdges(edges, edgeSeen)).toEqual([]);
    expect(judgeSelectors(selectorSeen)).toEqual([]);
    for (const p of planted) expect(p.problems().length, p.name).toBeGreaterThan(0);
    // REPL-a: the object-fit and object-position grammar words and names add 52 twins (13736 before them).
    expect({ twins: twinSeen.length, edges: edges.length, selectors: selectorSeen.length }).toEqual({ twins: 13788, edges: 89, selectors: 59 });
  }, 300_000);
});
