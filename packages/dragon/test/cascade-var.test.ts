// Custom properties, var() and !important (css-variables-1, css-cascade-5 §6.4). Every expectation here was read from Chrome
// 145.0.7632.6 getComputedStyle on the same CSS; the parity fixtures in packages/parity/src/fixture-groups/cascade-var.ts prove them.
import { describe, expect, it } from 'vitest';
import type { LinkedElement } from '../src/analysis/link.ts';
import type { ResolvedElement, ResolvedValue } from '../src/analysis/resolve.ts';
import { resolveTree, valueToString } from '../src/analysis/resolve.ts';
import type { Longhand } from '../src/css/properties.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { parseVarParts } from '../src/css/variables.ts';
import { NO_FAULTS } from '../src/faults.ts';
import type { Diagnostic } from '../src/types.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import { COMMITTED_PROFILES, createProjectWith } from '../src/internal.ts';
import type { SupportProfiles } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const SRC = { uri: 's.css', revision: 'r', hash: 'h' };
const origin = { kind: 'unlocated', reason: 'test' } as const;
const el = (id: string, classes: string[], children: LinkedElement[] = [], tag = 'div'): LinkedElement => ({
  kind: 'element', address: id, instance: 'doc', owner: 'App', tag, classes: classes.map((name) => ({ owner: 'o', sheet: 'sheet', name })), attributes: new Map(), children,
  node: { kind: 'element', id, tag, classes: [], attributes: [], children: [], origin },
});

function parse(css: string): { rules: ReturnType<typeof parseStylesheet>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SRC, start: 0, end: css.length }, { id: 'sheet', owner: 'o', scope: 'document' }, 0, diagnostics);
  return { rules, diagnostics };
}

/** Resolves html > body > .p > (each child) and returns a reader of child values. */
function resolve(css: string, children: LinkedElement[]): (id: string, p: Longhand) => ResolvedValue {
  const { rules, diagnostics } = parse(`.p { color: rgb(1, 2, 3); margin-left: 3px; } ${css}`);
  expect(diagnostics).toEqual([]);
  const root = resolveTree(el('html', [], [el('body', [], [el('p', ['p'], children)], 'body')], 'html'), rules, NO_FAULTS, { direction: 'ltr', rootFont: 'ahem', ua: referenceDataset() });
  const find = (e: ResolvedElement, id: string): ResolvedElement | null => {
    if (e.element.address === id) return e;
    for (const c of e.children) if (c.kind === 'element') {
      const hit = find(c, id);
      if (hit !== null) return hit;
    }
    return null;
  };
  return (id, p) => (find(root, id) as ResolvedElement).props.get(p) as ResolvedValue;
}

const one = (css: string, cls: string, p: Longhand, inner: LinkedElement[] = []): string => valueToString(resolve(css, [el('x', [cls], inner)])('x', p).value);

describe('var() substitution', () => {
  it('substitutes, inherits and falls back', () => {
    expect(one('.p { --c: #00ff00; } .a { background-color: var(--c); }', 'a', 'background-color')).toBe('rgb(0, 255, 0)');
    expect(one('.a { width: var(--w, 12px); }', 'a', 'width')).toBe('12px');
    expect(one('.a { --w: 5px; width: var( --w , 14px ); }', 'a', 'width')).toBe('5px');
    expect(one('.a { --x: red; color: var(--x,); }', 'a', 'color')).toBe('rgb(255, 0, 0)');
    expect(one('.a { --f: 2 1 10px; flex: var(--f); }', 'a', 'flex-basis')).toBe('10px');
    expect(one('.a { --f: 2 1 10px; flex: var(--f); }', 'a', 'flex-grow')).toBe('2');
    expect(one('.a { --x: 1px; margin: var(--x) var(--x, 2px) 3px; }', 'a', 'margin-bottom')).toBe('3px');
    expect(one('.a { border: var(--bw) solid; --bw: 2px; }', 'a', 'border-top-width')).toBe('2px');
  });

  it('computes a custom property on the element that declares it (children inherit the substituted value)', () => {
    const at = resolve('.d { --a: var(--c); width: var(--a, 12px); } .k { --c: 6px; width: var(--a, 13px); }', [el('d', ['d'], [el('k', ['k'])])]);
    expect(valueToString(at('d', 'width').value)).toBe('12px');
    expect(valueToString(at('k', 'width').value)).toBe('13px');
  });

  it('a reference with no value and no fallback is invalid at computed-value time: unset (inherit or initial)', () => {
    const at = resolve('.a { color: var(--missing); width: var(--missing); margin-left: var(--missing); }', [el('a', ['a'])]);
    expect(valueToString(at('a', 'color').value)).toBe('rgb(1, 2, 3)');
    expect(at('a', 'color').origin).toBe('inherited');
    expect(valueToString(at('a', 'width').value)).toBe('auto');
    expect(valueToString(at('a', 'margin-left').value)).toBe('0px');
    expect(at('a', 'width').declared).toEqual({ kind: 'keyword', value: 'unset' });
    expect(one('.a { --u: 1; --v: px; width: var(--u)var(--v); }', 'a', 'width')).toBe('auto');
  });

  it('empty, guaranteed-invalid and CSS-wide custom property values', () => {
    expect(one('.a { --e:; margin: 1px var(--e); }', 'a', 'margin-right')).toBe('1px');
    expect(one('.a { --e:; color: var(--e, blue); }', 'a', 'color')).toBe('rgb(1, 2, 3)');
    expect(one('.a { --sp: ; color: var(--sp, blue); }', 'a', 'color')).toBe('rgb(1, 2, 3)');
    expect(one('.a { --i: initial; color: var(--i, blue); }', 'a', 'color')).toBe('rgb(0, 0, 255)');
    expect(one('.p { --x: red; } .a { --x: inherit; color: var(--x); }', 'a', 'color')).toBe('rgb(255, 0, 0)');
    expect(one('.a { --z: revert-layer; color: var(--z, pink); }', 'a', 'color')).toBe('rgb(255, 192, 203)');
    expect(one('.p { --x: red; } .a { --x: var(--missing); color: var(--x, blue); }', 'a', 'color')).toBe('rgb(0, 0, 255)');
  });

  it('a CSS-wide keyword reached through a fallback is that keyword', () => {
    expect(one('.a { margin-left: var(--m, inherit); }', 'a', 'margin-left')).toBe('3px');
    expect(one('.a { margin-left: var(--m, unset); }', 'a', 'margin-left')).toBe('0px');
    expect(one('.a { color: var(--m, initial); }', 'a', 'color')).toBe('rgb(0, 0, 0)');
  });

  it('cycles make every member invalid; fallbacks resolve lazily; every var() is resolved even after one fails', () => {
    expect(one('.a { --a: var(--b); --b: var(--a); color: var(--a, green); }', 'a', 'color')).toBe('rgb(0, 128, 0)');
    expect(one('.a { --a: var(--b, 1px); --b: var(--a, 2px); --c: var(--a, 3px); width: var(--c); }', 'a', 'width')).toBe('3px');
    expect(one('.a { --b: 5px; --a: var(--b, var(--a)); width: var(--a, 9px); }', 'a', 'width')).toBe('5px');
    expect(one('.a { --a: var(--b, var(--a)); width: var(--a, 9px); }', 'a', 'width')).toBe('9px');
    expect(one('.a { --a: var(--b); --b: var(--c); --c: var(--b); --d: var(--a, 15px); width: var(--d); }', 'a', 'width')).toBe('15px');
    expect(one('.a { --a: var(--missing) var(--b); --b: var(--a, 5px); width: var(--b, 9px); }', 'a', 'width')).toBe('9px');
    expect(one('.a { --b: var(--a, 5px); --a: var(--missing) var(--b); width: var(--b, 9px); }', 'a', 'width')).toBe('9px');
  });

  it('a shorthand with var() is pending for every longhand and competes in declaration order', () => {
    expect(one('.a { margin: var(--bad); margin-left: 9px; }', 'a', 'margin-left')).toBe('9px');
    expect(one('.a { margin-left: 9px; margin: var(--bad); }', 'a', 'margin-left')).toBe('0px');
  });

  it('refuses a grammar-valid substituted value Dragon cannot express', () => {
    const at = resolve('.a { --c: lab(50% 40 59); color: var(--c); }', [el('a', ['a'])]);
    expect(at('a', 'color').substitution?.refusal).toMatch(/^color: var\(--c\) substitutes to "lab\(50% 40 59\)", and lab\(50% 40 59\) is unsupported/);
    expect(at('a', 'color').declared).toBeNull();
  });
});

describe('!important (css-cascade-5 §6.4)', () => {
  it('an important declaration beats a later or more specific normal one, for longhands and custom properties', () => {
    expect(one('.a { width: 10px !important; width: 20px; }', 'a', 'width')).toBe('10px');
    expect(one('.p .a { width: 20px; } .a { width: 10px !IMPORTANT; }', 'a', 'width')).toBe('10px');
    expect(one('.a { --x: red !important; --x: blue; color: var(--x); }', 'a', 'color')).toBe('rgb(255, 0, 0)');
    expect(one('.a { --x: 4px; width: var(--x) !important; width: 6px; }', 'a', 'width')).toBe('4px');
  });
});

describe('parse-time validity', () => {
  it('a malformed var() or priority drops the declaration with a diagnostic', () => {
    const codes = (css: string): string[] => parse(css).diagnostics.map((d) => d.code);
    expect(codes('.a { width: var(foo); }')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(codes('.a { --a: var(foo); }')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(codes('.a { width: var(--a extra); }')).toContain('DRAGON_CSS_INVALID_VALUE');
    expect(codes('.a { width: 1px !foo; }')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(codes('.a { --a\\62: 1px; }')).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    expect(codes('.a { --Ab: 5px; width: var(--Ab); height: 1px !important; }')).toEqual([]);
  });
  it('drops the reserved name "--", and a custom property value with an unmatched closing bracket or a bad url() (WPT test_variable_legal_values)', () => {
    const codes = (css: string): string[] => parse(css).diagnostics.map((d) => d.code);
    for (const v of [')', ']', '(])', '[)]', '(})', 'url(a b)', 'url(a"b)', 'url(var(--b))', '"a\nb"']) expect(codes(`.a { --t: ${v}; }`), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    for (const v of ['( )', '{ }', '[ ]', 'foo(bar())', '(;)', 'url( a )', 'url(a\\ b\\))', '")"', "']'", '/* ) */ 1', 'var(--x, ")")', 'a\\)', '"a\\\nb"']) expect(codes(`.a { --t: ${v}; }`), v).toEqual([]);
    expect(codes('.a { --: red; }')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(parse('.a { --: red; }').rules.flatMap((r) => r.declarations)).toEqual([]);
    // Chrome 145 drops a declaration that references "--" at parse time (probed: color stays red), unlike WPT variable-declaration-29.
    expect(codes('.a { color: var(--, green); }')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(codes('.a { --y: var(--, green); }')).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
  it('a CSS-wide keyword beside comments is still that keyword', () => {
    expect(one('.p { --x: 8px; } .a { --x: /* c */ inherit /**/; width: var(--x); }', 'a', 'width')).toBe('8px');
    expect(one('.p { --x: 8px; } .a { --x: inh/**/erit; width: var(--x, 3px); }', 'a', 'width')).toBe('auto');
    // Chrome 145: an escaped keyword is the keyword (probed: \\69nherit gives the parent's 8px, \\69nitial the 5px fallback).
    expect(one('.p { --x: 8px; } .a { --x: \\69nherit; width: var(--x, 5px); }', 'a', 'width')).toBe('8px');
    expect(one('.a { --x: \\69nitial; width: var(--x, 5px); }', 'a', 'width')).toBe('5px');
  });
  it('an escape may spell var( or url( (css-syntax-3 §4.3.7; probed in Chrome 145)', () => {
    expect(one('.a { --x: 7px; width: 3px; width: v\\61r(--x); }', 'a', 'width')).toBe('7px');
    expect(one('.a { --x: 7px; width: 3px; width: v\\61 r(--x); }', 'a', 'width')).toBe('7px');
    expect(parse('.a { --x: red; color: u\\72l(var(--x)); }').diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });
  it('a value past the substitution length limit is invalid at computed-value time, and a doubling chain stays bounded', () => {
    const chain = Array.from({ length: 40 }, (_, i) => `--p${i + 1}: var(--p${i})var(--p${i});`).join(' ');
    expect(one(`.a { --p0: x; ${chain} width: var(--p40, 11px); }`, 'a', 'width')).toBe('11px');
    expect(one(`.a { --p0: 1px; ${chain.replace(/var\(--p0\)var\(--p0\)/, 'var(--p0)')} width: var(--p1, 11px); }`, 'a', 'width')).toBe('1px');
  });
  it('var( right after "#" or "@" is part of a hash or at-keyword token, not a var() reference', () => {
    expect(parseVarParts('#var(--a) @var(--b)')?.some((p) => p.kind === 'var')).toBe(false);
    expect(parseVarParts('+var(--a)')?.some((p) => p.kind === 'var')).toBe(true);
  });
  it('finds var() only where it is a function token', () => {
    expect(parseVarParts('"var(--a)" url(var\\(--b\\)) x-var(--c) /* var(--d) */')?.some((p) => p.kind === 'var')).toBe(false);
    expect(parseVarParts('rgb(var(--r), 0, 0)')).toEqual([{ kind: 'text', text: 'rgb(' }, { kind: 'var', name: '--r', fallback: null }, { kind: 'text', text: ', 0, 0)' }]);
    expect(parseVarParts('VAR(--k, var(--j,))')).toEqual([{ kind: 'var', name: '--k', fallback: [{ kind: 'text', text: ' ' }, { kind: 'var', name: '--j', fallback: [] }] }]);
  });
});

describe('a substituted value is checked against each target\'s profile', () => {
  const FEATURE = 'width:<length-px>';
  const drop = (profile: SupportProfiles['ios']): SupportProfiles['ios'] => ({ ...profile, rows: profile.rows.filter((r) => r.feature !== FEATURE) });
  const input = inputFor('.a { --w: 7px; width: var(--w); }', (r) => [div(r, 'a', ['a'])]);
  const refused = (targets: Parameters<typeof createProjectWith>[0]['targets'], supportProfiles: SupportProfiles, profiles: 'enforce' | 'derive' = 'enforce'): (string | null)[] =>
    createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles, direction: 'ltr', supportProfiles }).compile(input).diagnostics
      .filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('substitutes to 7px')).map((d) => d.target);

  it('reads the replacement profiles and the android profile, not only the committed ios and web ones', () => {
    expect(COMMITTED_PROFILES.ios.rows.some((r) => r.feature === FEATURE)).toBe(true);
    expect(refused({ ios: { minimum: '15.0' }, web: {} }, { ios: drop(COMMITTED_PROFILES.ios), web: COMMITTED_PROFILES.web })).toEqual(['ios']);
    expect(refused({ android: { minSdk: 31 } }, { ...COMMITTED_PROFILES, android: drop(COMMITTED_PROFILES.android) })).toEqual(['android']);
    expect(refused({ ios: { minimum: '15.0' } }, { ios: drop(COMMITTED_PROFILES.ios), web: COMMITTED_PROFILES.web }, 'derive')).toEqual([]);
  });
  it('revert and revert-layer reached through var() are refused on every target, as written literally', () => {
    for (const css of ['.a { color: var(--m, revert); }', '.a { --r: 1px; width: var(--m, revert-layer); }']) {
      const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'enforce', direction: 'ltr', supportProfiles: COMMITTED_PROFILES }).compile(inputFor(css, (r) => [div(r, 'a', ['a'])]));
      expect(c.diagnostics.map((d) => [d.code, d.target, /substitutes to revert/.test(d.message)]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios', true], ['DRAGON_UNSUPPORTED_VALUE', 'web', true]]);
    }
  });
});
