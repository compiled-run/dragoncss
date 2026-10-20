// TXT-FX: text-shadow parses as Chrome parses it. Every target takes none and a list of px lengths and colours; iOS and Android
// refuse a list on text they do not draw as Chrome does (analysis/text-shadow.ts). The Chrome cases are text-shadow-none,
// text-shadow-blur, text-shadow-wrap and reject-text-shadow-list (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
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
    // A percentage line height is refused on the native targets before this bound (and would resolve against the font size).
    expect(at('150%', '0 0 0 red')).toEqual(NATIVE_REFUSED);
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

  it('refuses on iOS and Android a blurred or translucent shadow that may meet another text\'s ink or shadows (each is encoded over the backdrop alone)', () => {
    // Each declaring element is refused once per target.
    const NATIVE_ONLY = (css: string, body: (r: SourceRef) => TreeNode[]): string[] => errorsIn(css, body);
    // Two block siblings 12px tall: their shadows and glyphs overlap (landing's repro).
    const siblings = (r: SourceRef) => [el(r, 's', 'div', ['s'], [el(r, 'a', 'div', [], [text(r, 't', 'XX')]), el(r, 'b', 'div', [], [text(r, 'u', 'XX')])])];
    const blocks = '.s { line-height: 12px; background-color: #eef; text-shadow: 0 8px 16px rgba(0, 0, 0, 0.5); }';
    expect([...new Set(NATIVE_ONLY(blocks, siblings))]).toEqual(NATIVE_REFUSED);
    const msg = project(NO_FAULTS).compile(inputFor(`body { font-family: Ahem; font-size: 10px; } ${blocks}`, siblings)).diagnostics.find((d) => d.target === 'ios' && d.message.startsWith('text-shadow'));
    expect(msg?.message).toBe('text-shadow: rgba(0, 0, 0, 0.5) 0px 8px 16px on <div> s is unsupported on ios: text a:text0: its shadows and text b:text0 may meet (their vertical reaches, 0px and 16px, leave -14px between them, under 6px), and the device encodes each shadow over the backdrop alone');
    // The same blocks far enough apart compile; so do hard opaque shadows, which cover exactly.
    expect(NATIVE_ONLY('.s { line-height: 12px; text-shadow: 0 8px 16px rgba(0, 0, 0, 0.5); } .s > div { margin-bottom: 60px; }', siblings)).toEqual([]);
    expect(NATIVE_ONLY('.s { line-height: 12px; text-shadow: 0 3px 0 red; }', siblings)).toEqual([]);
    // Two texts on one line, the blurs meeting at the seam (landing's repro); a hard opaque list there compiles.
    const seam = (r: SourceRef) => [el(r, 'p', 'div', [], [text(r, 't', 'XX'), el(r, 'b', 'span', ['s'], [text(r, 'u', 'XX')])])];
    expect(NATIVE_ONLY('.s { text-shadow: 0 0 6px rgba(0, 0, 0, 0.5); }', seam)).toEqual(NATIVE_REFUSED);
    const both = (r: SourceRef) => [el(r, 'p', 'div', ['s'], [text(r, 't', 'XX'), el(r, 'b', 'span', [], [text(r, 'u', 'XX')])])];
    expect(NATIVE_ONLY('.s { white-space: nowrap; text-shadow: 0 0 6px rgba(0, 0, 0, 0.5); }', both)).toEqual(NATIVE_REFUSED);
    expect(NATIVE_ONLY('.s { white-space: nowrap; text-shadow: 2px 2px 0 red; }', both)).toEqual([]);
    // Flex items kept apart by their margins on both axes when the row wraps; ink kept inside a px width it fits.
    const row = (r: SourceRef) => [el(r, 'f', 'div', ['f'], [el(r, 'a', 'div', ['w'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['w'], [text(r, 'u', 'XX')])])];
    const flex = (margin: string, width: string) => `.f { display: flex; flex-wrap: wrap; } .w { width: ${width}; margin: ${margin}; line-height: 20px; text-shadow: 0 0 4px red; }`;
    expect(NATIVE_ONLY(flex('12px', '30px'), row)).toEqual([]);
    expect([...new Set(NATIVE_ONLY(flex('2px', '30px'), row))]).toEqual(NATIVE_REFUSED);
    // A px width narrower than the word lets the ink overflow toward the other item.
    expect([...new Set(NATIVE_ONLY(flex('12px', '10px'), row))]).toEqual(NATIVE_REFUSED);
  });

  it('accepts a shadow whose meeting text paints later and opaque, and boxes kept apart by auto margins, list items, a grid gap or inline-block buttons', () => {
    // A shadowed heading above an unshadowed paragraph: the paragraph's opaque glyphs paint later and cover the shadow as in Chrome.
    const heading = (r: SourceRef) => [el(r, 'h', 'div', ['h'], [text(r, 't', 'XX')]), el(r, 'p', 'p', [], [text(r, 'u', 'XX')])];
    const h = '.h { font-size: 20px; margin: 0 0 10px; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5); }';
    expect(errorsIn(h, heading)).toEqual([]);
    // Translucent glyphs painted later, or the paragraph first and the heading's shadow over it, are refused.
    expect(errorsIn(`${h} p { color: rgba(0, 0, 0, 0.5); }`, heading)).toEqual(NATIVE_REFUSED);
    const above = (r: SourceRef) => [el(r, 'p', 'p', ['q'], [text(r, 'u', 'XX')]), el(r, 'h', 'div', ['h'], [text(r, 't', 'XX')])];
    expect(errorsIn(`${h} .q { margin: 0; }`, above)).toEqual(NATIVE_REFUSED);
    const shadow = 'text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);';
    const pair = (tag: string, cls: string) => (r: SourceRef) => [el(r, 'c', 'div', ['c'], [el(r, 'a', tag, [cls], [text(r, 't', 'XX')]), el(r, 'b', tag, [cls], [text(r, 'u', 'XX')])])];
    // Auto margins in a flex row add free space only.
    expect([...new Set(errorsIn(`.c { display: flex; } .i { width: 30px; margin: 0 auto 0 20px; ${shadow} }`, pair('div', 'i')))]).toEqual([]);
    // List items without a marker.
    expect([...new Set(errorsIn(`.c { margin: 0; padding: 0; } .i { list-style: none; margin-bottom: 24px; ${shadow} }`, (r) => [el(r, 'c', 'ul', ['c'], [el(r, 'a', 'li', ['i'], [text(r, 't', 'XX')]), el(r, 'b', 'li', ['i'], [text(r, 'u', 'XX')])])]))]).toEqual([]);
    expect([...new Set(errorsIn(`.c { margin: 0; padding: 0; } .i { margin-bottom: 24px; ${shadow} }`, (r) => [el(r, 'c', 'ul', ['c'], [el(r, 'a', 'li', ['i'], [text(r, 't', 'XX')]), el(r, 'b', 'li', ['i'], [text(r, 'u', 'XX')])])]))]).toEqual(NATIVE_REFUSED);
    // Auto-placed grid items, a gap apart on both axes; a placed item may share a cell.
    expect([...new Set(errorsIn(`.c { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; } .i { ${shadow} }`, pair('div', 'i')))]).toEqual([]);
    expect([...new Set(errorsIn(`.c { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; } .i { ${shadow} }`, pair('div', 'i')))]).toEqual(NATIVE_REFUSED);
    expect([...new Set(errorsIn(`.c { display: grid; gap: 24px; } .i { grid-area: 1 / 1; ${shadow} }`, pair('div', 'i')))]).toEqual(NATIVE_REFUSED);
    // Inline-block link buttons with margins on every side (Dragon has no <button>).
    expect([...new Set(errorsIn(`.i { display: inline-block; margin: 12px; ${shadow} }`, pair('a', 'i')))]).toEqual([]);
    expect([...new Set(errorsIn(`.i { display: inline-block; margin: 1px; ${shadow} }`, pair('a', 'i')))]).toEqual(NATIVE_REFUSED);
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
    expect([...new Set(errorsIn(`.s { line-height: 20px; ${shadow} } .m { margin-top: 30px; } .n { margin-bottom: -40px; }`, nested))]).toEqual(NATIVE_REFUSED);
    // A flex item's px width shrinks to min-width 0 on a full line, past its text; flex-shrink: 0 keeps it.
    const row = (r: SourceRef) => [el(r, 'c', 'div', ['c'], [el(r, 'a', 'div', ['i'], [text(r, 't', 'XX')]), el(r, 'b', 'div', ['i'], [text(r, 'u', 'XX')])])];
    const flex = (extra: string) => `.c { display: flex; } .i { width: 30px; margin: 0 12px; min-width: 0; ${extra} ${shadow} }`;
    expect([...new Set(errorsIn(flex(''), row))]).toEqual(NATIVE_REFUSED);
    expect([...new Set(errorsIn(flex('flex-shrink: 0;'), row))]).toEqual([]);
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
