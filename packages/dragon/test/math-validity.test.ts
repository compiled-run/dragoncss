// T131: a math function Chrome's parser rejects is invalid CSS. Dragon reports DRAGON_CSS_INVALID_VALUE and drops the
// declaration, so an earlier valid declaration of the property wins, exactly as Chrome 145 does. The corpus
// (test/math-validity-oracle/math-validity-corpus.json) and its Chrome capture (test/math-validity-oracle/math-validity-chrome.json, written by
// packages/parity/src/cli/math-validity-capture.ts) pin both directions: nothing Chrome accepts is reported invalid, and nothing it rejects is missed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { mathContextFor, mathGrammarFor, mathInvalidity, parseMath } from '../src/css/math.ts';
import { properties, types } from '../src/css/grammar.generated.ts';
import { LONGHANDS, SHORTHANDS } from '../src/css/properties.ts';
import { GRID_VALUE_PROPERTIES } from '../src/css/grid-values.ts';
import type { Diagnostic, SourceRef } from '../src/types.ts';

type Box = { readonly x: number; readonly width: number; readonly borderLeftWidth: string; readonly flexGrow: string };
type Capture = {
  readonly chrome: string;
  readonly cascade: { readonly [direction in 'ltr' | 'rtl']: { readonly w: Box; readonly g: Box; readonly h: Box } };
  readonly rows: readonly (readonly [string, string, boolean])[];
};
const CAPTURE = JSON.parse(readFileSync(new URL('./math-validity-oracle/math-validity-chrome.json', import.meta.url), 'utf8')) as Capture;
const CORPUS = JSON.parse(readFileSync(new URL('./math-validity-oracle/math-validity-corpus.json', import.meta.url), 'utf8')) as { readonly properties: readonly string[]; readonly values: readonly string[]; readonly undetermined: readonly string[] };
const MATH_VALIDITY_PROPERTIES = CORPUS.properties;
const MATH_VALIDITY_VALUES = CORPUS.values;
const MATH_VALIDITY_UNDETERMINED = CORPUS.undetermined;
const SOURCE: SourceRef = { uri: 'dragon-source://test/app.css', revision: 'r1', hash: 'sha256:0' };

function parse(css: string): { declarations: readonly Declaration[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declarations: rules.flatMap((r) => r.declarations), diagnostics };
}
const invalidIn = (property: string, value: string): Diagnostic | undefined => parse(`.a { ${property}: ${value}; }`).diagnostics.find((d) => d.code === 'DRAGON_CSS_INVALID_VALUE');

describe('math functions Chrome rejects are invalid CSS (T131)', () => {
  it('the capture is of the pinned Chrome and covers the whole corpus', () => {
    expect(CAPTURE.chrome).toBe('145.0.7632.6');
    const expected = MATH_VALIDITY_PROPERTIES.flatMap((p) => [...MATH_VALIDITY_VALUES, ...MATH_VALIDITY_UNDETERMINED].map((v) => `${p}: ${v}`));
    expect(CAPTURE.rows.map(([p, v]) => `${p}: ${v}`)).toEqual(expected);
    // Both outcomes are well represented, in every grammar.
    for (const p of MATH_VALIDITY_PROPERTIES) {
      const own = CAPTURE.rows.filter((r) => r[0] === p);
      expect(own.filter((r) => r[2]).length, p).toBeGreaterThan(20);
      expect(own.filter((r) => !r[2]).length, p).toBeGreaterThan(20);
    }
  });

  it('every corpus value is reported DRAGON_CSS_INVALID_VALUE exactly when Chrome rejects it', () => {
    const undetermined = new Set(MATH_VALIDITY_UNDETERMINED);
    const disagreements: string[] = [];
    for (const [p, v, chromeValid] of CAPTURE.rows) {
      if (undetermined.has(v)) continue;
      const hit = invalidIn(p, v);
      if ((hit === undefined) !== chromeValid) disagreements.push(`${p}: ${v} (Chrome ${chromeValid ? 'accepts' : 'rejects'}; Dragon ${hit === undefined ? 'does not report it invalid' : hit.message})`);
    }
    expect(disagreements).toEqual([]);
  });

  it('a math function the check does not model (a substitution, anchor-size(), progress(), a sqrt() of an operation) is never reported invalid by it', () => {
    for (const p of MATH_VALIDITY_PROPERTIES) for (const v of MATH_VALIDITY_UNDETERMINED) expect(mathInvalidity(v, mathGrammarFor(p)), `${p}: ${v}`).toBeNull();
  });

  it('a code point the check does not tokenize (an escape, a string, non-ASCII white space) leaves it undecided rather than reported invalid', () => {
    for (const v of ['calc(1px +\u00a02px)', 'calc(1px\u00a0+ 2px)', 'calc(1px + \\32 px)', 'calc(1px + "a")', 'calc(1px + 2px /* open', 'calc(1px +\u2003 2px)']) expect(mathInvalidity(v, 'length'), JSON.stringify(v)).toBeNull();
    // CSS white space other than a space still separates + and -.
    for (const ws of ['\t', '\n', '\r', '\f']) expect(mathInvalidity(`calc(1px${ws}+${ws}2px)`, 'length')).toBeNull();
    expect(mathInvalidity('calc(1px +\t2px + 3)', 'length')).toBe('it adds a length and a number, which have no common type (css-values-4 §10.9)');
  });

  it('parseMath refuses with the same reason the stylesheet drops a declaration for: one predicate decides both', () => {
    for (const [p, v] of CAPTURE.rows) {
      const context = mathContextFor(p);
      const reason = mathInvalidity(v, mathGrammarFor(p));
      // flex tries a number first, and font-size and line-height refuse every calculation, so they keep their own paths.
      if ('refused' in context || p === 'flex' || reason === null) continue;
      expect(parseMath(v, context), `${p}: ${v}`).toEqual({ ok: false, reason: `${reason}, so Chrome drops the declaration`, fix: 'Write a calculation Chrome accepts for this property.' });
    }
  });

  it('an invalid calculation after a valid declaration is dropped, so the earlier declaration wins, as in Chrome in both directions', () => {
    for (const direction of ['ltr', 'rtl'] as const) {
      const c = CAPTURE.cascade[direction];
      expect([c.w.borderLeftWidth, c.w.width], direction).toEqual(['3px', 13]);
      expect(c.g.flexGrow, direction).toBe('2');
      // flex-grow 2 against 1 splits the 287px left by the 13px box two to one.
      expect(c.g.width / c.h.width, direction).toBeCloseTo(2, 3);
    }
    const w = parse('.w { border-left-style: solid; border-left-width: 3px; border-left-width: calc(1px + 5%); }');
    expect(w.declarations.map((d) => `${d.property}: ${d.text}`)).toEqual(['border-left-style: solid', 'border-left-width: 3px']);
    expect(w.diagnostics.map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    const g = parse('.g { flex-grow: 2; flex-grow: calc(1 + 5%); }');
    expect(g.declarations.map((d) => `${d.property}: ${d.text}`)).toEqual(['flex-grow: 2']);
    expect(g.diagnostics.map((d) => [d.code, d.message])).toEqual([[
      'DRAGON_CSS_INVALID_VALUE',
      '"calc(1 + 5%)" is not a valid value for flex-grow: calc(1 + 5%): it adds a number and a percentage, which have no common type (css-values-4 §10.9), so Chrome drops the declaration',
    ]]);
  });

  it('an invalid math function after var() substitution is invalid at computed-value time, as any other invalid value is', () => {
    const r = parse('.a { --w: calc(1px + 5%); border-left-width: var(--w); }');
    expect(r.diagnostics).toEqual([]);
    expect(r.declarations.map((d) => d.property)).toEqual(['--w', 'border-left-width']);
  });

  it('each property takes the math grammar its webref syntax gives (a number, a length, a length-percentage or a number or length-percentage)', () => {
    // The value-level types a top-level calculation can stand for; function and colour types are opaque here.
    const OPEN = new Set(['line-width', 'box-size', 'length-percentage', 'bg-layer', 'final-bg-layer', 'bg-position', 'bg-size', 'position', 'position-three']);
    const expand = (syntax: string, depth: number): string =>
      depth === 0 ? syntax : syntax.replace(/<'([a-z-]+)'>/g, (_, p: string) => expand(properties[p]?.syntax ?? '', depth - 1)).replace(/<([a-z0-9-]+)(?: \[[^\]]*\])?>/gi, (m, t: string) => (OPEN.has(t) && types[t] !== undefined ? ` ${expand(types[t] as string, depth - 1)} ` : m));
    const problems: string[] = [];
    for (const p of [...LONGHANDS, ...SHORTHANDS] as string[]) {
      if (GRID_VALUE_PROPERTIES.has(p)) continue;
      const s = expand(properties[p]?.syntax ?? '', 6).replace(/[a-z-]+\([^)]*\)/g, '');
      const number = /<(number|integer)\b/.test(s);
      const percent = /<(length-percentage|percentage)\b/.test(s);
      const length = percent || /<length\b/.test(s);
      if (!number && !length) continue;
      const expected = number ? (length ? 'number-or-length-percentage' : 'number') : percent ? 'length-percentage' : 'length';
      if (mathGrammarFor(p) !== expected) problems.push(`${p}: ${mathGrammarFor(p)}, its syntax gives ${expected}`);
    }
    expect(problems).toEqual([]);
  });
});
