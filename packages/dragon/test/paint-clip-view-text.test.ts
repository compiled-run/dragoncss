// The native refusal of text a padding-box clip view (overflow other than visible, or background-clip: text) could clip wholly out
// of sight, which Chrome keeps in its accessibility tree and Android's View.isVisibleToUser drops (clip-view-text.ts): each trigger,
// and the controls the landing review named that must still compile.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, expectCatalogued, inputFor, text } from './helpers.ts';

const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const ALL: Targets = { ...NATIVE, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .p { width: 100px; } ';
type Body = (r: SourceRef) => TreeNode[];

// The clip box a under p: text only (one), text then a block b with text (two), a block b with text only (deep).
const one: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX')])])];
const two: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
const deep: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
// A tall text-free block c before b.
const sibling: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'c', ['c']), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
// Text, then an inline span with text on the same line; and two blocks, each starting its own line.
const span = (r: SourceRef, id: string, children: TreeNode[]): TreeNode => ({ ...div(r, id, [id], children), tag: 'span' }) as TreeNode;
const sameLine: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XXXXXX'), span(r, 's', [text(r, 's-t', 'YY')])])])];
const twoBlocks: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'XXXXXX')]), div(r, 'c', ['c'], [text(r, 'c-t', 'YYYYYY')])])])];

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

describe('clip view over text: a padding box that can be empty', () => {
  it('refuses a zero width, height, max-width or max-height, and a zero flex-basis without flex-grow along the flex main axis', () => {
    for (const [css, why] of [
      ['.a { overflow: hidden; height: 0; }', /its height 0px can leave its padding box no area/],
      ['.a { overflow: hidden; max-height: 0; }', /its max-height 0px/],
      ['.a { overflow: hidden; width: 0; }', /its width 0px/],
      ['.a { overflow: hidden; max-width: 0%; }', /its max-width 0%/],
      ['.a { overflow: clip; height: 0; }', /its height 0px/],
      ['.a { overflow: auto; height: 0; padding-top: 5px; }', /its height 0px/],
      ['.p { display: flex; } .a { overflow: hidden; flex: 0 0 0; }', /its flex-basis 0px without flex-grow in the flex container p/],
      ['.p { display: flex; flex-direction: column; } .a { overflow: hidden; flex: 0 0 0; }', /its flex-basis 0px without flex-grow/],
    ] as const) expectRefused(css, one, 'a', 'a:text0', why);
  });
  it('compiles a calculated size, a positive min size, end padding, and a flex-basis outside a flex container or with flex-grow', () => {
    for (const css of [
      '.a { overflow: hidden; height: calc(10% - 1px); }',
      '.a { overflow: hidden; width: min(0px, 10%); }',
      '.a { overflow: hidden; height: 0; min-height: 30px; }',
      '.a { overflow: hidden; width: 0; padding: 0 20px; }',
      '.a { overflow: hidden; height: 0; padding-bottom: 12px; }',
      '.a { overflow: hidden; flex: 0 0 0; }',
      '.p { display: flex; } .a { overflow: hidden; flex: 1 1 0; }',
      '.p { display: flex; } .a { overflow: hidden; flex: 0 0 0; min-width: 10px; }',
    ]) expectCompiles(css, one);
    // A card under a calculated width (finding 1's repro).
    expectCompiles('.p { width: calc(100% - 32px); } .a { overflow: hidden; }', two);
  });
  it('refuses a clip box that takes its size from a zero-size ancestor: an auto width, a percentage size, a flex stretch', () => {
    expectRefused('.p { width: 0; } .a { overflow: hidden; }', two, 'a', 'a:text0', /its ancestor p has width 0px, which can leave it no area too/);
    expectRefused('.p { height: 0; } .a { overflow: hidden; height: 100%; }', one, 'a', 'a:text0', /its ancestor p has height 0px/);
    expectRefused('.p { max-width: 0; } .a { overflow: hidden; width: calc(100% - 4px); }', one, 'a', 'a:text0', /its ancestor p has max-width 0px/);
    expectRefused('.p { display: flex; height: 0; } .a { overflow: hidden; }', one, 'a', 'a:text0', /its ancestor p has height 0px/);
  });
  it('compiles under a zero-size ancestor a clip box with its own size, an absolutely positioned one, an atomic inline, and an auto height', () => {
    for (const css of [
      '.p { width: 0; } .a { overflow: hidden; width: 50px; }',
      '.p { width: 0; position: relative; } .a { overflow: hidden; position: absolute; }',
      '.p { height: 0; } .a { overflow: hidden; }',
      '.p { max-height: 0; } .a { overflow: hidden; }',
      '.p { width: 0; } .a { overflow: hidden; display: inline-block; }',
    ]) expectCompiles(css, two);
  });
});

describe('clip view over text: text-indent', () => {
  it('refuses a negative indent, one of at least 100%, and one of at least the clip box\'s px width, own, inherited or inside', () => {
    expectRefused('.a { overflow: hidden; text-indent: -9999px; }', two, 'a', 'a:text0', /it has text-indent -9999px, which can move its first line out of the clip/);
    expectRefused('.p { text-indent: 100%; } .a { overflow: hidden; white-space: nowrap; }', one, 'a', 'a:text0', /it has text-indent 100%, at least its width/);
    expectRefused('.a { overflow: hidden; width: 50px; text-indent: 60px; }', one, 'a', 'a:text0', /at least the clip box's width and end padding, 50px/);
    expectRefused('.a { overflow: hidden; } .b { text-indent: calc(10% - 20px); }', deep, 'a', 'b:text0', /b has text-indent calc\(/);
  });
  it('compiles a positive indent below those bounds, inherited from the page (finding 3\'s repro)', () => {
    for (const css of ['body { text-indent: 2em; } .a { overflow: hidden; }', '.a { overflow: hidden; text-indent: 10%; }', '.a { overflow: hidden; width: 50px; text-indent: 40px; }']) expectCompiles(css, deep);
  });
});

describe('clip view over text: boxes that move the text', () => {
  it('refuses fixed positioning, a non-zero absolute inset, a horizontal offset or negative margin, a transform that can leave, and vertical moves of a line height or more', () => {
    for (const [css, why] of [
      ['.a { overflow: hidden; position: relative; } .b { position: absolute; left: -9999px; }', /b is position: absolute with a non-zero inset/],
      ['.a { overflow: hidden; } .b { position: fixed; }', /b is position: fixed/],
      ['.a { overflow: hidden; } .b { position: relative; left: 5px; }', /b is offset by left: 5px/],
      ['.a { overflow: hidden; } .b { position: relative; top: 100px; }', /the text is moved 100px by offsets, translations and negative margins, at least its line box's 5px/],
      ['.a { overflow: hidden; } .b { position: relative; top: 5%; }', /b is offset by top: 5%/],
      ['.a { overflow: hidden; } .b { transform: translateX(-200px); }', /b has transform translatex\(-200px\)/i],
      ['.a { overflow: hidden; } .b { transform: rotate(45deg); }', /b has transform rotate\(45deg\)/],
      ['.a { overflow: hidden; } .b { transform: scale(0.5); }', /b has transform scale\(0.5\)/],
      ['.a { overflow: hidden; } .b { transform: scale(2); transform-origin: -10px 0; }', /b has transform scale\(2\)/],
      ['.a { overflow: hidden; } .b { margin-top: -100px; }', /the text is moved 100px/],
      ['.a { overflow: hidden; } .b { margin-left: -1px; }', /b has margin-left -1px, which can move content out of the clip/],
      ['.a { overflow: hidden; } .b { line-height: 20px; transform: translateY(12px); position: relative; top: 8px; }', /the text is moved 20px .* at least its line box's 20px/],
    ] as const) expectRefused(css, deep, 'a', 'b:text0', why);
  });
  it('compiles moves that keep part of the line box in the clip (finding 4\'s repros)', () => {
    for (const css of [
      '.a { overflow: hidden; } .b { position: relative; top: 1px; }',
      '.a { overflow: hidden; } .b { margin-top: -1px; }',
      '.a { overflow: hidden; } .b { transform: scale(1); }',
      '.a { overflow: hidden; } .b { transform: scale(2) rotate(360deg); }',
      '.a { overflow: hidden; } .b { transform: translateY(2px); }',
      '.a { overflow: hidden; position: relative; } .b { position: absolute; top: 0; left: 0; }',
      '.a { overflow: hidden; } .b { margin: 2px auto; }',
    ]) expectCompiles(css, deep);
  });
});

describe('clip view over text: text pushed past a fixed block size or the end of its line (finding 5)', () => {
  it('refuses text that is not the clip box\'s first content when its block size is fixed', () => {
    expectRefused('.a { overflow: hidden; height: 10px; }', two, 'a', 'b:text0', /its block size is fixed by height 10px, and the text is not its first content, so it can sit wholly below the clip/);
    expectRefused('.a { overflow: hidden; max-height: 3em; }', two, 'a', 'b:text0', /fixed by max-height 30px/);
    expectRefused('.a { overflow: hidden; aspect-ratio: 4; }', two, 'a', 'b:text0', /fixed by aspect-ratio 4/);
    expectRefused('.p { display: grid; } .a { overflow: hidden; }', two, 'a', 'b:text0', /fixed by the grid container p, which sizes it/);
    expectRefused('.a { overflow: hidden; height: 10px; } .c { height: 100px; }', sibling, 'a', 'b:text0', /is not its first content/);
  });
  it('refuses first text a fixed block size moves down: margin, padding or border above it, or a downward offset', () => {
    expectRefused('.a { overflow: hidden; height: 10px; } .b { margin-top: 50px; }', deep, 'a', 'b:text0', /b has margin-top 50px above its text/);
    expectRefused('.a { overflow: hidden; height: 10px; } .b { padding-top: 50px; }', deep, 'a', 'b:text0', /b has padding-top 50px above its text/);
    expectRefused('.a { overflow: hidden; height: 10px; } .b { border-top: 1px solid; }', deep, 'a', 'b:text0', /b has border-top-width 1px above its text/);
    expectRefused('.a { overflow: hidden; height: 10px; } .b { position: relative; top: 2px; }', deep, 'a', 'b:text0', /the text is moved down 2px/);
  });
  it('refuses text after other content on a line that does not wrap, and text whose line box can be empty', () => {
    expectRefused('.a { overflow: hidden; width: 20px; white-space: nowrap; }', sameLine, 'a', 's:text0', /the text does not wrap \(text-wrap-mode: nowrap\) and follows other content on its line/);
    expectRefused('.a { overflow: hidden; line-height: 0; }', one, 'a', 'a:text0', /its line box can be empty \(line-height 0/);
    expectRefused('.a { overflow: hidden; font-size: 0; }', one, 'a', 'a:text0', /its line box can be empty/);
  });
  it('compiles the first text of a fixed-size clip, nowrap lines that each start a block, and an empty line box with bottom padding', () => {
    expectCompiles('.a { overflow: hidden; height: 20px; }', one);
    expectCompiles('.a { overflow: hidden; height: 2px; line-height: 2px; }', one);
    expectCompiles('.a { overflow: hidden; height: 10px; } .b { margin-top: -2px; }', deep);
    expectCompiles('.a { overflow: hidden; width: 20px; white-space: nowrap; }', twoBlocks);
    expectCompiles('.a { overflow: hidden; line-height: 0; padding-bottom: 10px; }', one);
    expectCompiles('.a { overflow: hidden; } .c { height: 100px; }', sibling);
  });
  it('a scroll container judges only its start side on the axes it scrolls: what lies past its end is scrolled to', () => {
    expectCompiles('.a { overflow: auto; height: 10px; } .c { height: 100px; }', sibling);
    expectCompiles('.a { overflow: auto; height: 10px; } .b { position: relative; top: 50px; }', deep);
    expectCompiles('.a { overflow: auto; width: 50px; text-indent: 60px; }', one);
    expectCompiles('.a { overflow-x: scroll; overflow-y: hidden; width: 50px; text-indent: 60px; }', one);
    expectRefused('.a { overflow: auto; } .b { margin-top: -100px; }', deep, 'a', 'b:text0', /the text is moved 100px/);
    expectRefused('.a { overflow-x: scroll; overflow-y: hidden; height: 10px; }', two, 'a', 'b:text0', /fixed by height 10px/);
  });
});

describe('clip view over text: what is not judged', () => {
  it('an auto-height clip over text still lowers its clip view', () => {
    expectCompiles('.a { overflow: hidden; }', two);
    const p = nativePrograms(compile('.a { overflow: hidden; }', two, NATIVE), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const prog of [p.programs.uikit, p.programs['android-views']]) expect(prog.nodes.find((n) => n.id === 'a')?.writes.map((w) => w.kind)).toContain('padding-box-clip');
  });
  it('a clip box without text, text under display: none, no clip, an inline box, web, and the root', () => {
    const bare: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'])])])];
    expect(viewErrors(compile('.a { overflow: hidden; height: 0; } .b { text-indent: -9999px; position: fixed; }', bare))).toEqual([]);
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
