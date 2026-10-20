// css-text-4 §5.1: text-wrap-style and the text-wrap shorthand. auto and stable compile on every target, and text-wrap: nowrap sets
// text-wrap-mode as white-space: nowrap does; balance and pretty are refused where they are parsed. The Chrome cases are
// text-wrap-ahem and reject-text-wrap-balance (packages/parity/fixtures); text-wrap-parse.test.ts pins the grammar.
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
    for (const v of ['balance', 'pretty', 'Balance']) expect(parsed('text-wrap-style', v), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    for (const v of ['avoid-orphans', 'nowrap', 'wrap', 'auto stable', 'none']) expect(parsed('text-wrap-style', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('expands text-wrap to text-wrap-mode and text-wrap-style, an omitted one at its initial value', () => {
    expect(parsed('text-wrap', 'nowrap')).toEqual(['text-wrap-mode: nowrap', 'text-wrap-style: auto!']);
    expect(parsed('text-wrap', 'wrap')).toEqual(['text-wrap-mode: wrap', 'text-wrap-style: auto!']);
    expect(parsed('text-wrap', 'stable')).toEqual(['text-wrap-mode: wrap!', 'text-wrap-style: stable']);
    expect(parsed('text-wrap', 'stable nowrap')).toEqual(['text-wrap-mode: nowrap', 'text-wrap-style: stable']);
    expect(parsed('text-wrap', 'NoWrap auto')).toEqual(['text-wrap-mode: nowrap', 'text-wrap-style: auto']);
    expect(parsed('text-wrap', 'inherit')).toEqual(['text-wrap-mode: inherit', 'text-wrap-style: inherit']);
    for (const v of ['balance', 'nowrap pretty']) expect(parsed('text-wrap', v), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    for (const v of ['nowrap wrap', 'auto stable', 'avoid-orphans', 'none']) expect(parsed('text-wrap', v), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
  });

  it('compiles auto, stable and both modes on every target', () => {
    for (const d of ['text-wrap: nowrap', 'text-wrap: wrap', 'text-wrap: stable', 'text-wrap-style: auto', 'text-wrap-style: stable', 'text-wrap: nowrap stable']) expect(errorsAt(d), d).toEqual([]);
  });

  it('refuses balance and pretty where they are parsed, so on every target', () => {
    for (const d of ['text-wrap: balance', 'text-wrap: pretty', 'text-wrap-style: balance']) expect(errorsAt(d), d).toEqual(['null DRAGON_UNSUPPORTED_VALUE']);
  });
});
