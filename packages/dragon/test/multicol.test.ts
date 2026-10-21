// The multicol family: column-width as a px length and column-count as a positive integer make a multi-column container, which
// compiles where the engine lays it out (analysis/multicol.ts) and lowers to LayoutStyle.multicol; the rule, span and fill longhands
// are accepted at their initial values alone, on every target. Every other value is kept (the grammar takes any value, so Dragon
// never drops what Chrome keeps) and refused where it applies. The Chrome cases are multicol-initial, multicol-ahem and the
// reject-multicol-* cases of fixture-groups/multicol.ts (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue, valueToString } from '../src/analysis/computed.ts';
import { resolveAlias } from '../src/css/aliases.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE, UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS, PROPERTY_ROLE, SHORTHANDS } from '../src/css/properties.ts';
import { isInitialValue, NON_INITIAL_VALUE_TYPE } from '../src/css/properties/initial-only.ts';
import { MULTICOL_INITIAL, MULTICOL_LONGHANDS, MULTICOL_SHORTHANDS } from '../src/css/properties/multicol.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { referenceDataset } from '../src/ua/datasets.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/multicol.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value` (`?` marks a kept non-initial value), or its diagnostics' codes. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${l.value.kind === 'other' && l.value.type === NON_INITIAL_VALUE_TYPE ? '?' : ''}${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text in a child of the element the declarations are on. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS, child = ''): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; } .c { ${child} }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];
const INITIAL_DECLS = [
  'columns: auto; column-rule: none; column-span: none; column-fill: balance',
  'COLUMNS: AUTO Auto; COLUMN-RULE: MEDIUM NONE CURRENTCOLOR; COLUMN-SPAN: NONE; COLUMN-FILL: BALANCE',
  'column-width: auto; column-count: auto; column-rule-width: medium; column-rule-style: none; column-rule-color: CurrentColor',
  'column-rule: currentcolor none; columns: auto auto',
  '-webkit-columns: auto; -webkit-column-rule: none medium; -webkit-column-span: none; -webkit-column-count: auto; -webkit-column-width: auto',
  '-webkit-column-rule-color: currentcolor; -webkit-column-rule-style: none; -webkit-column-rule-width: medium',
];

describe('the initial-only multicol family', () => {
  it('follows color-scheme in the registry, is container-role (column-width, column-count) and paint-role rows, animates as Chrome 145 does and knows its initial values', () => {
    const at = LONGHANDS.indexOf('color-scheme') + 1;
    expect(LONGHANDS.slice(at, at + MULTICOL_LONGHANDS.length)).toEqual([...MULTICOL_LONGHANDS]);
    for (const s of MULTICOL_SHORTHANDS) expect(SHORTHANDS, s).toContain(s);
    for (const p of MULTICOL_LONGHANDS) {
      expect(PROPERTY_ROLE[p], p).toBe(p === 'column-width' || p === 'column-count' ? 'container' : 'paint');
      expect(INHERITED.has(p), p).toBe(false);
      // The resolver's initial value (from the grammar) is the one the family accepts.
      expect(isInitialValue(MULTICOL_INITIAL[p], initialValue(p, referenceDataset())), p).toBe(true);
    }
    expect(MULTICOL_LONGHANDS.map((p) => [p, ANIMATION_KINDS[p]])).toEqual([
      ['column-width', UNADMITTED], ['column-count', UNADMITTED], ['column-rule-width', UNADMITTED], ['column-rule-style', DISCRETE],
      ['column-rule-color', UNADMITTED], ['column-span', DISCRETE], ['column-fill', DISCRETE],
    ]);
    // column-gap stays the flex family's; Chrome has no -webkit-column-fill.
    expect(resolveAlias('-webkit-column-gap')).toBe('column-gap');
    expect(resolveAlias('-webkit-column-fill')).toBe('-webkit-column-fill');
    expect(resolveAlias('-webkit-columns')).toBe('columns');
  });

  it('parses an initial spelling to the initial values, and keeps every other value as written', () => {
    expect(parsed('columns: AUTO')).toEqual(['column-width: auto', 'column-count: auto']);
    expect(parsed('columns: auto auto')).toEqual(['column-width: auto', 'column-count: auto']);
    expect(parsed('columns: auto 2')).toEqual(['column-width: auto', 'column-count: 2']);
    expect(parsed('columns: 2 100PX')).toEqual(['column-width: 100px', 'column-count: 2']);
    expect(parsed('columns: 0')).toEqual(['column-width: 0px', 'column-count: auto']);
    expect(parsed('columns: 2 0')).toEqual(['column-width: 0px', 'column-count: 2']);
    // Blink reads a second count or a second width as neither, and a count of 0 or a fraction as no count.
    expect(parsed('columns: 2 3')).toEqual(['column-width: ?2 3', 'column-count: ?2 3']);
    expect(parsed('columns: 10px 20px')).toEqual(['column-width: ?10px 20px', 'column-count: ?10px 20px']);
    expect(parsed('columns: 0 0')).toEqual(['column-width: ?0 0', 'column-count: ?0 0']);
    expect(parsed('columns: 1.5')).toEqual(['column-width: ?1.5', 'column-count: ?1.5']);
    expect(parsed('columns: auto auto auto')).toEqual(['column-width: ?auto auto auto', 'column-count: ?auto auto auto']);
    // Chrome 145 keeps column-height behind MulticolColumnWrapping, so a / column-height is not an initial spelling.
    expect(parsed('columns: auto / auto')).toEqual(['column-width: ?auto / auto', 'column-count: ?auto / auto']);
    for (const v of ['none', 'medium', 'currentcolor', 'none medium', 'CurrentColor NONE Medium', 'medium none currentcolor']) {
      expect(parsed(`column-rule: ${v}`), v).toEqual(['column-rule-width: medium', 'column-rule-style: none', 'column-rule-color: currentcolor']);
    }
    expect(parsed('column-rule: none none')).toEqual(['column-rule-width: ?none none', 'column-rule-style: ?none none', 'column-rule-color: ?none none']);
    expect(parsed('column-rule: medium none currentcolor none')[0]).toBe('column-rule-width: ?medium none currentcolor none');
    expect(parsed('column-rule: 1px solid red')).toEqual(['column-rule-width: ?1px solid red', 'column-rule-style: ?1px solid red', 'column-rule-color: ?1px solid red']);
    expect(parsed('column-rule: thin')[0]).toBe('column-rule-width: ?thin');
    expect(parsed('column-count: 1')).toEqual(['column-count: 1']);
    expect(parsed('column-count: +3')).toEqual(['column-count: 3']);
    // Chrome keeps column-count as a uint16.
    expect(parsed('column-count: 70000')).toEqual(['column-count: 65535']);
    expect(parsed('column-count: 99999999999999999999')).toEqual(['column-count: 65535']);
    expect(parsed('column-width: 0')).toEqual(['column-width: 0px']);
    expect(parsed('column-width: 12.5px')).toEqual(['column-width: 12.5px']);
    // Spellings Dragon does not read are kept and refused: a count of 0, a fraction, two counts, a font-relative or negative width.
    expect(parsed('column-count: 0')).toEqual(['column-count: ?0']);
    expect(parsed('column-count: 2.0')).toEqual(['column-count: ?2.0']);
    expect(parsed('column-count: 2 3')).toEqual(['column-count: ?2 3']);
    expect(parsed('column-width: 5em')).toEqual(['column-width: ?5em']);
    expect(parsed('column-width: -1px')).toEqual(['column-width: ?-1px']);
    expect(parsed('column-width: 10px 2')).toEqual(['column-width: ?10px 2']);
    expect(parsed('column-rule-width: 0px')).toEqual(['column-rule-width: ?0px']);
    expect(parsed('column-rule-color: rgb(20, 40, 160)')).toEqual(['column-rule-color: ?rgb(20,40,160)']);
    // Values webref lists though Chrome 145 lacks them are kept and refused, never dropped.
    expect(parsed('column-span: 2')).toEqual(['column-span: ?2']);
    expect(parsed('column-fill: balance-all')).toEqual(['column-fill: ?balance-all']);
    expect(parsed('column-rule-style: none, solid')).toEqual(['column-rule-style: ?none , solid']);
  });

  it('accepts the initial values on every target, from any spelling and through the CSS-wide keywords', () => {
    for (const d of INITIAL_DECLS) expect(errorsAt(d), d).toEqual([]);
    expect(errorsAt('columns: initial; column-rule: unset; column-span: revert; column-fill: initial', NO_FAULTS, 'columns: inherit; column-rule: inherit; column-span: inherit; column-fill: inherit')).toEqual([]);
    // currentcolor is kept as the keyword, so a colour change on the element or a child changes nothing Dragon checks.
    expect(errorsAt('color: red; column-rule-color: currentcolor', NO_FAULTS, 'color: blue; column-rule-color: inherit')).toEqual([]);
    // The later declaration wins between a shorthand and its longhand.
    expect(errorsAt('column-count: 3; columns: auto')).toEqual([]);
    expect(errorsAt('column-rule: 2px dotted red; column-rule: none')).toEqual([]);
    expect(errorsAt('--a: auto; columns: var(--a) var(--a)')).toEqual([]);
  });

  it('refuses every other value on every target, once per element, computed', () => {
    for (const d of ['column-count: 2', 'column-width: 100px', 'columns: 2', 'columns: 10em auto', 'column-rule: 1px solid red', 'column-rule-style: solid',
      'column-rule-width: thin', 'column-rule-color: red', 'column-span: all', 'column-fill: auto', '-webkit-column-count: 3', '-webkit-column-rule: thick']) {
      expect(errorsAt(d), d).toEqual(REFUSED);
    }
    expect(errorsAt('column-count: 2; column-rule: 1px solid red; column-span: all')).toEqual(REFUSED);
    expect(errorsAt('column-count: 2; content-visibility: hidden')).toEqual([...REFUSED, ...REFUSED].sort());
    expect(errorsAt('--n: 2; column-count: var(--n)')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { -webkit-columns: 2 10em; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^column-width: 2 10em on <div> a makes a multi-column container Dragon does not lay out: column-width is a px length or auto \(column-width\), or a positive integer or auto \(column-count\), in Dragon$/);
  });

  it('refuses a value a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { column-span: all; } .c { column-span: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['column-span: all on <div> a', 'column-span: all on <div> a', 'column-span: all on <div> a', 'column-span: all on <div> b', 'column-span: all on <div> b', 'column-span: all on <div> b']);
  });

  it('plants its fault: a non-initial multicol value compiles, and only the multicol family\'s', () => {
    expect(errorsAt('column-count: 2; column-rule: 1px solid red', { ...NO_FAULTS, multicolAccepted: true })).toEqual([]);
    expect(errorsAt('column-count: 2', { ...NO_FAULTS, containmentAccepted: true })).toEqual(REFUSED);
    expect(errorsAt('content-visibility: hidden', { ...NO_FAULTS, multicolAccepted: true })).toEqual(REFUSED);
  });
});

describe('multi-column containers', () => {
  const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
  const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
  type Body = Parameters<typeof inputFor>[1];
  const own: Body = (r) => [el(r, 'a', 'div', ['a'], [text(r, 't', 'XX XX XX'), el(r, 'b', 'br'), text(r, 't2', 'XX')])];
  const compile = (css: string, body: Body = own, faults: CompilerFaults = NO_FAULTS) => project(faults).compile(inputFor(`${FONT} ${css}`, body));
  const messages = (c: ReturnType<typeof compile>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.message}`);

  function lowered(c: ReturnType<typeof compile>, id: string): LayoutBox {
    const p = iosLayoutProjection(c, ENV, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const find = (b: LayoutBox): LayoutBox | undefined => (b.id === id ? b : b.children.flatMap((k) => (k.kind === 'box' ? [find(k)] : [])).find((x) => x !== undefined));
    const hit = find(p.input.root);
    if (hit === undefined) throw new Error(`no box ${id}`);
    return hit;
  }

  it('lowers a block of text and <br>s with a px column-width or a column-count to LayoutStyle.multicol', () => {
    const cases: [string, unknown][] = [
      ['column-count: 3', { count: 3, width: { kind: 'auto' } }],
      ['column-width: 80px', { count: 0, width: { kind: 'px', value: 80 } }],
      ['columns: 2 120px; column-gap: 7px', { count: 2, width: { kind: 'px', value: 120 } }],
      ['-webkit-columns: 0', { count: 0, width: { kind: 'px', value: 0 } }],
      ['column-count: 2; text-align: center; text-indent: 4px; padding: 3px; border: 1px solid; width: 50%', { count: 2, width: { kind: 'auto' } }],
      ['column-count: 70000; position: relative; top: 2px', { count: 65535, width: { kind: 'auto' } }],
      ['columns: auto', null],
      ['column-count: 2; column-count: auto', null],
    ];
    for (const [decl, want] of cases) {
      const c = compile(`.a { ${decl}; }`);
      expect(messages(c), decl).toEqual([]);
      expect(lowered(c, 'a').style.multicol, decl).toEqual(want);
    }
    // A child in a display: none subtree is never laid out, so its columns are not refused.
    // A <br> hidden with display: none is no box at all.
    expect(messages(compile('.a { column-count: 2; } br { display: none; }'))).toEqual([]);
    const hidden = compile('.h { display: none; } .a { column-count: 2; }', (r) => [el(r, 'h', 'div', ['h'], [el(r, 'a', 'div', ['a'], [el(r, 'b', 'span', [], [text(r, 't', 'XX')])])])]);
    expect(messages(hidden)).toEqual([]);
  });

  it('refuses on every target a container the engine does not lay out; multicolAccepted accepts it', () => {
    const nest = (outer: string): Body => (r) => [el(r, 'o', 'div', [outer], [el(r, 'a', 'div', ['a'], [text(r, 't', 'XX XX')])])];
    const cases: [string, Body, string][] = [
      ['.a { column-count: 2; }', (r) => [el(r, 'a', 'div', ['a'], [text(r, 't', 'XX '), el(r, 's', 'span', [], [text(r, 'u', 'XX')])])], 'it holds <span> s, and only text and <br> are proven'],
      ['.a { column-count: 2; }', (r) => [el(r, 'a', 'div', ['a'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])], 'it holds <div> b, and only text and <br> are proven'],
      ['.a { column-count: 2; display: inline-block; }', own, 'the container is display: inline-block, not block'],
      ['.a { column-count: 2; position: absolute; }', own, 'the container is positioned absolute'],
      ['.a { column-count: 2; float: left; }', own, 'the container floats'],
      ['.a { column-count: 2; width: fit-content; }', own, 'the container has width: fit-content'],
      ['.o { display: flex; } .a { column-count: 2; }', nest('o'), 'its ancestor <div> o is display: flex, not block'],
      ['.o { float: right; } .a { column-count: 2; }', nest('o'), 'its ancestor <div> o floats'],
      ['.o { width: max-content; } .a { column-count: 2; }', nest('o'), 'its ancestor <div> o has width: max-content'],
      ['.a { column-count: 2; overflow: hidden; }', own, 'it clips its overflow'],
      ['.a { column-count: 2; height: 40px; }', own, 'it has a specified block size'],
      ['.a { column-count: 2; max-height: 40px; }', own, 'it has a specified block size'],
      ['.a { column-count: 2; min-height: 1px; }', own, 'it has a specified block size'],
      ['.a { column-count: 2; column-gap: 10%; }', own, 'its column gap is not a px length or normal'],
      ['.a { column-count: 2; text-indent: 10%; }', own, 'its text-indent is not a px length'],
      ['.a { column-count: 2; white-space: pre; }', own, 'it preserves white space'],
      ['.a { column-count: 2; text-wrap-mode: nowrap; }', own, 'its lines do not wrap'],
      ['.a { column-count: 2; orphans: 3; }', own, 'its orphans is not 2'],
      ['.a { column-count: 2; widows: 1; }', own, 'its widows is not 2'],
      ['.a { column-count: 2; container-type: inline-size; }', own, 'it is contained'],
      ['.a { column-count: 2; aspect-ratio: 2 / 1; }', own, 'it has aspect-ratio: 2 / 1'],
      ['.a { column-count: 2; zoom: 2; }', own, 'it is under zoom (effective zoom 2)'],
      ['.o { zoom: 1.5; } .a { column-count: 2; }', nest('o'), 'it is under zoom (effective zoom 1.5)'],
      ['.a { column-count: 2; } br { display: block; }', own, 'it holds <br> b with display: block and float: none, and only an inline <br> is proven'],
      ['.a { column-count: 2; } br { float: left; }', own, 'it holds <br> b with display: block and float: left, and only an inline <br> is proven'],
      ['.a { column-count: 2; } br { display: flex; }', own, 'it holds <br> b with display: flex and float: none, and only an inline <br> is proven'],
      ['.a { column-count: 2; } br { display: inline-block; }', own, 'it holds <br> b with display: inline-block and float: none, and only an inline <br> is proven'],
    ];
    for (const [css, body, why] of cases) {
      const c = compile(css, body);
      const p = css.includes('column-width') ? 'column-width: ' : 'column-count: 2';
      expect(messages(c).filter((m) => m.includes(' makes a multi-column container ')), css).toEqual(['android', 'ios', 'web'].map((t) => `${t} ${p} on <div> a makes a multi-column container Dragon does not lay out: ${why}`));
      expect(messages(compile(css, body, { ...NO_FAULTS, multicolAccepted: true })).filter((m) => m.includes(' makes a multi-column container ')), css).toEqual([]);
    }
  });
});
