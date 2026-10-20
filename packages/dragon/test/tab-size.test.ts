// TXT2-c3 first slice: tab-size parses as Chrome parses it (TabSize::ParseSingleValue: a number first, then a length, neither
// negative) and compiles on every target; a preserved tab stays refused with 'tab-stop', and a calculation is refused. The Chrome
// cases are text-tab-size-ahem and reject-text-tab-size-calc (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/tab-size.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value`, or its diagnostics as `code`. */
function parsed(value: string): string[] {
  const css = `.a { tab-size: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text, inheriting the declaration through a child. */
function errorsAt(decl: string, content = 'XX XX', faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', content)])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}


describe('tab-size', () => {
  it('parses a number first, then a length, and drops what Chrome drops', () => {
    expect(parsed('4')).toEqual(['tab-size: 4']);
    expect(parsed('0')).toEqual(['tab-size: 0']);
    expect(parsed('2.5')).toEqual(['tab-size: 2.5']);
    expect(parsed('20px')).toEqual(['tab-size: 20px']);
    expect(parsed('1.5em')).toEqual(['tab-size: 1.5em']);
    expect(parsed('inherit')).toEqual(['tab-size: inherit']);
    for (const v of ['-1', '-1px', '10%', 'auto', '4 4', '4deg']) expect(parsed(v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    for (const v of ['calc(2 * 3)', 'calc(2px + 1em)', 'max(4px, 1em)']) expect(parsed(v), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
  });

  it('compiles on every target over text without a preserved tab', () => {
    for (const d of ['tab-size: 4', 'tab-size: 0', 'tab-size: 20px', 'tab-size: 2em', 'tab-size: 8; white-space: pre']) expect(errorsAt(d), d).toEqual([]);
    expect(errorsAt('tab-size: 4', 'XX\tXX')).toEqual([]);
  });

  it('still refuses a preserved tab, whatever tab-size is', () => {
    expect(errorsAt('tab-size: 4; white-space: pre', 'XX\tXX').length).toBeGreaterThan(0);
  });

  it('refuses a calculation where it is parsed, so on every target', () => {
    expect(errorsAt('tab-size: calc(2 * 3)')).toEqual(['null DRAGON_UNSUPPORTED_VALUE']);
  });
});
