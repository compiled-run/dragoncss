// CQ: @container rules (analysis/container-rules.ts). A query container's width follows the viewport through block boxes, so each
// width a query compares with adds a viewport atom, and every band decides each element's rules by its own query container. Chrome
// agreement is proven by the cq-rules fixture's resize lanes (packages/parity); these cases pin the compiler's decisions.
import { describe, expect, it } from 'vitest';
import type { Compiled, FrontEndResult, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, mediaFeatures, nativeBandOfViewport, nativeBandPrograms, nativeBands, NO_FAULTS } from '../src/internal.ts';
import { div, inputFor } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const NATIVE = { ios: { minimum: '15.0' }, android: { minSdk: 31 } } as const;
// <div.q #q><div.a #a></div></div><div.a #b></div>: a inside the container, b outside any.
const tree = (r: SourceRef): TreeNode[] => [div(r, 'q', ['q'], [div(r, 'a', ['a'])]), div(r, 'b', ['a'])];
const input = (css: string, body = tree): FrontEndResult => inputFor(`${FONT} ${css}`, body);
const compile = (css: string, body = tree): Compiled<'ios' | 'android' | 'web'> =>
  createProjectWith({ projectId: 'test', targets: { ...NATIVE, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', foldViewport: { width: 400, height: 300 } }).compile(input(css, body));
const errors = (c: Compiled<string>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);

/** The width the native program gives a box (by its path of child indexes under the root) in a band. */
const widthIn = (c: Compiled<'ios' | 'android' | 'web'>, band: number, path: readonly number[]): unknown => {
  const p = nativeBandPrograms(c, [], band);
  if (p.kind !== 'ready') throw new Error(p.reason);
  let n = p.programs.uikit.root;
  for (const k of path) n = n.children[k] as typeof n;
  return (n.style as unknown as { width: unknown }).width;
};
const px = (value: number) => ({ kind: 'px', value });

describe('CQ: @container rules', () => {
  it('splits the viewport where the container reaches the queried width, and applies the rule inside the container only', () => {
    // The container is the viewport less 2 x 20px margin and 2 x 5px padding: 300px wide at a 350px viewport.
    const c = compile('.q { container-type: inline-size; margin: 0 20px; padding: 0 5px; } .a { width: 10px; height: 5px; } @container (min-width: 300px) { .a { width: 30px; } }');
    expect(errors(c)).toEqual([]);
    const bands = nativeBands(c);
    expect(bands?.conditions).toEqual(['(not (width >= 350px))', '(width >= 350px)']);
    expect([349, 350, 400].map((w) => nativeBandOfViewport(c, { width: w, height: 300 }))).toEqual([0, 1, 1]);
    // html > body > [q > a, b]
    expect([widthIn(c, 0, [0, 0, 0]), widthIn(c, 1, [0, 0, 0])]).toEqual([px(10), px(30)]);
    expect([widthIn(c, 0, [0, 1]), widthIn(c, 1, [0, 1])]).toEqual([px(10), px(10)]);
    expect(mediaFeatures(c)).toEqual(['at-rule:@container', 'at-rule:@media', 'media-feature:width']);
  });

  it('asks for a named container, and needs no band where the container has a px width', () => {
    const c = compile('.q { container: card / inline-size; width: 200px; } .a { width: 10px; height: 5px; } @container card (width > 150px) { .a { width: 30px; } } @container other (width > 150px) { .a { height: 30px; } }');
    expect(errors(c)).toEqual([]);
    expect(nativeBands(c)).toBeNull();
    expect(widthIn(c, 0, [0, 0, 0])).toEqual(px(30));
  });

  it('combines with @media bands', () => {
    const c = compile('.q { container-type: inline-size; } .a { width: 10px; height: 5px; } @media (min-width: 320px) { .q { padding-left: 40px; } } @container (min-width: 300px) { .a { width: 30px; } }');
    expect(errors(c)).toEqual([]);
    // Under 320px the container is the viewport (atom 300); from 320px it is 40px narrower (atom 340).
    expect([304, 312, 320, 336, 344, 400].map((w) => {
      const b = nativeBandOfViewport(c, { width: w, height: 300 }) as number;
      return widthIn(c, b, [0, 0, 0]);
    })).toEqual([px(30), px(30), px(10), px(10), px(30), px(30)]);
  });

  it('refuses what Dragon does not resolve', () => {
    const refusal = (css: string): string[] => errors(compile(`.q { container-type: inline-size; } ${css}`)).filter((m) => m.includes('@container'));
    expect(refusal('@container (height > 10px) { .a { width: 1px; } }')).toEqual(['@container (height > 10px) in the stylesheet is not supported: height is not supported; a query container is an inline-size container, and Dragon reads only its width']);
    expect(refusal('@container (min-width: 10em) { .a { width: 1px; } }')).toEqual(['@container (min-width: 10em) in the stylesheet is not supported: (min-width: 10em) is not supported; only px lengths are']);
    expect(refusal('@container style(--x: 1) { .a { width: 1px; } }')).toEqual(['@container style(--x: 1) in the stylesheet is not supported: only width queries are supported, not style() or scroll-state() queries']);
    expect(refusal('@container card { .a { width: 1px; } }')).toEqual(['@container card in the stylesheet is not supported: a @container rule without a size query is not supported']);
    expect(refusal('.q { width: 50%; } @container (min-width: 10px) { .a { width: 1px; } }')).toEqual(['@container (min-width: 10px) is not supported here: the width of its query container cannot be read: <div> has width: 50%; Dragon reads a container\'s width only through block boxes in flow with px widths, margins and padding and no left or right border']);
    expect(refusal('@container (min-width: 10px) { .a { transition: width 1s; } }')).toEqual(['transition inside @container is not supported: transition and animation lists that differ per query container are not built yet']);
    expect(refusal('@container (min-width: 10px) { .a { container-type: inline-size; } }')).toEqual(['@container (min-width: 10px) is not supported here: a @container rule changes the container-type, container-name or width of a query container, which Dragon does not resolve']);
  });
});
