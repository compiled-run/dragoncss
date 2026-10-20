// POSX-s: the engine offsets a sticky box against the viewport at scroll offset 0 (packages/layout/src/layout.ts stickyOffset) and
// refuses a sticky root, an inline-level sticky box, a sticky box inside another or inside a scroll container, and a percentage
// padding on its parent. A refusal on the device is a crash, so the compiler refuses each at build time (analysis/computed-checks.ts
// checkSticky): on every target, except inside a scroll container, which Chrome handles on the web and native would not follow.
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { TreeNode } from '../src/index.ts';
import { div, inputFor, spanTextOf, text } from './helpers.ts';

const TARGETS = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
type Ref = Parameters<Parameters<typeof inputFor>[1]>[0];
const compile = (css: string, body: (r: Ref) => TreeNode[]) => {
  const input = inputFor(`${FONT} ${css}`, body);
  return { input, c: createProjectWith({ projectId: 'test', targets: TARGETS }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input) };
};
const sticky = (c: ReturnType<typeof compile>, prefix: string): string[][] =>
  c.c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes(prefix)).map((d) => [d.target as string, spanTextOf(c.input, d) as string]).sort();

describe('POSX-s: position: sticky', () => {
  it('compiles in block flow, in a flex container, beside text and with every inset', () => {
    const c = compile('.a { position: sticky; top: 10%; bottom: 2px; left: 3px; right: 4px; } .f { display: flex; } .b { position: sticky; top: 0; }', (r) => [
      div(r, 'p', [], [text(r, 't', 'XX'), div(r, 'a', ['a'])]),
      div(r, 'f', ['f'], [div(r, 'b', ['b'], [text(r, 'u', 'Y')])]),
    ]);
    expect(c.c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('refuses an inline-level sticky box, one inside another, and a percentage padding on its parent, on every target', () => {
    const all = [['android', 'sticky'], ['ios', 'sticky'], ['web', 'sticky']];
    expect(sticky(compile('.a { display: inline-block; position: sticky; top: 0; }', (r) => [div(r, 'a', ['a'])]), 'on the inline-block box a')).toEqual(all);
    expect(sticky(compile('.o { position: sticky; top: 0; } .a { position: sticky; top: 1px; }', (r) => [div(r, 'o', ['o'], [div(r, 'a', ['a'])])]), 'on a inside the sticky o')).toEqual(all);
    expect(sticky(compile('.p { padding-top: calc(5% + 1px); } .a { position: sticky; top: 0; }', (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])]), 'a percentage padding-top on p')).toEqual(all);
  });

  it('refuses a sticky box inside a hidden, auto or scroll container on ios and android only, but not under the viewport\'s overflow or clip', () => {
    for (const o of ['hidden', 'auto', 'scroll']) {
      const c = compile(`.s { overflow: ${o}; height: 50px; } .a { position: sticky; top: 0; }`, (r) => [div(r, 's', ['s'], [div(r, 'k', [], [div(r, 'a', ['a'])])])]);
      expect(sticky(c, 'the sticky a inside the scroll container s'), o).toEqual([['android', 'sticky'], ['ios', 'sticky']]);
    }
    const viewport = compile('body { overflow: hidden; } .a { position: sticky; top: 0; }', (r) => [div(r, 'a', ['a'])]);
    expect(sticky(viewport, 'sticky')).toEqual([]);
    const clip = compile('.s { overflow: clip; height: 50px; } .a { position: sticky; top: 0; }', (r) => [div(r, 's', ['s'], [div(r, 'a', ['a'])])]);
    expect(sticky(clip, 'sticky')).toEqual([]);
  });
});
