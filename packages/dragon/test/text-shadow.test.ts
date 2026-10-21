// TXT-FX: text-shadow parses as Chrome parses it. Every target takes none and a list of px lengths and colours; iOS and Android
// refuse a list on text they do not draw as Chrome does (analysis/text-shadow.ts). The Chrome cases are text-shadow-none,
// text-shadow-blur, text-shadow-wrap and reject-text-shadow-list (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import { TEXT_SHADOW_EMITTER } from '../src/emit/paint/text-shadow.ts';
import type { TextShadowWrite } from '../src/lower/paint/text-shadow.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';
import { boxBlurMargin, NO_BLUR_FAULTS, shadowSigma } from '@dragon/layout';
import {
  TEXT_SHADOW_MAX_BLUR_PX,
  TEXT_SHADOW_MAX_DEVICE_PX,
  TEXT_SHADOW_MAX_DOCUMENT_DEVICE_PX,
  TEXT_SHADOW_MAX_SHADOWS,
  TEXT_SHADOW_MIN_DEVICE_SCALE,
  TEXT_SHADOW_WRAP_BLUR_SLACK_DEVICE_PX,
  TEXT_SHADOW_WRAP_SLACK_DEVICE_PX,
  textShadowWork,
} from '../src/analysis/text-shadow.ts';

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
    // Text that may wrap (a space, or a break-anywhere rule) at line-height normal: the next line's shadow reaches this line's ink.
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

  it('accepts on iOS and Android a wrapping text whose lines are far enough apart that no line\'s shadow reaches the line above or the next line\'s shadow', () => {
    expect([TEXT_SHADOW_MIN_DEVICE_SCALE, TEXT_SHADOW_WRAP_SLACK_DEVICE_PX, TEXT_SHADOW_WRAP_BLUR_SLACK_DEVICE_PX]).toEqual([0.75, 3.5, 1]);
    const wrap = (r: SourceRef) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX XX')])];
    const at = (lh: string, list: string): string[] => errorsIn(`.s { line-height: ${lh}; text-shadow: ${list}; }`, wrap);
    // 10px Ahem: the gap is line-height less 10px; it must hold y less 1.5 blur over 3.5 / 0.75 px, or 4.5 / 0.75 = 6px when blurred.
    expect(at('30px', '0 1px 2px rgba(0, 0, 0, 0.5)')).toEqual([]);
    expect(at('12px', '0 1px 2px rgba(0, 0, 0, 0.5)')).toEqual(NATIVE_REFUSED);
    expect(at('15px', '0 0 0 red')).toEqual([]);
    expect(at('14.5px', '0 0 0 red')).toEqual(NATIVE_REFUSED);
    expect(at('1.5', '0 0 0 red')).toEqual([]);
    expect(at('1.4', '0 0 0 red')).toEqual(NATIVE_REFUSED);
    // A percentage line height computes to px of the font size (CALC-2), so 150% of 10px keeps the bound as 15px does.
    expect(at('150%', '0 0 0 red')).toEqual([]);
    expect(at('140%', '0 0 0 red')).toEqual(NATIVE_REFUSED);
    expect(at('normal', '0 0 0 red')).toEqual(NATIVE_REFUSED);
    // A negative y reaches further up; every shadow of the list must keep the bound, a transparent one excepted.
    expect(at('20px', '0 -5px 0 red')).toEqual([]);
    expect(at('20px', '0 -6px 0 red')).toEqual(NATIVE_REFUSED);
    expect(at('15px', '0 3px 0 red, 0 0 4px blue')).toEqual(NATIVE_REFUSED);
    expect(at('15px', '0 3px 0 red, 0 0 4px transparent')).toEqual([]);
    // No two lines' shadows may meet: the gap less the lowest reach below a line and the highest above the next keeps the same slack,
    // one blur slack per blurred end (each line's layer is encoded over the backdrop alone).
    expect(at('40px', '0 8px 16px rgba(0, 0, 0, 0.5)')).toEqual(NATIVE_REFUSED);
    expect(at('30px', '0 3px 0 red, 0 20px 0 blue')).toEqual(NATIVE_REFUSED);
    expect(at('30px', '0 3px 0 red, 0 10px 0 blue')).toEqual([]);
    expect(at('30px', '0 0 4px red')).toEqual([]);
    expect(at('25px', '0 0 4px red')).toEqual(NATIVE_REFUSED);
    // Each shadow pair takes its own blur slack: a hard shadow reaching further below does not hide a blurred one's.
    expect(at('30px', '0 3px 4.6px blue')).toEqual(NATIVE_REFUSED);
    expect(at('30px', '0 10px 0 red, 0 3px 4.6px blue')).toEqual(NATIVE_REFUSED);
    const meet = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; font-size: 10px; } .s { line-height: 40px; text-shadow: 0 8px 16px rgba(0, 0, 0, 0.5); }', wrap)).diagnostics.find((d) => d.target === 'ios');
    expect(meet?.message).toBe(
      'text-shadow: rgba(0, 0, 0, 0.5) 0px 8px 16px on <div> a is unsupported on ios: text a:text0 may wrap onto several lines, and the shadows of one line may meet the next line\'s, whose layer the device composites over the first instead of over the backdrop it is encoded against (line-height less font-size, less how far a shadow reaches below a line, 32px, and one above the next, 16px, is -18px, under 7.333333333333333px)',
    );
    // overflow-wrap: anywhere wraps a word too.
    expect(errorsIn('.s { line-height: 30px; overflow-wrap: anywhere; text-shadow: 0 1px 2px red; }', (r) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')])])).toEqual([]);
    const msg = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; font-size: 10px; } .s { line-height: 12px; text-shadow: 0 2px 0 red; }', wrap)).diagnostics.find((d) => d.target === 'ios');
    expect(msg?.message).toBe(
      'text-shadow: rgb(255, 0, 0) 0px 2px 0px on <div> a is unsupported on ios: text a:text0 may wrap onto several lines, and the shadow at 0px 2px blurred 0px of a line may reach the glyphs of the line above, which Chrome paints the shadow over (line-height less font-size, plus the y offset, less 1.5 times the blur, is 4px, under 4.666666666666667px)',
    );
  });

  it('the blur slack covers the device blur margin past 3 sigma at every blur the native shadow draws and every device scale', () => {
    let worst = -Infinity;
    for (let q = 1; q <= TEXT_SHADOW_MAX_BLUR_PX * 8; q++) {
      for (let s = TEXT_SHADOW_MIN_DEVICE_SCALE; s <= 4; s += 0.125) worst = Math.max(worst, boxBlurMargin(shadowSigma((q / 8) * s, NO_BLUR_FAULTS)) - 1.5 * (q / 8) * s);
    }
    expect(worst).toBeLessThan(TEXT_SHADOW_WRAP_BLUR_SLACK_DEVICE_PX);
  });

  it('bounds the work of a wrapping text by a layer per line', () => {
    const shadow = [{ x: 1, y: 2, blur: 4 }];
    expect(textShadowWork(5, 1, 10, 0, 0, shadow, 5)).toBeGreaterThan(textShadowWork(5, 1, 10, 0, 0, shadow));
    expect(textShadowWork(5, 1, 10, 0, 0, shadow, 1)).toBe(textShadowWork(5, 1, 10, 0, 0, shadow));
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

  it('composites a blurred or translucent shadow over another text it may meet in tree order, and refuses it over translucent glyphs', () => {
    // Each declaring element is refused once per target.
    const NATIVE_ONLY = (css: string, body: (r: SourceRef) => TreeNode[]): string[] => errorsIn(css, body);
    // Two block siblings 12px tall: their shadows and glyphs overlap (landing's repro). The device encodes b's shadows over Chrome's
    // paint of a's (emit/paint/text-shadow.ts), so they compile; with translucent glyphs, which the text view blends itself, they do not.
    const siblings = (r: SourceRef) => [el(r, 's', 'div', ['s'], [el(r, 'a', 'div', [], [text(r, 't', 'XX')]), el(r, 'b', 'div', [], [text(r, 'u', 'XX')])])];
    const blocks = '.s { line-height: 12px; background-color: #eef; text-shadow: 0 8px 16px rgba(0, 0, 0, 0.5); }';
    expect([...new Set(NATIVE_ONLY(blocks, siblings))]).toEqual([]);
    const translucent = `${blocks} .s { color: rgba(0, 0, 0, 0.6); }`;
    expect([...new Set(NATIVE_ONLY(translucent, siblings))]).toEqual(NATIVE_REFUSED);
    const msg = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${translucent}`, siblings)).diagnostics.find((d) => d.target === 'ios' && d.message.startsWith('text-shadow'));
    expect(msg?.message).toBe('text-shadow: rgba(0, 0, 0, 0.5) 0px 8px 16px on <div> s is unsupported on ios: text a:text0: its shadows and text b:text0 may meet (their vertical reaches, 0px and 0px, leave 2px between them, under 4.666666666666667px), and the device composites one text\'s shadows over another\'s paint only where tree order is their paint order, their glyphs are opaque and neither is moved off its line');
    // The same blocks far enough apart compile; so do hard opaque shadows, which cover exactly.
    expect(NATIVE_ONLY('.s { line-height: 12px; text-shadow: 0 8px 16px rgba(0, 0, 0, 0.5); } .s > div { margin-bottom: 60px; }', siblings)).toEqual([]);
    expect(NATIVE_ONLY('.s { line-height: 12px; text-shadow: 0 3px 0 red; }', siblings)).toEqual([]);
    // Two texts on one line, the blurs meeting at the seam (landing's repro): the later text's shadows composite over the earlier's paint.
    const seam = (r: SourceRef) => [el(r, 'p', 'div', [], [text(r, 't', 'XX'), el(r, 'b', 'span', ['s'], [text(r, 'u', 'XX')])])];
    expect(NATIVE_ONLY('.s { text-shadow: 0 0 6px rgba(0, 0, 0, 0.5); }', seam)).toEqual([]);
    const both = (r: SourceRef) => [el(r, 'p', 'div', ['s'], [text(r, 't', 'XX'), el(r, 'b', 'span', [], [text(r, 'u', 'XX')])])];
    // Both texts shadowed on one line: u's shadows composite over t's paint, as Chrome paints each text's shadows then its glyphs in order.
    expect(NATIVE_ONLY('.s { white-space: nowrap; text-shadow: 0 0 6px rgba(0, 0, 0, 0.5); }', both)).toEqual([]);
    expect(NATIVE_ONLY('.s { white-space: nowrap; text-shadow: 2px 2px 0 red; }', both)).toEqual([]);
    // Flex items kept apart by their margins on both axes when the row wraps; ink kept inside a px width it fits.
    const row = (r: SourceRef) => [el(r, 'f', 'div', ['f'], [el(r, 'a', 'div', ['w'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['w'], [text(r, 'u', 'XX')])])];
    const flex = (margin: string, width: string) => `.f { display: flex; flex-wrap: wrap; } .w { width: ${width}; margin: ${margin}; line-height: 20px; text-shadow: 0 0 4px red; }`;
    expect(NATIVE_ONLY(flex('12px', '30px'), row)).toEqual([]);
    // Close enough to meet: composited over opaque glyphs, refused over translucent ones.
    expect([...new Set(NATIVE_ONLY(flex('2px', '30px'), row))]).toEqual([]);
    const glass = ' .w { color: rgba(0, 0, 0, 0.5); }';
    expect(NATIVE_ONLY(flex('12px', '30px') + glass, row)).toEqual([]);
    expect([...new Set(NATIVE_ONLY(flex('2px', '30px') + glass, row))]).toEqual(NATIVE_REFUSED);
    // A px width narrower than the word lets the ink overflow toward the other item.
    expect([...new Set(NATIVE_ONLY(flex('12px', '10px') + glass, row))]).toEqual(NATIVE_REFUSED);
  });

  it('accepts a shadow whose meeting text paints later and opaque, and boxes kept apart by auto margins, list items, a grid gap or inline-block buttons', () => {
    // A shadowed heading above an unshadowed paragraph: the paragraph's opaque glyphs paint later and cover the shadow as in Chrome.
    const heading = (r: SourceRef) => [el(r, 'h', 'div', ['h'], [text(r, 't', 'XX')]), el(r, 'p', 'p', [], [text(r, 'u', 'XX')])];
    const h = '.h { font-size: 20px; margin: 0 0 10px; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5); }';
    expect(errorsIn(h, heading)).toEqual([]);
    // Translucent glyphs painted later, or the paragraph first and the heading's shadow over it, are refused.
    expect(errorsIn(`${h} p { color: rgba(0, 0, 0, 0.5); }`, heading)).toEqual(NATIVE_REFUSED);
    const above = (r: SourceRef) => [el(r, 'p', 'p', ['q'], [text(r, 'u', 'XX')]), el(r, 'h', 'div', ['h'], [text(r, 't', 'XX')])];
    expect(errorsIn(`${h} .q { margin: 0; }`, above)).toEqual([]);
    const shadow = 'text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);';
    const pair = (tag: string, cls: string) => (r: SourceRef) => [el(r, 'c', 'div', ['c'], [el(r, 'a', tag, [cls], [text(r, 't', 'XX')]), el(r, 'b', tag, [cls], [text(r, 'u', 'XX')])])];
    // Auto margins in a flex row add free space only.
    expect([...new Set(errorsIn(`.c { display: flex; } .i { width: 30px; margin: 0 auto 0 20px; ${shadow} }`, pair('div', 'i')))]).toEqual([]);
    // List items without a marker.
    expect([...new Set(errorsIn(`.c { margin: 0; padding: 0; } .i { list-style: none; margin-bottom: 24px; ${shadow} }`, (r) => [el(r, 'c', 'ul', ['c'], [el(r, 'a', 'li', ['i'], [text(r, 't', 'XX')]), el(r, 'b', 'li', ['i'], [text(r, 'u', 'XX')])])]))]).toEqual([]);
    expect([...new Set(errorsIn(`.c { margin: 0; padding: 0; } .i { margin-bottom: 24px; ${shadow} }`, (r) => [el(r, 'c', 'ul', ['c'], [el(r, 'a', 'li', ['i'], [text(r, 't', 'XX')]), el(r, 'b', 'li', ['i'], [text(r, 'u', 'XX')])])]))]).toEqual(NATIVE_REFUSED);
    // Auto-placed grid items, a gap apart on both axes.
    expect([...new Set(errorsIn(`.c { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; } .i { ${shadow} }`, pair('div', 'i')))]).toEqual([]);
    // A 2px gap lets the blurs meet; the later item's shadows composite over the earlier one's paint.
    expect([...new Set(errorsIn(`.c { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; } .i { ${shadow} }`, pair('div', 'i')))]).toEqual([]);
    // Two items placed in one cell overlap, and paint in tree order, so the later one's shadows composite over the earlier's paint.
    expect([...new Set(errorsIn(`.c { display: grid; gap: 24px; } .i { grid-area: 1 / 1; ${shadow} }`, pair('div', 'i')))]).toEqual([]);
    // Inline-block link buttons with margins on every side (Dragon has no <button>).
    expect([...new Set(errorsIn(`.i { display: inline-block; margin: 12px; ${shadow} }`, pair('a', 'i')))]).toEqual([]);
    expect([...new Set(errorsIn(`.i { display: inline-block; margin: 1px; ${shadow} }`, pair('a', 'i')))]).toEqual([]);
    expect([...new Set(errorsIn(`.i { display: inline-block; margin: 12px; color: rgba(0, 0, 0, 0.5); ${shadow} }`, pair('a', 'i')))]).toEqual([]);
    expect([...new Set(errorsIn(`.i { display: inline-block; margin: 1px; color: rgba(0, 0, 0, 0.5); ${shadow} }`, pair('a', 'i')))]).toEqual(NATIVE_REFUSED);
  });

  it('writes the earlier texts a layer composites over, and refuses animating their glyph colour', () => {
    const above = (r: SourceRef) => [el(r, 'p', 'p', ['q'], [text(r, 'u', 'XX')]), el(r, 'h', 'div', ['h'], [text(r, 't', 'XX')])];
    const css = 'body { font-family: Ahem; font-size: 10px; } .h { font-size: 20px; margin: 0 0 10px; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5); } .q { margin: 0; color: rgb(10, 20, 30); }';
    const c = project(NO_FAULTS).compile(inputFor(css, above));
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const programs = nativePrograms(c, []);
    if (programs.kind !== 'ready') throw new Error(programs.reason);
    const program = programs.programs.uikit;
    const writes = program.nodes.flatMap((n) => n.writes.filter((w) => w.kind === 'text-shadow').map((w) => [n.id, w] as const));
    expect(writes).toHaveLength(1);
    const [id, w] = writes[0] as readonly [string, Parameters<typeof TEXT_SHADOW_EMITTER.lines.uikit>[2]];
    expect(w.entries).toEqual([{ text: expect.stringMatching(/^h:/), shadows: [{ x: 0, y: 2, blur: 4, color: { r: 0, g: 0, b: 0, alpha: 128 } }], under: [{ text: expect.stringMatching(/^p:/), color: { r: 10, g: 20, b: 30, alpha: 255 }, shadows: [] }] }]);
    const node = program.nodes.find((n) => n.id === id) as (typeof program.nodes)[number];
    const [swift] = TEXT_SHADOW_EMITTER.lines.uikit('v', node, w);
    expect(swift).toMatch(/DragonTextShadowSpec\("h:[^"]*", \[ShadowInput\(false, 0\.0, 2\.0, 4\.0, 0\.0, 0\.0, 0\.0, 0\.0, 128\.0\)\], \[DragonTextShadowUnder\("p:[^"]*", 10\.0, 20\.0, 30\.0, \[\]\)\]\)/);
    const [kotlin] = TEXT_SHADOW_EMITTER.lines['android-views']('v', node, w);
    expect(kotlin).toMatch(/listOf\(DragonTextShadowUnder\("p:[^"]*", 10\.0, 20\.0, 30\.0, listOf\(\)\)\)\)\)\)$/);
    // An earlier text no layer composites over keeps the two-argument spec.
    const apart = nativePrograms(project(NO_FAULTS).compile(inputFor(css.replace('margin: 0;', 'margin: 0 0 60px;'), above)), []);
    if (apart.kind !== 'ready') throw new Error(apart.reason);
    const lone = apart.programs.uikit.nodes.flatMap((n) => n.writes.filter((x) => x.kind === 'text-shadow')) as TextShadowWrite[];
    expect(lone[0]?.entries[0]?.under).toEqual([]);
    // The device draws the earlier glyphs into the layer in their resting colour, so animating it is refused; on the far text it is not.
    const animated = (extra: string, body = css): string[] => project(NO_FAULTS).compile(inputFor(`${body} ${extra}`, above)).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.message.includes('composites over the text of p') ? 'under' : d.message}`).sort();
    expect(animated('.q { transition: color 1s; }')).toEqual(['android under', 'ios under']);
    expect(animated('@keyframes k { to { color: red; } } body { animation: k 1s; }')).toEqual(['android under', 'ios under']);
    expect(animated('.q { transition: color 1s; }', css.replace('margin: 0;', 'margin: 0 0 60px;'))).toEqual([]);
  });

  it('composites over an earlier text only where its path paints and clips nothing, its glyphs are plain and nothing moves either', () => {
    // u, wrapped in w, then a shadow from t reaching up over it.
    const pair = (r: SourceRef) => [el(r, 'w', 'div', ['w'], [el(r, 'u', 'div', ['u'], [text(r, 'x', 'XX')])]), el(r, 't', 'div', ['t'], [text(r, 'y', 'XX')])];
    const t = '.t { text-shadow: 0 -10px 6px rgba(200, 0, 0, 0.6); }';
    expect(errorsIn(t, pair)).toEqual([]);
    // An earlier text with four shadows of its own adds its glyph to the layer's work, not to its list.
    expect(errorsIn(`${t} .u { text-shadow: 1px 1px red, 2px 2px red, 3px 3px red, 4px 4px red; }`, pair)).toEqual([]);
    // A stacking context paints the earlier text after the later one's shadow; a clip cuts its shadows; a box's own paint is not in
    // the layer's backdrop; a stroke or small capitals are not plain glyphs.
    for (const w of ['isolation: isolate', 'overflow: hidden', 'background-color: rgb(250, 230, 200)', 'border-top: 1px solid red', 'clip-path: inset(0)']) {
      expect(errorsIn(`${t} .w { ${w}; }`, pair), w).toEqual(NATIVE_REFUSED);
    }
    // A scroll container around the later text moves its layer against the earlier text; one that only clips does not.
    const scroller = (r: SourceRef) => [el(r, 'u', 'div', ['u'], [text(r, 'x', 'XX')]), el(r, 'o', 'div', ['o'], [el(r, 't', 'div', ['t'], [text(r, 'y', 'XX')]), el(r, 'f', 'div', ['f'])])];
    const sc = (overflow: string): string => `${t} .o { overflow: ${overflow}; height: 60px; margin-top: -20px; } .f { height: 300px; }`;
    expect(errorsIn(sc('auto'), scroller)).toEqual(NATIVE_REFUSED);
    expect(errorsIn(sc('scroll'), scroller)).toEqual(NATIVE_REFUSED);
    expect(errorsIn(sc('hidden'), scroller)).toEqual([]);
    for (const u of ['-webkit-text-stroke: 1px black', 'font-variant-caps: small-caps']) {
      expect(errorsIn(`${t} .u { ${u}; }`, pair).filter((e) => e.startsWith('ios') || e.startsWith('android')), u).toEqual(expect.arrayContaining(NATIVE_REFUSED));
      const msg = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${t} .u { ${u}; }`, pair)).diagnostics.find((d) => d.target === 'ios' && d.message.startsWith('text-shadow'));
      expect(msg?.message, u).toMatch(/the device cannot composite them: text u:text0 (is stroked|has small capitals)/);
    }
    // Moving or fading either text below the pair's common ancestor leaves the layer composited at rest.
    const errors = (css: string): string[] => project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${t} ${css}`, pair)).diagnostics.filter((d) => d.severity === 'error' && (d.target === 'ios' || d.target === 'android')).map((d) => `${String(d.target)} ${/of its motion or opacity on (\w+)/.exec(d.message)?.[1] ?? d.message}`).sort();
    expect(errors('.w { transition: transform 1s; }')).toEqual(['android w', 'ios w']);
    expect(errors('@keyframes k { to { opacity: 0.5; } } .t { animation: k 1s; }')).toEqual(['android t', 'ios t']);
    expect(errors('@keyframes k { to { transform: translateX(4px); } } body { animation: k 1s; }')).toEqual([]);
  });

  it('refuses a shadow a relatively positioned inline box, a negative margin inside, or a shrinking px width may move into another text', () => {
    const shadow = 'text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);';
    // A span pulled up against the previous block (landing's repro).
    const pulled = (r: SourceRef) => [el(r, 'a', 'div', ['s'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['s', 'm'], [el(r, 'c', 'span', ['r'], [text(r, 'u', 'XX')])])];
    expect([...new Set(errorsIn(`.s { line-height: 20px; ${shadow} } .m { margin-top: 30px; }`, pulled))]).toEqual([]);
    expect([...new Set(errorsIn(`.s { line-height: 20px; ${shadow} } .m { margin-top: 30px; } .r { position: relative; top: -30px; }`, pulled))]).toEqual(NATIVE_REFUSED);
    // A negative margin-bottom on a block inside the first ends its auto height above its text.
    const nested = (r: SourceRef) => [el(r, 'a', 'div', ['s'], [el(r, 'n', 'div', ['n'], [text(r, 't', 'XX')])]), el(r, 'b', 'div', ['s', 'm'], [text(r, 'u', 'XX')])];
    expect([...new Set(errorsIn(`.s { line-height: 20px; ${shadow} } .m { margin-top: 30px; }`, nested))]).toEqual([]);
    expect([...new Set(errorsIn(`.s { line-height: 20px; ${shadow} } .m { margin-top: 30px; } .n { margin-bottom: -40px; }`, nested))]).toEqual([]);
    // A flex item's px width shrinks to min-width 0 on a full line, past its text; flex-shrink: 0 keeps it.
    const row = (r: SourceRef) => [el(r, 'c', 'div', ['c'], [el(r, 'a', 'div', ['i'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['i'], [text(r, 'u', 'XX')])])];
    const flex = (extra: string) => `.c { display: flex; } .i { width: 30px; margin: 0 12px; min-width: 0; ${extra} ${shadow} }`;
    expect([...new Set(errorsIn(flex(''), row))]).toEqual([]);
    expect([...new Set(errorsIn(flex('flex-shrink: 0;'), row))]).toEqual([]);
  });

  it('checks both ways where tree order may not be paint order: order, z-index, positioning or a float on either path (landing\'s cases)', () => {
    const shadow = 'text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);';
    const two = (cls: string, plain: string, wrap = 'f') => (r: SourceRef) => [el(r, 'f', 'div', [wrap], [el(r, 'a', 'div', [cls], [text(r, 't', 'XX')]), el(r, 'b', 'div', [plain], [text(r, 'u', 'XX')])])];
    const refused = (css: string, body: (r: SourceRef) => TreeNode[]): string[] => [...new Set(errorsIn(css, body))];
    // A shadowed flex item ordered after a plain one, or raised above it, or the plain one lowered beneath it.
    expect(refused(`.f { display: flex; } .a { order: 1; ${shadow} }`, two('a', 'p'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.f { display: flex; } .a { z-index: 1; ${shadow} }`, two('a', 'p'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.f { display: flex; } .a { ${shadow} } .p { z-index: -1; }`, two('a', 'p'))).toEqual(NATIVE_REFUSED);
    // A relatively positioned shadowed block over a plain one at line-height 12px, a later plain float, a later positioned block
    // with a negative z-index.
    expect(refused(`.a { position: relative; line-height: 12px; ${shadow} } .p { line-height: 12px; }`, two('a', 'p', 'w'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.a { ${shadow} } .p { float: left; }`, two('a', 'p', 'w'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.a { ${shadow} } .p { position: relative; z-index: -1; }`, two('a', 'p', 'w'))).toEqual(NATIVE_REFUSED);
    // Without any of them the later plain block covers the shadow, as in Chrome.
    expect(refused(`.a { line-height: 12px; ${shadow} } .p { line-height: 12px; }`, two('a', 'p', 'w'))).toEqual([]);
  });

  it('decides tree order per pair, from the boxes below the pair\'s common ancestor: a positioned ancestor of both moves them together', () => {
    // The shadowed heading over a paragraph under body { position: relative } or a relatively positioned wrapper of both: the
    // paragraph still paints later and covers the shadow.
    const h = '.h { font-size: 20px; margin: 0 0 10px; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5); }';
    const heading = (r: SourceRef) => [el(r, 'h', 'div', ['h'], [text(r, 't', 'XX')]), el(r, 'p', 'p', [], [text(r, 'u', 'XX')])];
    expect(errorsIn(`body { position: relative; } ${h}`, heading)).toEqual([]);
    const wrapped = (r: SourceRef) => [el(r, 'w', 'div', ['w'], heading(r))];
    expect(errorsIn(`.w { position: relative; } ${h}`, wrapped)).toEqual([]);
    expect(errorsIn(`.w { position: relative; z-index: 1; } ${h}`, wrapped)).toEqual([]);
    expect(errorsIn(`.w { float: left; width: 100px; } ${h}`, wrapped)).toEqual([]);
    // A positioned box below the common ancestor, around the paragraph alone, may paint it first: refused, body relative or not.
    const one = (r: SourceRef) => [el(r, 'h', 'div', ['h'], [text(r, 't', 'XX')]), el(r, 'w', 'div', ['w'], [el(r, 'p', 'p', [], [text(r, 'u', 'XX')])])];
    expect(errorsIn(`.w { position: relative; z-index: -1; } ${h}`, one)).toEqual(NATIVE_REFUSED);
    expect(errorsIn(`body { position: relative; } .w { position: relative; z-index: -1; } ${h}`, one)).toEqual(NATIVE_REFUSED);
    // Landing's five order cases, with each trigger below a positioned common ancestor (the wrapper w, and body): still refused.
    const shadow = 'text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);';
    const two = (cls: string, plain: string, wrap: string) => (r: SourceRef) => [el(r, 'f', 'div', wrap.split(' '), [el(r, 'a', 'div', [cls], [text(r, 't', 'XX')]), el(r, 'b', 'div', [plain], [text(r, 'u', 'XX')])])];
    const refused = (css: string, body: (r: SourceRef) => TreeNode[]): string[] => [...new Set(errorsIn(`body { position: relative; } .r { position: relative; } ${css}`, body))];
    expect(refused(`.f { display: flex; } .a { order: 1; ${shadow} }`, two('a', 'p', 'f r'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.f { display: flex; } .a { z-index: 1; ${shadow} }`, two('a', 'p', 'f r'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.f { display: flex; } .a { ${shadow} } .p { z-index: -1; }`, two('a', 'p', 'f r'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.a { position: relative; line-height: 12px; ${shadow} } .p { line-height: 12px; }`, two('a', 'p', 'r'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.a { ${shadow} } .p { float: left; }`, two('a', 'p', 'r'))).toEqual(NATIVE_REFUSED);
    expect(refused(`.a { ${shadow} } .p { position: relative; z-index: -1; }`, two('a', 'p', 'r'))).toEqual(NATIVE_REFUSED);
    // A static box that creates a stacking context paints in the z-index 0 layer, after the later paragraph's glyphs (landing's
    // repros): the heading's shadow lands over them in Chrome, so each is refused, under a positioned body as well.
    for (const box of ['isolation: isolate;', 'filter: brightness(1);', 'clip-path: inset(0);', 'will-change: opacity;', 'contain: paint;', 'contain: layout;', 'container-type: inline-size;', 'mask-image: linear-gradient(red, red);', 'perspective: 100px;', 'translate: 0;']) {
      expect([...new Set(errorsIn(`${h} .h { ${box} }`, heading))], box).toEqual(NATIVE_REFUSED);
      expect([...new Set(errorsIn(`body { position: relative; } ${h} .h { ${box} }`, heading))], box).toEqual(NATIVE_REFUSED);
    }
    // Translucent unshadowed text in a group (opacity under 1, or a transform), then a later text with a hard shadow: the group
    // paints after the shadow, its translucent glyphs over it.
    const later = (r: SourceRef) => [el(r, 'g', 'div', ['g'], [text(r, 't', 'XX')]), el(r, 's', 'div', ['s'], [text(r, 'u', 'XX')])];
    const hard = '.g { line-height: 12px; color: rgba(0, 0, 0, 0.5); } .s { line-height: 12px; text-shadow: 0 -6px 0 #000; }';
    expect([...new Set(errorsIn(hard, later))]).toEqual([]);
    expect([...new Set(errorsIn(`${hard} .g { opacity: 0.99; }`, later))]).toEqual(NATIVE_REFUSED);
    expect([...new Set(errorsIn(`${hard} .g { transform: translateX(0px); }`, later))]).toEqual(NATIVE_REFUSED);
    // And without a trigger below it, the positioned wrapper changes nothing.
    expect(refused(`.a { line-height: 12px; ${shadow} } .p { line-height: 12px; }`, two('a', 'p', 'r'))).toEqual([]);
    expect(refused(`.f { display: flex; } .a { ${shadow} }`, two('a', 'p', 'f r'))).toEqual([]);
  });

  it('refuses a column flex item that may shrink below its text (min-height 0), and keeps one at min-height auto', () => {
    const items = (r: SourceRef) => [el(r, 'f', 'div', ['f'], [el(r, 'a', 'div', ['i'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['i'], [text(r, 'u', 'XX')])])];
    const css = (min: string) => `.f { display: flex; flex-direction: column; height: 30px; } .i { ${min} line-height: 40px; text-shadow: 0 0 4px rgba(0, 0, 0, 0.5); }`;
    expect([...new Set(errorsIn(css('min-height: 0;'), items))]).toEqual([]);
    expect([...new Set(errorsIn(css(''), items))]).toEqual([]);
  });

  it('checks 300 shadowed blocks in well under a second (each pair once)', () => {
    const many = (r: SourceRef) => [...Array(300).keys()].map((k) => el(r, `d${k}`, 'div', ['s'], [text(r, `t${k}`, 'XX')]));
    const started = performance.now();
    const c = project(NO_FAULTS).compile(inputFor('body { font-family: Ahem; font-size: 10px; } .s { white-space: nowrap; margin-bottom: 20px; text-shadow: 0 1px 2px red; }', many));
    expect(performance.now() - started).toBeLessThan(5_000);
    // None meets another (the document budget refuses the later lists).
    expect(c.diagnostics.filter((d) => d.message.includes('may meet'))).toEqual([]);
  });

  it('refuses the lists after the document budget, keeping the ones before it', () => {
    const lines = (count: number) => (r: SourceRef) => [...Array(count).keys()].map((k) => el(r, `d${k}`, 'div', ['s'], [text(r, `t${k}`, 'X'.repeat(40))]));
    // Each line's own block, 20px apart, so no two lines' shadows meet.
    const css = '.s { white-space: nowrap; margin-bottom: 20px; text-shadow: 0 1px 2px red; }';
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
