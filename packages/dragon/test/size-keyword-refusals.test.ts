// The engine resolves min-content, max-content, fit-content and stretch widths only on a block-level box with no aspect-ratio
// (layout block.ts, intrinsic.ts) and never on a replaced box (replaced.ts through box.ts lengthWidth), and it refuses an atomic
// inline in a line-clamp container (inline.ts checkClampContext). A refusal on the device is a crash, so the compiler refuses each
// of these at build time (analysis/computed-checks.ts refuseSizeKeywords, analysis/line-clamp.ts), on every target.
import { describe, expect, it } from 'vitest';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import type { TreeNode } from '../src/index.ts';
import { div, inputFor, spanTextOf, text } from './helpers.ts';

const TARGETS = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
type Ref = Parameters<Parameters<typeof inputFor>[1]>[0];
const tagged = (r: Ref, tag: string, id: string, classes: string[], children: TreeNode[] = []): TreeNode => ({ ...div(r, id, classes, children), tag, attributes: [] }) as never;
const compile = (css: string, body: (r: Ref) => TreeNode[]) => {
  const input = inputFor(`${FONT} ${css}`, body);
  return { input, c: createProjectWith({ projectId: 'test', targets: TARGETS }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input) };
};

describe('sizing keywords the engine does not resolve', () => {
  it('are refused beside aspect-ratio and on a replaced box, at the keyword, on every target', () => {
    for (const [css, tag, span] of [
      ['.a { width: -webkit-max-content; aspect-ratio: 2 / 1; }', 'div', '-webkit-max-content'],
      ['.a { max-width: fit-content; aspect-ratio: 2 / 1; }', 'div', 'fit-content'],
      ['.a { display: flex; width: max-content; aspect-ratio: 1; }', 'div', 'max-content'],
      ['.a { width: stretch; aspect-ratio: 1; }', 'div', 'stretch'],
      ['.a { display: block; width: max-content; }', 'img', 'max-content'],
      ['.a { display: block; max-width: min-content; }', 'img', 'min-content'],
      ['.a { display: block; width: -webkit-fill-available; }', 'img', '-webkit-fill-available'],
      ['.a { display: block; width: fit-content; height: 20px; }', 'svg', 'fit-content'],
    ] as const) {
      const { input, c } = compile(css, (r) => [tagged(r, tag, 'a', ['a'])]);
      const hits = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('is not supported yet (css-sizing-3 §3.2'));
      expect(hits.map((d) => [d.target, spanTextOf(input, d)]).sort(), css).toEqual([['android', span], ['ios', span], ['web', span]]);
    }
  });

  it('compile on a block-level box with no ratio', () => {
    const { c } = compile('.a { width: max-content; } .b { width: stretch; }', (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX')]), div(r, 'b', ['b'])]);
    expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });
});

describe('RF-INL in a line clamp', () => {
  it('an inline img among the clamped lines is an atomic inline, refused on every target', () => {
    const clamp = '.c { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; width: 100px; } .i { width: 10px; height: 10px; }';
    for (const nested of [false, true]) {
      const { c } = compile(clamp, (r) => {
        const line = [text(r, 't', 'a'), tagged(r, 'img', 'i', ['i']), text(r, 'u', 'b')];
        return [div(r, 'c', ['c'], nested ? [div(r, 'p', [], line)] : line)];
      });
      const why = nested ? 'holds <div> p, which is not a block of inline content' : 'holds the inline-level box <img> i';
      const hits = c.diagnostics.filter((d) => d.severity === 'error' && d.message.includes(why));
      expect(hits.map((d) => d.target).sort(), String(nested)).toEqual(['android', 'ios', 'web']);
    }
  });
});
