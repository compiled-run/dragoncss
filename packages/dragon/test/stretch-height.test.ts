// SIZE-KW: height, min-height and max-height of stretch (Chrome's -webkit-fill-available computes to it) lower to the engine's
// stretch on a block-level box in block flow (packages/layout/src/box.ts stretchBlockSize). The engine refuses it on the root, beside
// an aspect-ratio, on a replaced box and inside a flex item, whose flexed or stretched height it does not take as definite; a refusal
// on the device is a crash, so the compiler refuses each at build time on every target (analysis/computed-checks.ts).
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
const refused = (c: ReturnType<typeof compile>, part: string): string[][] =>
  c.c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes(part)).map((d) => [d.target as string, spanTextOf(c.input, d) as string]).sort();
const ALL = (span: string): string[][] => [['android', span], ['ios', span], ['web', span]];

describe('SIZE-KW: a stretch block size', () => {
  it('compiles in block flow, nested, inside a flex container\'s block descendants and as -webkit-fill-available', () => {
    const c = compile('.p { height: 50px; } .a { height: stretch; min-height: -webkit-fill-available; max-height: stretch; margin: 3px; } .f { display: flex; position: relative; } .g { position: absolute; top: 0; bottom: 0; }', (r) => [
      div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['a'], [text(r, 't', 'X')])])]),
      div(r, 'f', ['f'], [div(r, 'g', ['g'], [div(r, 'c', ['a'])])]),
    ]);
    expect(c.c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('refuses it on the root, inside a flex item and beside an aspect-ratio, on every target', () => {
    expect(refused(compile('html { height: stretch; }', (r) => [div(r, 'a', [])]), 'on html on the root element')).toEqual(ALL('stretch'));
    expect(refused(compile('.f { display: flex; height: 40px; } .a { min-height: -webkit-fill-available; }', (r) => [div(r, 'f', ['f'], [div(r, 'i', [], [div(r, 'a', ['a'])])])]), 'min-height: stretch on a inside a flex item')).toEqual(ALL('-webkit-fill-available'));
    expect(refused(compile('.a { aspect-ratio: 2; max-height: stretch; }', (r) => [div(r, 'a', ['a'])]), 'max-height: stretch on a beside aspect-ratio')).toEqual(ALL('stretch'));
  });
});
