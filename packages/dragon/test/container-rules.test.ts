// CQ: @container rules and container query units (analysis/container-rules.ts). A query container's width follows the viewport
// through block boxes, so each width a query compares with adds a viewport atom, every band decides each element's rules by its own
// query container, and cqw and cqi become that width as a calculation on the viewport. Chrome agreement is proven by the cq-rules
// and cq-units fixtures' resize lanes (packages/parity); these cases pin the compiler's decisions.
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

  it('resolves cqw and cqi against the nearest ancestor query container, as a px constant or a calculation on the viewport', () => {
    // q's content box is the viewport less 40px, floored at 0; b's is 300px.
    const body = (r: SourceRef): TreeNode[] => [div(r, 'q', ['q'], [div(r, 'a', ['a']), div(r, 'b', ['b'], [div(r, 'c', ['a'])])])];
    const c = compile('.q { container-type: inline-size; margin: 0 20px; } .b { container-type: inline-size; width: 300px; } .a { width: 50cqw; height: calc(10cqi + 2px); }', body);
    expect(errors(c)).toEqual([]);
    const W = { kind: 'max', terms: [px(0), { kind: 'sum', terms: [{ kind: 'viewport', value: 100, axis: 'width', size: 'large' }, px(-40)] }] };
    expect(widthIn(c, 0, [0, 0, 0])).toEqual({ kind: 'calc', expr: { kind: 'product', terms: [{ kind: 'number', value: 0.5 }, W] }, range: 'non-negative' });
    expect(widthIn(c, 0, [0, 0, 1, 0])).toEqual(px(150));
    // The planted containerUnitUnclamped drops the floor.
    const planted = createProjectWith({ projectId: 'test', targets: { ...NATIVE, web: {} } }, { faults: { ...NO_FAULTS, containerUnitUnclamped: true }, profiles: 'derive', direction: 'ltr', foldViewport: { width: 400, height: 300 } }).compile(input('.q { container-type: inline-size; margin: 0 20px; } .a { width: 50cqw; }', body));
    expect(widthIn(planted, 0, [0, 0, 0])).toEqual({ kind: 'calc', expr: { kind: 'sum', terms: [{ kind: 'viewport', value: 50, axis: 'width', size: 'large' }, px(-20)] }, range: 'non-negative' });
  });

  it('resolves cq units under inherit, behind var() with no @container rule, and with a negative sign in math', () => {
    // <div.q><div.a><div.b></div></div></div>: q is 300px wide, so 1cqw is 3px.
    const nested = (r: SourceRef): TreeNode[] => [div(r, 'q', ['q'], [div(r, 'a', ['a'], [div(r, 'b', ['b'])])])];
    const at = (css: string): unknown[] => {
      const c = compile(`.q { container-type: inline-size; width: 300px; } ${css}`, nested);
      expect(errors(c)).toEqual([]);
      // A calc() that folds to a constant stays a calc() node around its px value.
      const value = (w: unknown): unknown => ((w as { kind: string }).kind === 'calc' ? (w as { expr: unknown }).expr : w);
      return [value(widthIn(c, 0, [0, 0, 0])), value(widthIn(c, 0, [0, 0, 0, 0]))];
    };
    // An explicit inherit takes the parent's computed value, as Chrome does.
    expect(at('.a { width: calc(10cqw + 1px); } .b { width: inherit; }')).toEqual([px(31), px(31)]);
    expect(at('.a { width: 50cqw; } .b { width: inherit; }')).toEqual([px(150), px(150)]);
    expect(at('.a { --w: calc(10cqw + 1px); width: var(--w); } .b { width: var(--nope, 50cqw); }')).toEqual([px(31), px(150)]);
    expect(at('.a { width: calc(-5cqw + 100px); } .b { width: max(-5cqw, 2px); }')).toEqual([px(85), px(2)]);
  });

  it('refuses a container query unit with no query container, on an unreadable one, on an inherited property and on the block axis', () => {
    const inside = (r: SourceRef): TreeNode[] => [div(r, 'q', ['q'], [div(r, 'a', ['a'])])];
    const refusal = (css: string): string[] => errors(compile(`.q { container-type: inline-size; } ${css}`, inside)).filter((m) => /cq/.test(m));
    expect(refusal('.q { margin-left: 5cqw; }')).toEqual(['margin-left: 5cqw is not supported here: <div> has no query container, so the unit falls back to the small viewport, which needs the viewport inputs of the value-model package V2']);
    expect(refusal('.q { width: 50%; } .a { width: 5cqi; }')).toEqual(['width: 5cqi is not supported here: the width of its query container cannot be read: <div> has width: 50%; Dragon reads a container\'s width only through block boxes in flow with px widths, margins and padding and no left or right border']);
    expect(refusal('.a { letter-spacing: 1cqw; }')).toEqual(['letter-spacing: 1cqw is not supported here: letter-spacing is inherited, and a container query unit in an inherited property is not resolved yet']);
    // A refused calculation reports as one with svh does: its reason in a comment on the value.
    for (const m of refusal('.a { width: calc(1cqb + 1px); }')) expect(m).toContain('cqb is a block-axis container query unit');
    expect(refusal('.a { width: calc(1cqb + 1px); }').length).toBeGreaterThan(0);
    expect(refusal('.a { border-top-left-radius: 2cqw; }')).toEqual(['border-top-left-radius: 2cqw is unsupported: a container query unit is supported in layout lengths only (width, height, margins, padding, insets and the like), where Dragon resolves it against the query container']);
  });

  it('decides a query only for the elements its rule selects', () => {
    // .f is a flex container, whose width Dragon cannot read; no @container rule selects anything inside it.
    const body = (r: SourceRef): TreeNode[] => [...tree(r), div(r, 'f', ['f'], [div(r, 'c', ['c'])])];
    const c = compile('.q { container-type: inline-size; width: 200px; } .f { display: flex; container-type: inline-size; } .a { width: 10px; height: 5px; } @container (min-width: 150px) { .a { width: 30px; } }', body);
    expect(errors(c)).toEqual([]);
    expect(widthIn(c, 0, [0, 0, 0])).toEqual(px(30));
  });

  it('reads dashed and non-ASCII names, and a comment between the name and the condition, as Chrome does', () => {
    for (const name of ['--card', 'carté']) {
      const c = compile(`.q { container: ${name} / inline-size; width: 200px; } .a { width: 10px; height: 5px; } @container ${name} /* c */ (width > 150px) { .a { width: 30px; } }`);
      expect(errors(c)).toEqual([]);
      expect(widthIn(c, 0, [0, 0, 0])).toEqual(px(30));
    }
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
    // The refusal names the rule that changes the container, not the first @container rule.
    expect(refusal('@container (min-width: 10px) { .a { height: 1px; } } @container (min-width: 20px) { .a { container-type: inline-size; } }')).toEqual(['@container (min-width: 20px) is not supported here: a @container rule changes the container-type, container-name or width of a query container, which Dragon does not resolve']);
    // css-syntax-3: card( is a function token, so Chrome drops the rule; Dragon refuses it rather than read card as a name.
    expect(refusal('@container card(min-width: 1px) { .a { width: 1px; } }')).toEqual(['@container card(min-width: 1px) in the stylesheet is not supported: card( is a function token, not a container name, so Chrome drops this rule']);
  });
});
