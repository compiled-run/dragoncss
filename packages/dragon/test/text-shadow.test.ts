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
import { TEXT_SHADOW_MAX_BLUR_PX, TEXT_SHADOW_MAX_DEVICE_PX, TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX, TEXT_SHADOW_MAX_SHADOWS, textShadowWork } from '../src/analysis/text-shadow.ts';

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
    expect(errorsIn(`${shadow} .b { font-weight: 700; }`, one('b', 'XX'))).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .i { font-style: italic; }`, one('i', 'XX'))).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .b { font-weight: 700; font-synthesis: none; }`, one('b', 'XX'))).toEqual([]);
    expect(errorsIn(`${shadow} .o { opacity: 0.5; }`, one('o', 'XX'))).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .e { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }`, one('e', 'XX'))).toEqual(NATIVE_REFUSED);
    // A later box painting a background, which Chrome paints beneath the shadow; an earlier one is fine.
    const later = (r: SourceRef) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['g'], [])];
    const earlier = (r: SourceRef) => [el(r, 'b', 'div', ['g'], []), el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])];
    expect(errorsIn(`${shadow} .g { height: 10px; background-color: red; }`, later)).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`${shadow} .g { height: 10px; background-color: red; }`, earlier)).toEqual([]);
  });

  it('refuses on iOS and Android an ellipsis on the block container of a shadowed inline (text-overflow is not inherited)', () => {
    const css = '.s { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); } .e { width: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }';
    const tree = (r: SourceRef) => [el(r, 'a', 'div', ['e'], [el(r, 'b', 'span', ['s'], [text(r, 't', 'XXXXXXXXXX')])])];
    expect(errorsIn(css, tree)).toEqual(NATIVE_REFUSED);
    const deep = (r: SourceRef) => [el(r, 'a', 'div', ['e'], [el(r, 'b', 'span', [], [el(r, 'c', 'span', ['s'], [text(r, 't', 'XXXXXXXXXX')])])])];
    expect(errorsIn(css, deep)).toEqual(NATIVE_REFUSED);
  });

  it('accepts text-overflow on a shadowed inline itself, which has no effect on an inline', () => {
    const css = '.s { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); text-overflow: ellipsis; }';
    expect(errorsIn(css, (r) => [el(r, 'a', 'div', [], [el(r, 'b', 'span', ['s'], [text(r, 't', 'XX')])])])).toEqual([]);
  });

  it('bounds the native work: blur, shadow count and rastered pixels, pinned', () => {
    expect([TEXT_SHADOW_MAX_BLUR_PX, TEXT_SHADOW_MAX_SHADOWS, TEXT_SHADOW_MAX_DEVICE_PX, TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX]).toEqual([16, 4, 800_000, 3_000_000]);
    const one = (r: SourceRef) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])];
    expect(errorsIn('.s { text-shadow: 0 0 16px red; }', one)).toEqual([]);
    expect(errorsIn('.s { text-shadow: 0 0 17px red; }', one)).toEqual(NATIVE_REFUSED);
    expect(errorsIn('.s { text-shadow: 0 0 5000px red; }', one)).toEqual(NATIVE_REFUSED);
    expect(errorsIn('.s { text-shadow: 1px 1px red, 1px 1px red, 1px 1px red, 1px 1px red; }', one)).toEqual([]);
    expect(errorsIn('.s { text-shadow: 1px 1px red, 1px 1px red, 1px 1px red, 1px 1px red, 1px 1px red; }', one)).toEqual(NATIVE_REFUSED);
    // A long nowrap line at a large size passes the pixel bound; the same at 10px does not.
    expect(errorsIn('.s { white-space: nowrap; font-size: 100px; text-shadow: 0 1px 2px red; }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'X'.repeat(40))])])).toEqual(NATIVE_REFUSED);
    expect(errorsIn('.s { white-space: nowrap; text-shadow: 0 1px 2px red; }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'X'.repeat(40))])])).toEqual([]);
    // Word spacing widens each space: a large one passes the pixel bound that the same line without it keeps inside.
    const spaced = (r: SourceRef) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'X X')])];
    expect(errorsIn('.s { white-space: nowrap; word-spacing: 2px; text-shadow: 0 0 16px red; }', spaced)).toEqual([]);
    expect(errorsIn('.s { white-space: nowrap; word-spacing: 2000px; text-shadow: 0 0 16px red; }', spaced)).toEqual(NATIVE_REFUSED);
    expect(textShadowWork(3, 1, 10, 0, 2000, [{ x: 0, y: 0, blur: 16 }])).toBeGreaterThan(TEXT_SHADOW_MAX_DEVICE_PX);
    expect(textShadowWork(3, 1, 10, 0, 0, [{ x: 0, y: 0, blur: 16 }])).toBeLessThan(TEXT_SHADOW_MAX_DEVICE_PX);
    // The text-shadow-blur fixture's widest line (five 40px glyphs, 2px 5px 3px) is well inside the bound.
    expect(textShadowWork(5, 0, 40, 0, 0, [{ x: 2, y: 5, blur: 3 }])).toBeLessThan(TEXT_SHADOW_MAX_DEVICE_PX / 2);
    const msg = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; font-size: 10px; } .s { text-shadow: 0 0 5000px red; }', one)).diagnostics.find((d) => d.target === 'ios');
    expect(msg?.message).toBe('text-shadow: rgb(255, 0, 0) 0px 0px 5000px on <div> a is unsupported on ios: a blur of 5000px is over the 16px the native shadow draws');
  });

  it('refuses on iOS and Android text a -webkit-line-clamp container clamps, inline in it or in a child block', () => {
    const css = '.c { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; width: 50px; } .s { text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5); }';
    const child = (r: SourceRef) => [el(r, 'c', 'div', ['c'], [el(r, 'a', 'div', ['s'], [text(r, 't', 'XXXXXXXXXXXXXXX')]), el(r, 'b', 'div', [], [text(r, 'u', 'YY')])])];
    expect(errorsIn(css, child)).toEqual(NATIVE_REFUSED);
    const fits = (r: SourceRef) => [el(r, 'c', 'div', ['c'], [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')]), el(r, 'b', 'div', [], [text(r, 'u', 'YY')])])];
    expect(errorsIn(css, fits)).toEqual(NATIVE_REFUSED);
    const span = (r: SourceRef) => [el(r, 'c', 'div', ['c'], [el(r, 'a', 'span', ['s'], [text(r, 't', 'XXXXXXXXXXXXXXX')])])];
    expect(errorsIn(css, span)).toEqual(NATIVE_REFUSED);
    const inline = (r: SourceRef) => [el(r, 'c', 'div', ['c', 's'], [text(r, 't', 'XXXXXXXXXXXXXXX')])];
    expect(errorsIn(css, inline)).toEqual(NATIVE_REFUSED);
  });

  it('refuses the lists after the document budget, keeping the ones before it', () => {
    const lines = (count: number) => (r: SourceRef) => [...Array(count).keys()].map((k) => el(r, `d${k}`, 'div', ['s'], [text(r, `t${k}`, 'X'.repeat(40))]));
    const css = '.s { white-space: nowrap; text-shadow: 0 1px 2px red; }';
    const one = textShadowWork(40, 0, 10, 0, 0, [{ x: 0, y: 1, blur: 2 }]);
    const fit = Math.floor(TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX / one);
    // One class declares the list, so the budget refuses the whole declaration once it is passed.
    expect(errorsIn(css, lines(fit))).toEqual([]);
    expect(errorsIn(css, lines(fit + 1))).toEqual(NATIVE_REFUSED);
  });

  it('plant textShadowListAccepted: every list compiles', () => {
    expect(errorsAt('text-shadow: 0 1px 0.2em rgba(0, 0, 0, 0.5)', { ...NO_FAULTS, textShadowListAccepted: true })).toEqual([]);
  });
});
