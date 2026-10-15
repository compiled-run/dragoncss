// TXT-FX: text-shadow is accepted at none alone, on every target; a shadow list parses as Chrome parses it and is refused, since no
// target draws text shadows yet. The Chrome cases are text-shadow-none and reject-text-shadow-list (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/text-shadow.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostics as `code message`. */
function parsed(value: string): string[] {
  const css = `.a { text-shadow: ${value}; }`;
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

/** Each error as `<target> <code>` for Ahem text in a child of the element the declaration is on. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('text-shadow', () => {
  it('parses none and shadow lists, and drops what Chrome drops', () => {
    expect(parsed('none')).toEqual(['text-shadow: none']);
    expect(parsed('NONE')).toEqual(['text-shadow: none']);
    expect(parsed('0 1px 2px rgba(0, 0, 0, 0.5)')).toEqual(['text-shadow: rgba(0, 0, 0, 0.5) 0px 1px 2px']);
    expect(parsed('1px 1px red, 2px 2px blue')).toHaveLength(1);
    for (const v of ['1px 1px 1px 1px', 'inset 1px 1px', '1px 1px -1px', 'none, 1px 1px']) expect(parsed(v)[0], v).toMatch(/^DRAGON_CSS_INVALID_VALUE/);
  });

  it('accepts none on every target, inherited included', () => {
    expect(errorsAt('text-shadow: none')).toEqual([]);
  });

  it('refuses a shadow list on every target, once where it is declared', () => {
    expect(errorsAt('text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5)')).toEqual(REFUSED);
    expect(errorsAt('text-shadow: 1px 1px red, 2px 2px blue')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    for (const d of c.diagnostics.filter((x) => x.severity === 'error')) expect(d.message).toMatch(/^text-shadow: rgba\(0, 0, 0, 0\.5\) 0px 1px 2px on <div> a is unsupported: /);
  });

  it('plant textShadowListAccepted: a shadow list compiles', () => {
    expect(errorsAt('text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5)', { ...NO_FAULTS, textShadowListAccepted: true })).toEqual([]);
  });
});
