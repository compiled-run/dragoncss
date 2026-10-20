// The multicol family is accepted at its initial values alone, on every target; every other value is kept (the grammar takes any
// value, so Dragon never drops what Chrome keeps) and refused where it applies. The Chrome cases are multicol-initial and the two
// reject-multicol-* cases of fixture-groups/multicol.ts (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { initialValue, valueToString } from '../src/analysis/computed.ts';
import { resolveAlias } from '../src/css/aliases.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { DISCRETE, UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { INHERITED, LONGHANDS, PROPERTY_ROLE, SHORTHANDS } from '../src/css/properties.ts';
import { COUNTERS_LONGHANDS } from '../src/css/properties/counters.ts';
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
  it('follows counters in the registry, is paint-role rows, animates as Chrome 145 does and knows its initial values', () => {
    const at = LONGHANDS.indexOf(COUNTERS_LONGHANDS[COUNTERS_LONGHANDS.length - 1] as (typeof COUNTERS_LONGHANDS)[number]) + 1;
    expect(LONGHANDS.slice(at, at + MULTICOL_LONGHANDS.length)).toEqual([...MULTICOL_LONGHANDS]);
    for (const s of MULTICOL_SHORTHANDS) expect(SHORTHANDS, s).toContain(s);
    for (const p of MULTICOL_LONGHANDS) {
      expect(PROPERTY_ROLE[p], p).toBe('paint');
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
    expect(parsed('columns: auto 2')).toEqual(['column-width: ?auto 2', 'column-count: ?auto 2']);
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
    expect(parsed('column-count: 1')).toEqual(['column-count: ?1']);
    expect(parsed('column-width: 0')).toEqual(['column-width: ?0']);
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
    expect(errorsAt('column-count: 2; contain: paint')).toEqual([...REFUSED, ...REFUSED].sort());
    expect(errorsAt('--n: 2; column-count: var(--n)')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { -webkit-columns: 2 100px; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^column-width: 2 100px on <div> a is unsupported: Dragon implements no multi-column layout yet; only auto is accepted$/);
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
    expect(errorsAt('contain: paint', { ...NO_FAULTS, multicolAccepted: true })).toEqual(REFUSED);
  });
});
