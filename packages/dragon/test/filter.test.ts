// FX: filter is accepted at none alone, on every target, and -webkit-filter is its alias; any other value is kept as Chrome keeps it
// and refused where it applies, since no target draws filters and a filter can hide text. The Chrome cases are filter-none and
// reject-filter-function (packages/parity/fixtures); packages/parity/test/filter-parse.test.ts pins the parse against Chrome.
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/filter.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostics as `code message`. */
function parsed(decl: string): string[] {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => `${d.code} ${d.message}`);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text in a child of the element the declarations are on. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('filter', () => {
  it('parses none in any case, through -webkit-filter too, and keeps every other value', () => {
    expect(parsed('filter: none')).toEqual(['filter: none']);
    expect(parsed('filter: NONE')).toEqual(['filter: none']);
    expect(parsed('-webkit-filter: none')).toEqual(['filter: none']);
    expect(parsed('-WEBKIT-FILTER: None')).toEqual(['filter: none']);
    expect(parsed('filter: blur(4px)')).toEqual(['filter: blur(4px)']);
    // Values webref's grammar would drop, which Chrome may keep, are kept so that they are refused rather than ignored.
    for (const v of ['opacity(0)', 'brightness(-1)', 'none none', 'url(#f) grayscale(1)', 'drop-shadow(0 0 2px #000)']) expect(parsed(`filter: ${v}`), v).toHaveLength(1);
    expect(parsed('filter: inherit')).toEqual(['filter: inherit']);
  });

  it('accepts none on every target, from either name and through the CSS-wide keywords', () => {
    expect(errorsAt('filter: none')).toEqual([]);
    expect(errorsAt('-webkit-filter: none')).toEqual([]);
    expect(errorsAt('filter: initial')).toEqual([]);
    expect(errorsAt('filter: inherit')).toEqual([]);
    // The later declaration wins between the alias and its property, as in Chrome.
    expect(errorsAt('filter: blur(2px); -webkit-filter: none')).toEqual([]);
    expect(errorsAt('-webkit-filter: blur(2px); filter: none')).toEqual([]);
  });

  it('refuses every other filter on every target, once where it applies', () => {
    for (const v of ['blur(4px)', 'grayscale(1)', 'brightness(.8)', 'opacity(0)', 'drop-shadow(0 0 2px #000)', 'url(#f)', 'bogus']) expect(errorsAt(`filter: ${v}`), v).toEqual(REFUSED);
    expect(errorsAt('-webkit-filter: opacity(0)')).toEqual(REFUSED);
    expect(errorsAt('filter: none; -webkit-filter: brightness(0)')).toEqual(REFUSED);
    // A filter that arrives through var() is refused as well, and none through var() is accepted.
    expect(errorsAt('--f: opacity(0); filter: var(--f)')).toEqual(REFUSED);
    expect(errorsAt('--f: none; -webkit-filter: var(--f)')).toEqual([]);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { filter: opacity(0); }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^filter: opacity\(0\) on <div> a is unsupported: /);
  });

  it('refuses a filter that a child inherits explicitly, on the child too', () => {
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { filter: blur(1px); } .c { filter: inherit; }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', ['c'], [text(r, 't', 'XX')])])]));
    const at = c.diagnostics.filter((x) => x.severity === 'error').map((d) => d.message.split(' is unsupported')[0]).sort();
    expect(at).toEqual(['filter: blur(1px) on <div> a', 'filter: blur(1px) on <div> a', 'filter: blur(1px) on <div> a', 'filter: blur(1px) on <div> b', 'filter: blur(1px) on <div> b', 'filter: blur(1px) on <div> b']);
  });

  it('plant filterListAccepted: a filter list compiles', () => {
    expect(errorsAt('filter: blur(4px)', { ...NO_FAULTS, filterListAccepted: true })).toEqual([]);
  });
});
