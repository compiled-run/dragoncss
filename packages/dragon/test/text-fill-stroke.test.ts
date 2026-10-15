// TXT-FX: -webkit-text-fill-color, -webkit-text-stroke-width, -webkit-text-stroke-color and the -webkit-text-stroke shorthand. A fill
// of currentcolor and a stroke of width 0 in any colour compile on every target; any other fill colour or a wider stroke over text
// is refused. The Chrome cases are text-fill-stroke-initial and reject-text-fill-color (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/text-fill-stroke.css', revision: 'r1', hash: 'sha256:0' };

/** The longhands one declaration sets as `property: value` (! when implicit), or its diagnostic codes. */
function parsed(property: string, value: string): string[] {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.length > 0) return diagnostics.map((d) => d.code);
  return (rules[0]?.declarations[0]?.longhands ?? []).map((l) => `${l.property}: ${valueToString(l.value)}${l.explicit ? '' : '!'}`);
}

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <code>` for Ahem text inheriting the declaration through a child. */
function errorsAt(decl: string, faults: CompilerFaults = NO_FAULTS): string[] {
  const css = `body { font-family: Ahem; font-size: 10px; } .s { ${decl}; }`;
  const c = project(faults).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [el(r, 'b', 'div', [], [text(r, 't', 'XX')])])]));
  return c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code}`).sort();
}

const REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE', 'web DRAGON_UNSUPPORTED_VALUE'];

describe('the text fill colour and stroke', () => {
  it('expands -webkit-text-stroke to width and colour, an omitted one at its initial value', () => {
    expect(parsed('-webkit-text-stroke', '0')).toEqual(['-webkit-text-stroke-width: 0px', '-webkit-text-stroke-color: currentcolor!']);
    expect(parsed('-webkit-text-stroke', 'red')).toEqual(['-webkit-text-stroke-width: 0px!', '-webkit-text-stroke-color: red']);
    expect(parsed('-webkit-text-stroke', 'blue 2px')).toEqual(['-webkit-text-stroke-width: 2px', '-webkit-text-stroke-color: blue']);
    expect(parsed('-webkit-text-stroke', 'thin')).toEqual(['-webkit-text-stroke-width: thin', '-webkit-text-stroke-color: currentcolor!']);
    for (const v of ['red blue', '1px 2px', '-1px', 'auto']) expect(parsed('-webkit-text-stroke', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles a currentcolor fill and a zero-width stroke of any colour on every target', () => {
    for (const d of ['-webkit-text-fill-color: currentcolor', '-webkit-text-stroke-width: 0', '-webkit-text-stroke: 0 red', '-webkit-text-stroke-color: blue', '-webkit-text-stroke: green', '-webkit-text-fill-color: currentColor; color: red']) expect(errorsAt(d), d).toEqual([]);
  });

  it('refuses another fill colour or a wider stroke over text on every target', () => {
    for (const d of ['-webkit-text-fill-color: red', '-webkit-text-fill-color: transparent', '-webkit-text-stroke-width: 1px', '-webkit-text-stroke: thin', '-webkit-text-stroke: 2px blue']) expect(errorsAt(d), d).toEqual(REFUSED);
  });

  it('plants textFillColorAccepted and textStrokeAccepted: each lets its own value compile, and only it', () => {
    expect(errorsAt('-webkit-text-fill-color: red', { ...NO_FAULTS, textFillColorAccepted: true })).toEqual([]);
    expect(errorsAt('-webkit-text-stroke-width: 1px', { ...NO_FAULTS, textFillColorAccepted: true })).toEqual(REFUSED);
    expect(errorsAt('-webkit-text-stroke-width: 1px', { ...NO_FAULTS, textStrokeAccepted: true })).toEqual([]);
    expect(errorsAt('-webkit-text-fill-color: red', { ...NO_FAULTS, textStrokeAccepted: true })).toEqual(REFUSED);
  });
});
