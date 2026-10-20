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
    expectRefused('.a { overflow: hidden; text-indent: 9999px; }', one, 'a', 'a:text0', /the text starts at least 9999px from its content box's start \(text-indent 9999px included\), at or past its padding box's end \(wider than any screen, 4096px\)/);
    expectRefused('.a { overflow: hidden; text-indent: 100%; white-space: nowrap; }', one, 'a', 'a:text0', /it has text-indent 100%, which starts the text at its content box's end/);
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
    expectRefused('.a { overflow: hidden; } .b { transform: translateY(9999px); }', deep, 'a', 'b:text0', /taller than any screen/);
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
      '.a { overflow: hidden; } .b { letter-spacing: 2px; position: relative; left: -100px; }',
    ]) expectCompiles(css, deep);
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
