// TXT-FX: text-shadow parses as Chrome parses it. Every target takes none and a list of px lengths and colours; iOS and Android
// refuse a list on text they do not draw as Chrome does (analysis/text-shadow.ts). The Chrome cases are text-shadow-none,
// text-shadow-blur and reject-text-shadow-list (packages/parity/fixtures).
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
const NATIVE_REFUSED = ['android DRAGON_UNSUPPORTED_VALUE', 'ios DRAGON_UNSUPPORTED_VALUE'];

/** Each text-shadow error as `<target> <code>` for a whole body. */
function errorsIn(css: string, body: (r: SourceRef) => TreeNode[]): string[] {
  const c = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${css}`, body));
  return c.diagnostics.filter((d) => d.severity === 'error' && d.message.startsWith('text-shadow')).map((d) => `${String(d.target)} ${d.code}`).sort();
}

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

  it('accepts a px list with colours on every target over single-line Ahem text, blurred or not', () => {
    expect(errorsAt('text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5)')).toEqual([]);
    expect(errorsAt('text-shadow: 1px 1px red, 2px 2px 3px blue')).toEqual([]);
    expect(errorsAt('text-shadow: 3px 6px 4px rgb(200, 0, 0)')).toEqual([]);
  });

  it('refuses a length other than px, or currentcolor, on every target, once where it is declared', () => {
    expect(errorsAt('text-shadow: 0 1px 0.2em rgba(0, 0, 0, 0.5)')).toEqual(REFUSED);
    expect(errorsAt('text-shadow: 1px 1px 2px')).toEqual(REFUSED);
    const css = 'body { font-family: Ahem; font-size: 10px; } .s { text-shadow: 0 1px 0.2em rgba(0, 0, 0, 0.5); }';
    const c = project(NO_FAULTS).compile(inputFor(css, (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])]));
    const errors = c.diagnostics.filter((x) => x.severity === 'error');
    expect(errors).toHaveLength(3);
    for (const d of errors) expect(d.message).toMatch(/^text-shadow: rgba\(0, 0, 0, 0\.5\) 0px 1px 0\.2em on <div> a is unsupported on (ios|android|web): the length 0\.2em is not in px$/);
  });

  it('refuses on iOS and Android what the native shadow does not draw as Chrome does, and accepts it on web', () => {
    const shadow = '.s { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }';
    const one = (cls: string, t: string) => (r: SourceRef) => [el(r, 'a', 'div', ['s', ...cls.split(' ').filter((c) => c !== '')], [text(r, 't', t)])];
    // Text that may wrap: a space, or a break-anywhere rule.
    expect(errorsIn(shadow, one('', 'XX XX'))).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .w { overflow-wrap: anywhere; }`, one('w', 'XX'))).toEqual(NATIVE_REFUSED);
    // nowrap takes one line whatever the text.
    expect(errorsIn(`${shadow} .n { white-space: nowrap; }`, one('n', 'XX XX'))).toEqual([]);
    // Decorated, in a group, or with an ellipsis (a real face is refused on the native targets already).
    expect(errorsIn(`${shadow} .u { text-decoration: underline; }`, one('u', 'XX'))).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .o { opacity: 0.5; }`, one('o', 'XX'))).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .e { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`, one('e', 'XX'))).toEqual(NATIVE_REFUSED);
    // A later box painting a background, which Chrome paints beneath the shadow; an earlier one is fine.
    const later = (r: SourceRef) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['g'], [])];
    const earlier = (r: SourceRef) => [el(r, 'b', 'div', ['g'], []), el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])];
    expect(errorsIn(`${shadow} .g { height: 10px; background-color: red; }`, later)).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .g { height: 10px; background-color: red; }`, earlier)).toEqual([]);
  });

  it('plant textShadowListAccepted: every list compiles', () => {
    expect(errorsAt('text-shadow: 0 1px 0.2em rgba(0, 0, 0, 0.5)', { ...NO_FAULTS, textShadowListAccepted: true })).toEqual([]);
  });
});
