// css-text-4 §5.1: text-wrap-style and the text-wrap shorthand. auto and stable compile on every target, and text-wrap: nowrap sets
// text-wrap-mode as white-space: nowrap does. TXT-TW: balance and pretty compile on every target where fixture group text-wrap
// proves them (one run of Ahem text of whole-px size directly in a block container, analysis/computed-checks.ts checkTextWrapStyle),
// and every target refuses them in any other context. The Chrome cases are text-wrap-ahem, text-wrap-balance-ahem and the rejects
// reject-text-wrap-balance and reject-text-wrap-pretty-justify (packages/parity/fixtures); text-wrap-parse.test.ts pins the grammar.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/text-wrap.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value` (! when implicit), or its diagnostic codes. */
function parsed(property: string, value: string): string[] {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}${l.explicit ? '' : '!'}`);
}

const project = () =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text in a 30px box, inheriting the declaration through a child. */
function errorsAt(decl: string): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { width: 30px; ${decl}; }`;
  const c = project().compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX XX XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

describe('text-wrap and text-wrap-style', () => {
  it('parses text-wrap-style as Chrome does', () => {
    for (const v of ['auto', 'stable', 'AUTO']) expect(parsed('text-wrap-style', v), v).toEqual([`text-wrap-style: ${v.toLowerCase()}`]);
    for (const v of ['balance', 'pretty', 'Balance']) expect(parsed('text-wrap-style', v), v).toEqual([`text-wrap-style: ${v.toLowerCase()}`]);
    for (const v of ['avoid-orphans', 'nowrap', 'wrap', 'auto stable', 'none']) expect(parsed('text-wrap-style', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('expands text-wrap to text-wrap-mode and text-wrap-style, an omitted one at its initial value', () => {
    expect(parsed('text-wrap', 'nowrap')).toEqual(['text-wrap-mode: nowrap', 'text-wrap-style: auto!']);
    expect(parsed('text-wrap', 'wrap')).toEqual(['text-wrap-mode: wrap', 'text-wrap-style: auto!']);
    expect(parsed('text-wrap', 'stable')).toEqual(['text-wrap-mode: wrap!', 'text-wrap-style: stable']);
    expect(parsed('text-wrap', 'stable nowrap')).toEqual(['text-wrap-mode: nowrap', 'text-wrap-style: stable']);
    expect(parsed('text-wrap', 'NoWrap auto')).toEqual(['text-wrap-mode: nowrap', 'text-wrap-style: auto']);
    expect(parsed('text-wrap', 'inherit')).toEqual(['text-wrap-mode: inherit', 'text-wrap-style: inherit']);
    expect(parsed('text-wrap', 'balance')).toEqual(['text-wrap-mode: wrap!', 'text-wrap-style: balance']);
    expect(parsed('text-wrap', 'nowrap pretty')).toEqual(['text-wrap-mode: nowrap', 'text-wrap-style: pretty']);
    for (const v of ['nowrap wrap', 'auto stable', 'avoid-orphans', 'none']) expect(parsed('text-wrap', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles auto, stable and both modes on every target', () => {
    for (const d of ['text-wrap: nowrap', 'text-wrap: wrap', 'text-wrap: stable', 'text-wrap-style: auto', 'text-wrap-style: stable', 'text-wrap: nowrap stable']) expect(errorsAt(d), d).toEqual([]);
  });

  it('compiles balance and pretty on every target for one run of Ahem text in a block, inherited or not', () => {
    for (const d of ['text-wrap: balance', 'text-wrap: pretty', 'text-wrap-style: balance', 'text-wrap-style: pretty', 'text-wrap: wrap balance']) expect(errorsAt(d), d).toEqual([]);
    for (const d of ['text-wrap-style: balance', 'text-wrap-style: pretty']) expect(contextErrors(d, (r) => [text(r, 't', 'XX XX XX')]), d).toEqual([]);
  });

  it('refuses balance and pretty on every target in the contexts no Chrome case proves', () => {
    const every = (code: string): string[] => ['android', 'ios', 'web'].map((t) => `${t} ${code}`);
    const refused = every('DRAGON_UNSUPPORTED_VALUE');
    expect(errorsAt('text-wrap: nowrap balance')).toEqual(refused);
    const cases: readonly (readonly [string, string, (r: SourceRef) => TreeNode[], string])[] = [
      ['', 'balance', (r) => [text(r, 't', 'XX '), el(r, 'sp', 'span', [], [text(r, 'u', 'XX')]), text(r, 'v', ' XX')], 'beside an inline box'],
      ['', 'pretty', (r) => [text(r, 't', 'XX XX'), el(r, 'br', 'br'), text(r, 'u', 'XX')], 'beside an inline box, a <br>'],
      ['', 'balance', (r) => [text(r, 't', 'XX XX'), el(r, 'p', 'div', [], [text(r, 'u', 'XX')])], 'with text beside the block <div> p'],
      ['display: flex;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with text directly in the flex container'],
      ['display: list-item; list-style: none;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'on a list item'],
      ['font-size: 10.5px;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'at a font size other than whole px'],
      ['white-space: pre-wrap;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with preserved white space'],
      ['word-break: break-all;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'with overflow-wrap, word-break or line-break'],
      ['overflow-wrap: anywhere;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with overflow-wrap, word-break or line-break'],
      ['line-break: strict;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with overflow-wrap, word-break or line-break'],
      ['letter-spacing: 1px;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with letter-spacing or word-spacing'],
      ['word-spacing: 2px;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'with letter-spacing or word-spacing'],
      ['font-variant-caps: small-caps;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with font-variant-caps'],
      ['', 'balance', (r) => [text(r, 't', 'XX X\u00adX XX')], 'with a soft hyphen'],
      ['text-indent: 5px;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'with text-indent'],
      ['text-align: justify;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with text-align: justify'],
      ['overflow: hidden; text-overflow: ellipsis;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with text-overflow: ellipsis'],
      ['display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'with -webkit-line-clamp'],
      ['float: left;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'as a float'],
      ['position: absolute;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'with position: absolute'],
      ['position: relative;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with position: relative'],
      ['overflow: auto;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with overflow other than visible'],
      ['overflow-x: hidden;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'with overflow other than visible'],
      ['display: inline-block;', 'balance', (r) => [text(r, 't', 'XX XX XX')], 'with display: inline-block'],
      ['display: flow-root;', 'pretty', (r) => [text(r, 't', 'XX XX XX')], 'with display: flow-root'],
    ];
    for (const [extra, kind, kids, why] of cases) {
      const d = `${extra} text-wrap-style: ${kind}`;
      const c = compiledWith(d, kids);
      const errors = c.diagnostics.filter((x) => x.severity === 'error' && x.message.startsWith(`text-wrap-style: ${kind} on a `));
      expect(errors.map((x) => `${String(x.target)} ${x.code}`).sort(), d).toEqual(refused);
      for (const x of errors) expect(x.message, d).toContain(why);
    }
  });

  it('refuses balance and pretty under a line-clamp container, as a grid item or column flex item, and in an inline-block', () => {
    const refused = ['android', 'ios', 'web'].map((t) => `${t} DRAGON_UNSUPPORTED_VALUE`);
    // The block a in o, or in a block m in o; o is the context under test.
    const compiled = (outer: string, kind: string, deep: boolean) => {
      const css = `body { font-family: Ahem; font-size: 10px; } .o { ${outer} } .s { width: 100px; text-wrap-style: ${kind}; }`;
      const a = (r: SourceRef): TreeNode => el(r, 'a', 'div', ['s'], [text(r, 't', 'XX XXX XX XXXX XX X XXX')]);
      return project().compile(inputFor(css, (r) => [el(r, 'o', 'div', ['o'], [deep ? el(r, 'm', 'div', [], [a(r)]) : a(r)])]));
    };
    const clamp = 'display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; width: 100px;';
    const cases: readonly (readonly [string, boolean, string])[] = [
      [clamp, false, 'inside the line-clamp container <div> o'],
      [clamp, true, 'inside the line-clamp container <div> o'],
      ['display: grid;', false, 'as a grid item'],
      ['display: flex; flex-direction: column;', false, 'as a flex item of a column flex container'],
      ['display: flex; flex-direction: row-reverse;', false, 'as a flex item of a row-reverse flex container'],
      ['display: inline-block;', false, 'in a box with display: inline-block'],
    ];
    for (const kind of ['balance', 'pretty']) {
      for (const [outer, deep, why] of cases) {
        const errors = compiled(outer, kind, deep).diagnostics.filter((x) => x.severity === 'error' && x.message.startsWith(`text-wrap-style: ${kind} on a `));
        expect(errors.map((x) => `${String(x.target)} ${x.code}`).sort(), `${kind} ${outer} ${deep}`).toEqual(refused);
        for (const x of errors) expect(x.message, `${kind} ${outer}`).toContain(why);
      }
      // The proven contexts: a block in a block, and a flex item of a row.
      for (const outer of ['', 'display: flex;']) expect(compiled(outer, kind, false).diagnostics.filter((x) => x.severity === 'error'), `${kind} ${outer}`).toEqual([]);
    }
  });
});

/** The compilation of the declarations on a 30px block a holding the given children, in 10px Ahem. */
function compiledWith(decl: string, kids: (r: SourceRef) => TreeNode[]) {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { width: 30px; ${decl}; }`;
  return project().compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], kids(r))]));
}

/** Each error as `<target> <code>` for the declaration on a block holding the given children. */
function contextErrors(decl: string, kids: (r: SourceRef) => TreeNode[]): string[] {
  return compiledWith(decl, kids).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}
