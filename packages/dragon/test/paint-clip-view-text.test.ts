// The native refusal of text a padding-box clip view (overflow other than visible) could clip out of sight, which Chrome keeps in
// its accessibility tree and Android's View.isVisibleToUser drops: a zero or computed size on the clip box or an ancestor, a
// text-indent, and a box between them positioned, offset, transformed or given a negative margin. Controls: an auto-height clip
// over text, a clip without text, and web, which draws the clip itself.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, expectCatalogued, inputFor, text } from './helpers.ts';

const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const ALL: Targets = { ...NATIVE, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .p { width: 100px; } ';

// The clip box a holds text (a-t) and a box b with text (b-t); p is its parent.
const textTree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
// The same boxes with no text anywhere.
const bareTree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'])])])];
// b's text only, so a refusal names b's text.
const deepTree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];

const compile = (css: string, body: (r: SourceRef) => TreeNode[] = textTree, targets: Targets = ALL) =>
  createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(BASE + css, body));
const viewErrors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error' && /has overflow: .*, which (ios|android) draws as a clip view/.test(d.message));

function expectRefused(css: string, body: (r: SourceRef) => TreeNode[], at: string, textId: string, why: RegExp): void {
  const errs = viewErrors(compile(css, body));
  expect(errs.map((d) => [d.code, d.target]).sort(), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
  for (const d of errs) {
    expect(d.message, css).toMatch(new RegExp(`^${at} has overflow: `));
    expect(d.message, css).toMatch(why);
    expect(d.message, css).toContain(`its text ${textId} could be clipped out of sight, which Chrome keeps in its accessibility tree`);
  }
  expect(errs.find((d) => d.target === 'android')?.message, css).toContain('View.isVisibleToUser is false');
  expectCatalogued(errs);
}

describe('clip view over text: native refusals', () => {
  it('refuses a clip box whose height, max-height, width, max-width or flex-basis can be zero', () => {
    for (const [css, why] of [
      ['.a { overflow: hidden; height: 0; }', /its height 0px can leave its padding box no area/],
      ['.a { overflow: hidden; max-height: 0; }', /its max-height 0px/],
      ['.a { overflow: hidden; width: 0; }', /its width 0px/],
      ['.a { overflow: hidden; max-width: 0%; }', /its max-width 0%/],
      ['.a { overflow: hidden; height: calc(10% - 1px); }', /its height calc\(/],
      ['.a { overflow: clip; height: 0; }', /its height 0px/],
      ['.a { overflow: auto; height: 0; }', /its height 0px/],
      ['.p { display: flex; } .a { overflow: hidden; flex: 0 0 0; }', /its flex-basis 0px without flex-grow/],
    ] as const) expectRefused(css, textTree, 'a', 'a:text0', why);
  });
  it('refuses a clip box inside an ancestor whose size can be zero', () => {
    expectRefused('.p { width: 0; } .a { overflow: hidden; }', textTree, 'a', 'a:text0', /its ancestor p has width 0px, which can leave it no area too/);
    expectRefused('.p { height: 0; } .a { overflow: hidden; height: 100%; }', textTree, 'a', 'a:text0', /its ancestor p has height 0px/);
  });
  it('refuses text under a text-indent, inherited or on a box inside the clip', () => {
    expectRefused('.a { overflow: hidden; text-indent: -9999px; }', textTree, 'a', 'a:text0', /it has text-indent -9999px, which can move a line out of the clip/);
    expectRefused('.p { text-indent: 100%; } .a { overflow: hidden; white-space: nowrap; }', textTree, 'a', 'a:text0', /it has text-indent 100%/);
    expectRefused('.a { overflow: hidden; } .b { text-indent: -20px; }', deepTree, 'a', 'b:text0', /b has text-indent -20px/);
  });
  it('refuses text under a box inside the clip that is positioned, offset, transformed or given a negative margin', () => {
    for (const [css, why] of [
      ['.a { overflow: hidden; position: relative; } .b { position: absolute; left: -9999px; }', /b is position: absolute, which can place it outside the clip/],
      ['.a { overflow: hidden; } .b { position: fixed; }', /b is position: fixed/],
      ['.a { overflow: hidden; } .b { position: relative; top: 100px; }', /b is offset by its relative insets/],
      ['.a { overflow: hidden; } .b { position: sticky; left: -1px; }', /b is offset by its sticky insets/],
      ['.a { overflow: hidden; } .b { transform: translateX(-200px); }', /b has transform /],
      ['.a { overflow: hidden; } .b { margin-top: -100px; }', /b has margin-top -100px/],
      ['.a { overflow: hidden; } .b { margin-left: calc(10px - 50%); }', /b has margin-left calc\(/],
    ] as const) expectRefused(css, deepTree, 'a', 'b:text0', why);
  });
  it('points at the overflow declaration, and refuses once per clip box and target', () => {
    const errs = viewErrors(compile('.a { overflow-y: hidden; height: 0; } .b { text-indent: -1px; }', textTree, NATIVE));
    expect(errs.map((d) => d.target).sort()).toEqual(['android', 'ios']);
    expect(errs[0]?.message).toMatch(/^a has overflow: auto hidden, /);
    expect(errs[0]?.origin).toMatchObject({ kind: 'authored' });
  });
});

describe('clip view over text: what still compiles', () => {
  it('an auto-height clip over text, with sizes and offsets that keep it in place', () => {
    for (const css of [
      '.a { overflow: hidden; }',
      '.a { overflow: hidden; width: 50px; height: 20px; max-height: 30px; }',
      '.a { overflow: hidden; text-indent: 0; } .b { position: relative; top: 0; margin: 2px auto; }',
      '.a { overflow: auto; } .b { position: static; left: -9999px; }',
      '.p { display: flex; } .a { overflow: hidden; flex: 1 1 0; }',
    ]) {
      const c = compile(css);
      expect(viewErrors(c), css).toEqual([]);
      expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), css).toEqual([]);
    }
    const p = nativePrograms(compile('.a { overflow: hidden; }', textTree, NATIVE), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const prog of [p.programs.uikit, p.programs['android-views']]) expect(prog.nodes.find((n) => n.id === 'a')?.writes.map((w) => w.kind)).toContain('padding-box-clip');
  });
  it('a zero-size clip box without text, text under display: none, a clip that is not there, and web', () => {
    expect(viewErrors(compile('.a { overflow: hidden; height: 0; } .b { text-indent: -9999px; position: absolute; }', bareTree))).toEqual([]);
    expect(viewErrors(compile('.a { overflow: hidden; height: 0; } .b { display: none; }', deepTree))).toEqual([]);
    expect(viewErrors(compile('.a { height: 0; text-indent: -9999px; } .b { margin-top: -100px; }'))).toEqual([]);
    expect(viewErrors(compile('.a { overflow: hidden; height: 0; }', textTree, { web: {} }))).toEqual([]);
    // The viewport takes the root's overflow, so html hosts no clip view.
    expect(viewErrors(compile('html { overflow: hidden; text-indent: -9999px; }'))).toEqual([]);
  });
});
