// The native refusal of text a padding-box clip view (overflow other than visible, or background-clip: text) hides whole for
// certain, which Chrome keeps in its accessibility tree and Android's View.isVisibleToUser drops (clip-view-text.ts): each trigger,
// and the cards, lists and moves the landing reviews named, which must still compile because their text may fit.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, expectCatalogued, inputFor, text } from './helpers.ts';

const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const ALL: Targets = { ...NATIVE, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .p { width: 100px; } ';
type Body = (r: SourceRef) => TreeNode[];

const tag = (r: SourceRef, name: string, id: string, children: TreeNode[] = []): TreeNode => ({ ...div(r, id, [id], children), tag: name }) as TreeNode;
// The clip box a under p: text only (one), text then a block b with text (two), a block b with text only (deep).
const one: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX')])])];
const two: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
const deep: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
// Two items i1 and i2 with text: carousel slides, grid cells, inline-blocks.
const slides: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'i1', ['i'], [text(r, 'i1-t', 'XX')]), div(r, 'i2', ['i'], [text(r, 'i2-t', 'YY')])])])];
// A card: a heading and a paragraph (UA margins), or an image then a caption.
const card: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [tag(r, 'h2', 'h', [text(r, 'h-t', 'Title')]), tag(r, 'p', 'c', [text(r, 'c-t', 'Body text here')])])])];
const tall: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'c', ['c']), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
const words: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'Hello '), tag(r, 'b', 'w', [text(r, 'w-t', 'world')])])])];

const compile = (css: string, body: Body, targets: Targets = ALL) =>
  createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(BASE + css, body));
const viewErrors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error' && /, which (ios|android) draws as a clip view over its padding box/.test(d.message));

function expectRefused(css: string, body: Body, at: string, textId: string, why: RegExp): void {
  const errs = viewErrors(compile(css, body));
  expect(errs.map((d) => [d.code, d.target]).sort(), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
  for (const d of errs) {
    expect(d.message, css).toMatch(new RegExp(`^${at} has (overflow|background-clip): `));
    expect(d.message, css).toMatch(why);
    expect(d.message, css).toContain(`its text ${textId} could be clipped out of sight, which Chrome keeps in its accessibility tree`);
  }
  expect(errs.find((d) => d.target === 'android')?.message, css).toContain('View.isVisibleToUser is false');
  expectCatalogued(errs);
}

function expectCompiles(css: string, body: Body): void {
  const c = compile(css, body);
  expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), css).toEqual([]);
}

describe('clip view over text: a padding box with no area', () => {
  it('refuses a zero width, height, max-width or max-height, and a zero flex-basis without flex-grow along the flex main axis', () => {
    for (const [css, why] of [
      ['.a { overflow: hidden; height: 0; }', /its height 0px leaves its padding box no area/],
      ['.a { overflow: hidden; max-height: 0; }', /its max-height 0px/],
      ['.a { overflow: hidden; width: 0; }', /its width 0px/],
      ['.a { overflow: hidden; max-width: 0%; }', /its max-width 0%/],
      ['.a { overflow: clip; height: 0; }', /its height 0px/],
      ['.a { overflow: auto; height: 0; padding-top: 5px; }', /its height 0px/],
      ['.p { display: flex; } .a { overflow: hidden; flex: 0 0 0; }', /its flex-basis 0px without flex-grow in the flex container p/],
      ['.p { display: flex; flex-direction: column; } .a { overflow: hidden; flex: 0 0 0; }', /its flex-basis 0px without flex-grow/],
    ] as const) expectRefused(css, one, 'a', 'a:text0', why);
    expectRefused('.a { overflow: hidden; } .b { transform: scale(0); }', deep, 'a', 'b:text0', /b has transform scale\(0\), which leaves it no area/);
  });
  it('compiles a calculated size, a positive min size, end padding (the padding-bottom aspect idiom too), and a flex-basis outside a flex container or with flex-grow', () => {
    for (const css of [
      '.a { overflow: hidden; height: calc(10% - 1px); }',
      '.a { overflow: hidden; height: 0; min-height: 30px; }',
      '.a { overflow: hidden; width: 0; padding: 0 20px; }',
      '.a { overflow: hidden; height: 0; padding-bottom: 56.25%; }',
      '.a { overflow: hidden; flex: 0 0 0; }',
      '.p { display: flex; } .a { overflow: hidden; flex: 1 1 0; }',
    ]) expectCompiles(css, one);
    expectCompiles('.p { width: calc(100% - 32px); } .a { overflow: hidden; }', two);
  });
  it('refuses a clip box that takes its size from a zero-size ancestor, and compiles one with its own size, positioned, atomic or auto height', () => {
    expectRefused('.p { width: 0; } .a { overflow: hidden; }', two, 'a', 'a:text0', /its ancestor p has width 0px, which can leave it no area too/);
    expectRefused('.p { height: 0; } .a { overflow: hidden; height: 100%; }', one, 'a', 'a:text0', /its ancestor p has height 0px/);
    expectRefused('.p { display: flex; height: 0; } .a { overflow: hidden; }', one, 'a', 'a:text0', /its ancestor p has height 0px/);
    for (const css of ['.p { width: 0; } .a { overflow: hidden; width: 50px; }', '.p { width: 0; position: relative; } .a { overflow: hidden; position: absolute; }', '.p { height: 0; } .a { overflow: hidden; }', '.p { width: 0; } .a { overflow: hidden; display: inline-block; }']) expectCompiles(css, two);
  });
  it('refuses text whose line box is empty, unless bottom padding shows it', () => {
    expectRefused('.a { overflow: hidden; line-height: 0; }', one, 'a', 'a:text0', /its line box is empty \(line-height 0/);
    expectRefused('.a { overflow: hidden; font-size: 0; }', one, 'a', 'a:text0', /its line box is empty/);
    expectCompiles('.a { overflow: hidden; line-height: 0; padding-bottom: 10px; }', one);
  });
});

describe('clip view over text: text past the padding box\'s end', () => {
  it('refuses an image-replacement indent wider than any screen, and an indent of 100% or of the px width', () => {
    expectRefused('.a { overflow: hidden; text-indent: 9999px; }', one, 'a', 'a:text0', /the text starts at least 9999px from its content box's start \(text-indent 9999px included\), at or past its padding box's end \(100px\)/);
    expectRefused('.p { width: auto; } .a { overflow: hidden; text-indent: 9999px; }', one, 'a', 'a:text0', /at least 9999px .*, at or past its padding box's end \(4096px\)/);
    expectRefused('.a { overflow: hidden; text-indent: 100%; white-space: nowrap; }', one, 'a', 'a:text0', /the text starts at least 100% of its width from its content box's start \(text-indent 100% of its width included\), at or past its padding box's end \(100px\)/);
    expectRefused('.a { overflow: hidden; width: 50px; text-indent: 60px; }', one, 'a', 'a:text0', /at least 60px .* \(50px\)/);
    expectRefused('.a { overflow: hidden; } .b { margin-left: 9999px; }', deep, 'a', 'b:text0', /at least 9999px/);
    expectRefused('.a { overflow: hidden; } .b { padding-left: 5000px; }', deep, 'a', 'b:text0', /at least 5000px/);
  });
  it('refuses carousel slides past a px width: non-shrinking flex items, grid tracks, nowrap inline-blocks', () => {
    expectRefused('.a { display: flex; width: 100px; overflow: hidden; } .i { flex-shrink: 0; width: 200px; }', slides, 'a', 'i2:text0', /at least 200px .* \(100px\)/);
    expectRefused('.a { display: flex; width: 100px; overflow: hidden; column-gap: 10px; } .i { flex: 0 0 95px; }', slides, 'a', 'i2:text0', /at least 105px/);
    expectRefused('.a { display: grid; grid-template-columns: repeat(3, 200px); width: 100px; overflow: hidden; }', slides, 'a', 'i2:text0', /at least 200px/);
    expectRefused('.a { width: 100px; overflow: hidden; white-space: nowrap; } .i { display: inline-block; width: 150px; }', slides, 'a', 'i2:text0', /at least 150px/);
  });
  it('refuses text below a px height by the px sizes, margins and paddings above it', () => {
    expectRefused('.a { overflow: hidden; height: 10px; } .c { height: 100px; }', tall, 'a', 'b:text0', /starts at least 100px below its content box's top, at or past its padding box's bottom \(10px\)/);
    expectRefused('.a { overflow: hidden; height: 10px; } .b { margin-top: 50px; }', deep, 'a', 'b:text0', /at least 50px below/);
    expectRefused('.a { overflow: hidden; max-height: 20px; } .b { padding-top: 20px; }', deep, 'a', 'b:text0', /at least 20px below .* \(20px\)/);
    expectRefused('.a { overflow: hidden; height: 10px; } .b { position: relative; top: 12px; }', deep, 'a', 'b:text0', /at least 12px below/);
    expectRefused('.a { overflow: hidden; height: 100px; } .b { transform: translateY(100px); }', deep, 'a', 'b:text0', /at least 100px below .* \(100px\)/);
  });
  it('compiles cards and lists whose text may fit: auto or flex sizes, and px sizes the bound stays under', () => {
    for (const [css, body] of [
      ['.p { display: flex; } .a { overflow: hidden; border-radius: 8px; }', card],
      ['.p { display: grid; } .a { overflow: hidden; border-radius: 8px; }', card],
      ['.a { overflow: hidden; height: 200px; }', card],
      ['.a { overflow: hidden; height: 200px; }', two],
      ['.a { overflow: hidden; height: 20px; }', words],
      ['.a { overflow: hidden; height: 120px; } .c { height: 100px; }', tall],
      ['.a { display: flex; overflow: hidden; } .c { width: 24px; height: 24px; }', tall],
      ['.a { display: flex; width: 100px; overflow: hidden; } .i { width: 200px; }', slides],
      ['.a { display: grid; grid-template-columns: 1fr 1fr; width: 100px; overflow: hidden; }', slides],
      ['.a { overflow: hidden; text-indent: 2em; }', one],
      ['.a { overflow: hidden; width: 50px; text-indent: 40px; }', one],
    ] as const) expectCompiles(css, body);
  });
});

describe('clip view over text: text before the padding box\'s start', () => {
  it('refuses text moved out before the start by an exact sum: an indent, an offset, a margin or a translation', () => {
    expectRefused('.a { overflow: hidden; text-indent: -9999px; }', one, 'a', 'a:text0', /the text starts -9999px from its content box's start \(text-indent -9999px included\) and ends before its padding box's start/);
    expectRefused('.a { overflow: hidden; text-indent: -20px; }', one, 'a', 'a:text0', /starts -20px/);
    expectRefused('.a { overflow: hidden; position: relative; } .b { position: absolute; left: -9999px; }', deep, 'a', 'b:text0', /starts -9999px/);
    expectRefused('.a { overflow: hidden; } .b { position: relative; left: -30px; }', deep, 'a', 'b:text0', /starts -30px/);
    expectRefused('.a { overflow: hidden; } .b { margin-left: -9999px; }', deep, 'a', 'b:text0', /starts -9999px/);
    expectRefused('.a { overflow: hidden; } .b { transform: translateX(-200px); }', deep, 'a', 'b:text0', /starts -200px/);
    expectRefused('.a { overflow: hidden; } .b { margin-top: -9999px; }', deep, 'a', 'b:text0', /starts -9999px above its content box's top/);
  });
  it('compiles moves that may leave part of the text in sight', () => {
    for (const css of [
      '.a { overflow: hidden; } .b { text-indent: -15px; }',
      '.a { overflow: hidden; } .b { position: relative; top: 1px; left: -5px; }',
      '.a { overflow: hidden; } .b { margin-top: -1px; }',
      '.a { overflow: hidden; } .b { transform: scale(1); }',
      '.a { overflow: hidden; } .b { transform: rotate(45deg) translateX(-200px); }',
      '.a { overflow: hidden; position: relative; } .b { position: absolute; top: 0; left: 0; }',
      '.a { overflow: hidden; } .b { letter-spacing: 2px; position: relative; left: -20px; }',
    ]) expectCompiles(css, deep);
    // Two Ahem glyphs 10px wide plus 2px letter-spacing each end 24px after their start.
    expectRefused('.a { overflow: hidden; } .b { letter-spacing: 2px; position: relative; left: -24px; }', deep, 'a', 'b:text0', /starts -24px/);
  });
});

describe('clip view over text: what is not judged', () => {
  it('a scroll container judges only its start side on the axes it scrolls', () => {
    expectCompiles('.a { overflow: auto; height: 10px; } .c { height: 100px; }', tall);
    expectCompiles('.a { overflow: auto; width: 50px; text-indent: 60px; }', one);
    expectRefused('.a { overflow: auto; text-indent: -9999px; }', one, 'a', 'a:text0', /starts -9999px/);
    expectRefused('.a { overflow-x: scroll; overflow-y: hidden; height: 10px; } .c { height: 100px; }', tall, 'a', 'b:text0', /at least 100px below/);
  });
  it('an auto-height clip over text still lowers its clip view', () => {
    expectCompiles('.a { overflow: hidden; }', two);
    const p = nativePrograms(compile('.a { overflow: hidden; }', two, NATIVE), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const prog of [p.programs.uikit, p.programs['android-views']]) expect(prog.nodes.find((n) => n.id === 'a')?.writes.map((w) => w.kind)).toContain('padding-box-clip');
  });
  it('a clip box without text, text under display: none, no clip, an inline box, web, and the root', () => {
    const bare: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'])])])];
    expect(viewErrors(compile('.a { overflow: hidden; height: 0; } .b { text-indent: -9999px; }', bare))).toEqual([]);
    expect(viewErrors(compile('.a { overflow: hidden; height: 0; } .b { display: none; }', deep))).toEqual([]);
    expect(viewErrors(compile('.a { height: 0; text-indent: -9999px; } .b { margin-top: -100px; }', two))).toEqual([]);
    expect(viewErrors(compile('.a { overflow: hidden; display: inline; text-indent: -9999px; }', two))).toEqual([]);
    expect(viewErrors(compile('.a { overflow: hidden; height: 0; }', one, { web: {} }))).toEqual([]);
    expect(viewErrors(compile('html { overflow: hidden; text-indent: -9999px; }', two))).toEqual([]);
  });
  it('points at the overflow declaration and refuses once per clip box and target', () => {
    const errs = viewErrors(compile('.a { overflow-y: hidden; height: 0; } .b { text-indent: -1px; }', two, NATIVE));
    expect(errs.map((d) => d.target).sort()).toEqual(['android', 'ios']);
    expect(errs[0]?.message).toMatch(/^a has overflow: auto hidden, /);
    expect(errs[0]?.origin).toMatchObject({ kind: 'authored' });
  });
});

// Round 3 of the landing review: auto sizes are unbounded, a first line's indent reaches its inline descendants, percentages of the
// clip box's width are decided, collapsible whitespace is no text, and the low findings.
const page: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [...[1, 2, 3, 4, 5].map((n) => div(r, `s${n}`, ['s'])), div(r, 'f', ['f'], [text(r, 'f-t', 'Footer')])])])];
const logo: Body = (r) => [div(r, 'p', ['p'], [tag(r, 'h1', 'a', [tag(r, 'a', 'l', [text(r, 'l-t', 'Brand')])])])];
const span: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [tag(r, 'span', 's', [text(r, 's-t', 'Label')])])])];
const nav: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'w1', '\n  '), div(r, 'i1', ['i'], [text(r, 'i1-t', 'One')]), text(r, 'w2', '\n  '), div(r, 'i2', ['i'], [text(r, 'i2-t', 'Two')]), text(r, 'w3', '\n')])])];
const phrase: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'Hello there world')])])];
const contents: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'c', ['c'], [div(r, 'd', ['d'])]), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];

describe('clip view over text: auto sizes bound nothing', () => {
  it('compiles a tall page under an auto-height clip, and a % height of an auto-height parent', () => {
    expectCompiles('.a { overflow: hidden; } .s { height: 900px; }', page);
    expectCompiles('.a { overflow: hidden; } .b { transform: translateY(9999px); }', deep);
    expectCompiles('.a { overflow: hidden; height: 50%; } .c { height: 100px; }', tall);
    expectCompiles('.a { overflow: hidden; max-height: 50vh; } .s { height: 300px; }', page);
    // A % height of a px-height parent is decided.
    expectRefused('.p { height: 100px; } .a { overflow: hidden; height: 50%; } .c { height: 100px; }', tall, 'a', 'b:text0', /at least 100px below .* \(50px\)/);
    expectRefused('.a { overflow: hidden; height: 400px; } .s { height: 900px; }', page, 'a', 'f:text0', /at least 4500px below .* \(400px\)/);
    // A viewport height is at most its share of SCREEN_BOUND (4096px).
    expectRefused('.a { overflow: hidden; height: 100vh; } .s { height: 900px; }', page, 'a', 'f:text0', /at least 4500px below .* \(4096px\)/);
    expectRefused('.a { overflow: hidden; max-height: 50vh; } .s { height: 900px; }', page, 'a', 'f:text0', /at least 4500px below .* \(2048px\)/);
  });
  it('compiles an auto width its content can widen: shrink-to-fit, a flex row item, a grid item', () => {
    for (const css of [
      '.p { display: inline-block; width: auto; } .a { overflow: hidden; text-indent: 200px; }',
      '.a { overflow: hidden; float: left; text-indent: 200px; }',
      '.a { overflow: hidden; position: absolute; text-indent: 200px; }',
      '.p { display: grid; } .a { overflow: hidden; text-indent: 200px; }',
      '.p { display: flex; width: auto; } .a { overflow: hidden; text-indent: 200px; }',
    ]) expectCompiles(css, one);
    // A block's auto width is its containing block's, less its margins.
    expectRefused('.a { overflow: hidden; margin-right: 40px; text-indent: 60px; }', one, 'a', 'a:text0', /at least 60px .* \(60px\)/);
    expectRefused('.p { width: 50%; } .a { overflow: hidden; text-indent: 2100px; }', one, 'a', 'a:text0', /at least 2100px .* \(2048px\)/);
  });
});

describe('clip view over text: the first line\'s indent reaches its inline descendants', () => {
  it('refuses an h1 > a logo, a div > span and a nowrap +9999px > a', () => {
    expectRefused('.a { overflow: hidden; text-indent: -9999px; }', logo, 'a', 'l:text0', /starts -9999px from its content box's start \(text-indent -9999px included\)/);
    expectRefused('.a { overflow: hidden; text-indent: -9999px; }', span, 'a', 's:text0', /starts -9999px/);
    expectRefused('.a { overflow: hidden; white-space: nowrap; text-indent: 9999px; }', logo, 'a', 'l:text0', /at least 9999px .*\(text-indent 9999px included\)/);
    expectRefused('.a { overflow: hidden; text-indent: -9999px; } .s { padding: 0 4px; }', span, 'a', 's:text0', /starts -9995px/);
  });
  it('compiles an indent that a later line, a block or start padding undoes, or a centered line', () => {
    expectCompiles('.a { overflow: hidden; text-indent: -30px; text-align: center; }', one);
    expectCompiles('.a { overflow: hidden; text-indent: -30px; } .s { padding-left: 20px; }', span);
    // A wrapping text's later words start the next line, without the indent; its first word alone is sure to be past the end.
    expectCompiles('.a { overflow: hidden; text-indent: 9999px; }', phrase);
    expectRefused('.a { overflow: hidden; text-indent: 9999px; }', words, 'a', 'a:text0', /at least 9999px/);
    expectRefused('.a { overflow: hidden; text-indent: 9999px; white-space: nowrap; }', phrase, 'a', 'a:text0', /at least 9999px/);
    expectCompiles('.a { overflow: hidden; text-indent: -9999px; } .s { display: block; text-indent: 0; }', span);
  });
});

describe('clip view over text: percentages of the clip box\'s width', () => {
  it('refuses flex: 0 0 100% and flex: none; width: 100% carousels, column-flow grid tracks, and a % margin', () => {
    expectRefused('.a { display: flex; overflow: hidden; } .i { flex: 0 0 100%; }', slides, 'a', 'i2:text0', /at least 100% of its width .*\(100px\)/);
    expectRefused('.a { display: flex; overflow: hidden; } .i { flex: none; width: 100%; }', slides, 'a', 'i2:text0', /at least 100% of its width/);
    expectRefused('.a { display: flex; overflow: hidden; width: 80%; } .i { flex-shrink: 0; width: 100%; }', slides, 'a', 'i2:text0', /at least 100% of its width/);
    expectRefused('.a { display: grid; grid-auto-flow: column; grid-auto-columns: 100px; width: 100px; overflow: hidden; }', slides, 'a', 'i2:text0', /at least 100px/);
    expectRefused('.a { display: grid; grid-auto-flow: column; grid-auto-columns: 100%; overflow: hidden; }', slides, 'a', 'i2:text0', /at least 100% of its width/);
    expectRefused('.a { overflow: hidden; } .b { margin-left: 100%; }', deep, 'a', 'b:text0', /at least 100% of its width/);
  });
  it('compiles a % slide that shrinks or is narrower, and an unknown or negative % margin', () => {
    for (const [css, body] of [
      ['.a { display: flex; overflow: hidden; } .i { flex: 0 1 100%; }', slides],
      ['.a { display: flex; overflow: hidden; } .i { flex: 0 0 90%; }', slides],
      ['.a { display: grid; grid-auto-flow: column; grid-auto-columns: 50%; overflow: hidden; }', slides],
      ['.a { overflow: hidden; } .b { margin-left: calc(100% - 1px); }', deep],
      ['.a { overflow: hidden; height: 10px; } .c { height: 100px; margin-bottom: -50%; }', tall],
    ] as const) expectCompiles(css, body);
  });
});

describe('clip view over text: whitespace and the low findings', () => {
  it('compiles a font-size: 0 nav whose collapsible whitespace has no line, and refuses its items\' own empty line', () => {
    expectCompiles('.a { overflow: hidden; font-size: 0; } .i { display: inline-block; font-size: 10px; }', nav);
    expectRefused('.a { overflow: hidden; font-size: 0; } .i { display: inline-block; }', nav, 'a', 'i1:text0', /i1's line box is empty/);
  });
  it('an inline box\'s block-axis margin, border and padding move no line', () => {
    expectCompiles('.a { overflow: hidden; height: 20px; } .w { padding-top: 50px; margin-top: 50px; border-top: 50px solid; }', words);
  });
  it('counts a previous block\'s negative margin-bottom', () => {
    expectCompiles('.a { overflow: hidden; height: 10px; } .c { height: 100px; margin-bottom: -95px; }', tall);
    expectRefused('.a { overflow: hidden; height: 10px; } .c { height: 100px; margin-bottom: -50px; }', tall, 'a', 'b:text0', /at least 50px below/);
  });
  it('a flex item that does not stretch keeps its own height under a zero-height flex row', () => {
    expectCompiles('.p { display: flex; height: 0; align-items: flex-start; } .a { overflow: hidden; }', one);
    expectCompiles('.p { display: flex; height: 0; } .a { overflow: hidden; align-self: center; }', one);
    expectRefused('.p { display: flex; height: 0; align-items: stretch; } .a { overflow: hidden; }', one, 'a', 'a:text0', /its ancestor p has height 0px/);
  });
  it('a display: contents sibling stacks no block of its own (native refuses display: contents on its own, so no clip-view refusal)', () => {
    expect(viewErrors(compile('.a { overflow: hidden; height: 10px; } .c { display: contents; height: 100px; }', contents))).toEqual([]);
    expectRefused('.a { overflow: hidden; height: 10px; } .d { height: 100px; }', contents, 'a', 'b:text0', /at least 100px below/);
    // An auto-height block is at least as tall as the blocks it stacks; an unknown margin among them could pull them up.
    expectCompiles('.a { overflow: hidden; height: 10px; } .d { height: 100px; margin-bottom: calc(-50% + 1px); }', contents);
    expectCompiles('.a { overflow: hidden; height: 10px; } .c { max-height: 5px; } .d { height: 100px; }', contents);
  });
  it('a font size with no build-time value is not zero (native refuses a vw font size on its own, so no clip-view refusal)', () => {
    expect(viewErrors(compile('.a { overflow: hidden; font-size: 2vw; }', one))).toEqual([]);
    expect(viewErrors(compile('.a { overflow: hidden; font-size: calc(1px + 1vw); }', one))).toEqual([]);
    expectRefused('.a { overflow: hidden; font-size: 2vw; line-height: 0; }', one, 'a', 'a:text0', /its line box is empty \(line-height 0/);
  });
});

// Landing review round 4: the track-wrapper carousel (Swiper, Embla, Glide markup), the column-flex ticker, and the cost.
const track: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'w', ['w'], [div(r, 'i1', ['i'], [text(r, 'i1-t', 'XX')]), div(r, 'i2', ['i'], [text(r, 'i2-t', 'YY')])])])])];
const deepTrack: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'v', ['v'], [div(r, 'w', ['w'], [div(r, 'i1', ['i'], [text(r, 'i1-t', 'XX')]), div(r, 'i2', ['i'], [text(r, 'i2-t', 'YY')])])])])])];

describe('clip view over text: a track as wide as the clip box carries its width', () => {
  it('refuses a carousel whose slides are 100% of an auto or 100% width track', () => {
    expectRefused('.a { overflow: hidden; } .w { display: flex; width: 100%; } .i { flex-shrink: 0; width: 100%; }', track, 'a', 'i2:text0', /at least 100% of its width .*\(100px\)/);
    expectRefused('.a { overflow: hidden; width: 300px; } .w { display: flex; } .i { flex: 0 0 100%; }', track, 'a', 'i2:text0', /at least 100% of its width .*\(300px\)/);
    expectRefused('.a { overflow: hidden; } .w { display: flex; } .i { flex: 0 0 100%; }', deepTrack, 'a', 'i2:text0', /at least 100% of its width/);
    expectRefused('.a { overflow: hidden; } .w { display: flex; margin: 0 auto; border: 0 solid; } .i { flex: none; width: 100%; }', track, 'a', 'i2:text0', /at least 100% of its width/);
  });
  it('compiles a track its end margin, padding, border, width or max-width makes narrower or wider, and shrinking slides', () => {
    // (A start-side margin or border shifts the track as much as it narrows it, so the second slide still starts at the clip box's end.)
    for (const css of [
      '.a { overflow: hidden; } .w { display: flex; margin-right: 20px; } .i { flex: 0 0 100%; }',
      '.a { overflow: hidden; } .w { display: flex; padding-right: 20px; } .i { flex: 0 0 100%; }',
      '.a { overflow: hidden; } .w { display: flex; border-right: 2px solid; } .i { flex: 0 0 100%; }',
      '.a { overflow: hidden; } .w { display: flex; width: 200%; } .i { flex: 0 0 50%; }',
      '.a { overflow: hidden; } .w { display: flex; max-width: 80px; } .i { flex: 0 0 100%; }',
      '.a { overflow: hidden; } .w { display: flex; position: absolute; } .i { flex: 0 0 100%; }',
      '.a { overflow: hidden; } .w { display: flex; } .i { flex: 0 1 100%; }',
    ]) expectCompiles(css, track);
    // A 200% track holds 50% slides of its own width, each the clip box's width: the second is refused once the track width is known.
    expectRefused('.a { overflow: hidden; width: 100px; } .w { display: flex; width: 200px; } .i { flex: 0 0 50%; }', track, 'a', 'i2:text0', /at least 100px/);
  });
  it('refuses a column-flex ticker whose 100% items fill a px height, and compiles one under an auto height', () => {
    expectRefused('.a { display: flex; flex-direction: column; height: 40px; overflow: hidden; } .i { flex: 0 0 100%; }', slides, 'a', 'i2:text0', /at least 40px below .* \(40px\)/);
    expectRefused('.a { display: flex; flex-direction: column; height: 40px; overflow: hidden; } .i { flex: none; height: 100%; }', slides, 'a', 'i2:text0', /at least 40px below/);
    expectCompiles('.a { display: flex; flex-direction: column; overflow: hidden; } .i { flex: 0 0 100%; }', slides);
    expectCompiles('.a { display: flex; flex-direction: column; height: 40px; overflow: hidden; } .i { flex: 0 0 90%; }', slides);
  });
});

describe('clip view over text: cost', () => {
  it('judges 3000 rows under one clip box without rescanning earlier rows for each (it took 30-90 s)', () => {
    const rows: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], Array.from({ length: 3000 }, (_, i) => div(r, `r${i}`, ['r'], [div(r, `c${i}`, ['c'], [text(r, `t${i}`, 'Row')])])))])];
    const start = performance.now();
    expectCompiles('.a { overflow: hidden; height: 100000px; } .c { height: 20px; }', rows);
    // About 3.5 s here with or without the clip; the bound leaves room for a loaded machine.
    expect(performance.now() - start).toBeLessThan(20_000);
  }, 60_000);
});
