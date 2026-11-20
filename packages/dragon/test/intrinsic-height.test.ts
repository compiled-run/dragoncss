// SIZE-KW: height, min-height and max-height of min-content, max-content and fit-content are the box's content height, which in
// block flow is its auto height (Chrome 145, sizing-keywords-height): native lowers them to auto and none (lower/ios-layout.ts
// blockSize). Where the content height is not the auto height (a flex or grid item, an absolutely positioned box, beside an
// aspect-ratio) or where the clamp to it would change the used height, the compiler refuses them on ios and android
// (analysis/computed-checks.ts checkIntrinsicHeights); the web output keeps the keyword, which Chrome resolves itself.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import type { TreeNode } from '../src/index.ts';
import { div, inputFor, spanTextOf, text } from './helpers.ts';

const TARGETS = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
type Ref = Parameters<Parameters<typeof inputFor>[1]>[0];
const compile = (css: string, body: (r: Ref) => TreeNode[]) => {
  const input = inputFor(`${FONT} ${css}`, body);
  return { input, c: createProjectWith({ projectId: 'test', targets: TARGETS }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input) };
};
const refused = (c: ReturnType<typeof compile>, part: string): string[][] =>
  c.c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes(part)).map((d) => [d.target as string, spanTextOf(c.input, d) as string]).sort();
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const NATIVE = (span: string): string[][] => [['android', span], ['ios', span]];
const find = (b: LayoutBox, id: string): LayoutBox | null => {
  if (b.id === id) return b;
  for (const k of b.children) if (k.kind === 'box') { const f = find(k, id); if (f !== null) return f; }
  return null;
};

describe('SIZE-KW: an intrinsic block size', () => {
  it('compiles in block flow and lowers to auto, and as a min-height or max-height to auto and none', () => {
    const c = compile('.a { height: min-content; min-height: -webkit-max-content; max-height: fit-content; } .b { min-height: min-content; } .c { height: fit-content; max-height: min-content; min-height: 4px; }', (r) => [
      div(r, 'a', ['a'], [text(r, 't', 'X')]), div(r, 'b', ['b']), div(r, 'c', ['c']),
    ]);
    expect(c.c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const p = iosLayoutProjection(c.c, ENV, []);
    if (p.kind !== 'ready') throw new Error('blocked');
    const root = p.input.root;
    expect([find(root, 'a')?.style.height, find(root, 'a')?.style.minHeight, find(root, 'a')?.style.maxHeight]).toEqual([{ kind: 'auto' }, { kind: 'auto' }, { kind: 'none' }]);
    expect(find(root, 'b')?.style.minHeight).toEqual({ kind: 'auto' });
    expect([find(root, 'c')?.style.height, find(root, 'c')?.style.maxHeight, find(root, 'c')?.style.minHeight]).toEqual([{ kind: 'auto' }, { kind: 'none' }, { kind: 'px', value: 4 }]);
  });

  it('refuses it on native on a flex or grid item and on an absolutely positioned box, where auto stretches', () => {
    expect(refused(compile('.f { display: flex; height: 40px; } .a { height: min-content; }', (r) => [div(r, 'f', ['f'], [div(r, 'a', ['a'])])]), 'height: min-content on a on a flex item')).toEqual(NATIVE('min-content'));
    // A flex item reached through display: contents is a flex item all the same (css-display-3 §2.5).
    expect(refused(compile('.f { display: inline-flex; } .d { display: contents; } .a { max-height: max-content; }', (r) => [div(r, 'f', ['f'], [div(r, 'd', ['d'], [div(r, 'a', ['a'])])])]), 'max-height: max-content on a on a flex item')).toEqual(NATIVE('max-content'));
    expect(refused(compile('.g { display: grid; } .a { min-height: fit-content; }', (r) => [div(r, 'g', ['g'], [div(r, 'a', ['a'])])]), 'min-height: fit-content on a on a grid item')).toEqual(NATIVE('fit-content'));
    expect(refused(compile('.p { position: relative; height: 40px; } .a { position: absolute; top: 0; bottom: 0; height: fit-content; }', (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])]), 'height: fit-content on a on an absolutely positioned box')).toEqual(NATIVE('fit-content'));
    // An absolutely positioned child of a flex container is not a flex item, and is refused as positioned.
    expect(refused(compile('.f { display: flex; position: relative; } .a { position: absolute; height: max-content; }', (r) => [div(r, 'f', ['f'], [div(r, 'a', ['a'])])]), 'height: max-content on a on an absolutely positioned box')).toEqual(NATIVE('max-content'));
    // A block inside a flex item is in block flow.
    expect(refused(compile('.f { display: flex; } .a { height: min-content; }', (r) => [div(r, 'f', ['f'], [div(r, 'i', [], [div(r, 'a', ['a'])])])]), 'min-content')).toEqual([]);
  });

  it('refuses it on native beside an aspect-ratio and where its clamp would change the used height', () => {
    expect(refused(compile('.a { width: 100px; aspect-ratio: 2; max-height: min-content; }', (r) => [div(r, 'a', ['a'])]), 'max-height: min-content on a beside aspect-ratio')).toEqual(NATIVE('min-content'));
    expect(refused(compile('.a { height: 5px; min-height: max-content; }', (r) => [div(r, 'a', ['a'], [text(r, 't', 'X')])]), 'min-height: max-content on a that clamps a height other than auto')).toEqual(NATIVE('max-content'));
    expect(refused(compile('.a { height: stretch; max-height: min-content; }', (r) => [div(r, 'a', ['a'])]), 'max-height: min-content on a that clamps a height other than auto')).toEqual(NATIVE('min-content'));
    expect(refused(compile('.a { min-height: min-content; max-height: 4px; }', (r) => [div(r, 'a', ['a'], [text(r, 't', 'X')])]), 'min-height: min-content on a beside a max-height')).toEqual(NATIVE('min-content'));
  });
});
