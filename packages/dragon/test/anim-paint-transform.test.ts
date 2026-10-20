// T065 ANIM-b2: transform in transitions and @keyframes. Admission and the ANIM-m refusals (spec §1, M10), the tables a program
// carries (typed functions per endpoint, the origin per node) and the runtime animator's transform writes, against Chrome 145's
// numbers (M5 at 250 ms; anim-spin at 5000 ms dumps matrix(0, 1, -1, 0, 0, 0)).
import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '@dragon/layout';
import { rtAnimator, serializeTransform } from '@dragon/layout';
import { NO_ANIMATOR_FAULTS } from '../../layout/src/rt-animator.ts';
import { NO_RT_FAULTS } from '../../layout/src/rt-easing.ts';
import { analyzeAnimations } from '../src/analysis/animations.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import { parseKeyframesRules } from '../src/css/at-rules/keyframes.ts';
import type { KeyframesSource } from '../src/css/at-rules/keyframes.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic, DraftTree, FrontEndResult, SourceRef } from '../src/index.ts';
import { createProjectWith, NO_FAULTS } from '../src/internal.ts';
import { animTablesOf, lowerAnimProgram } from '../src/lower/anim-program.ts';
import { internalRecord } from '../src/project.ts';
import { div, DOC, eq, inputFor, not } from './helpers.ts';

/** One element `a` whose class `on` follows the free boolean state open (initially false). */
function stated(css: string): FrontEndResult {
  const input = inputFor(css, (r: SourceRef) => {
    const d = div(r, 'a', ['a']);
    const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: d.origin };
    return [{ ...d, classes: [...d.classes, on] }];
  });
  const tree = input.tree as DraftTree;
  const root = tree.components[0] as DraftTree['components'][number];
  return { ...input, tree: { ...tree, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } };
}

const compile = (css: string): readonly Diagnostic[] =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(stated(css)).diagnostics;
const refusals = (css: string): string[] => compile(css).map((d) => d.message);

function program(css: string) {
  const input = stated(css);
  const compiled = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  const cases = (internalRecord(compiled)?.cases ?? []).map((c) => ({ key: c.key, resolved: c.resolved as ResolvedElement }));
  const diagnostics: Diagnostic[] = [];
  const sources: KeyframesSource[] = [];
  const source = input.snapshot.sources[0] as { ref: SourceRef };
  const rules = parseStylesheet(css, { source: source.ref, start: 0, end: css.length }, { id: 's', owner: DOC, scope: 'document' }, 0, diagnostics, [], [], sources);
  const analysis = analyzeAnimations({ cases, rules, allRules: rules, keyframes: parseKeyframesRules(sources, diagnostics), faults: NO_FAULTS, knownProperty: () => true }, diagnostics);
  expect(diagnostics).toEqual([]);
  return lowerAnimProgram(analysis, cases);
}

const TRIG = { sin: Math.sin, cos: Math.cos };

/** The animator over a program's tables; transforms read no engine input, so each assignment's input is a placeholder. */
function animate(css: string) {
  const ap = program(css);
  const t = animTablesOf(ap);
  const inputs = ap.assignments.map(() => ({}) as LayoutInput);
  const initial = ap.assignments.findIndex((k) => !k.includes('true'));
  let s = rtAnimator.animatorStart(t, inputs, initial, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
  const writes = (): rtAnimator.TransformWrite[] => rtAnimator.frameTransforms(s, t, rtAnimator.animatorFrame(s, t, NO_RT_FAULTS));
  return {
    ap,
    t,
    open: () => (s = rtAnimator.animatorEvent(s, t, inputs, initial, 1 - initial, NO_RT_FAULTS, NO_ANIMATOR_FAULTS)),
    advance: (ms: number) => (s = rtAnimator.animatorAdvance(s, t, inputs, initial, ms, NO_RT_FAULTS, NO_ANIMATOR_FAULTS)),
    writes,
    matrix: (w: number, h: number): string => serializeTransform((writes()[0] as rtAnimator.TransformWrite).ops, w, h, TRIG),
  };
}

const SPIN = '.a { width: 20px; height: 20px; animation: spin 20s linear infinite; } @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }';
const SLIDE = '.a { width: 200px; height: 10px; transform: translateX(100%); transition: transform 0.5s ease; } .a.on { transform: translateX(0%); }';

describe('ANIM-b2: transform animations', () => {
  it('admits a rotation keyframe pair, a translate(%) transition, and none against a function list (identity padding)', () => {
    expect(compile(SPIN)).toEqual([]);
    expect(compile(SLIDE)).toEqual([]);
    expect(compile('.a { animation: k 1s infinite; } @keyframes k { to { transform: translateX(5px) scale(2) } }')).toEqual([]);
    expect(compile('.a { transform: translate(1px, 2px); transition: transform 1s; } .a.on { transform: translateX(5px) rotate(10deg); }')).toEqual([]);
  });

  it('refuses mismatched function lists, a matrix() endpoint and a neutral keyframe that mismatches the element (ANIM-m, M10)', () => {
    const m = 'mismatched transform functions need matrix interpolation (package ANIM-m)';
    expect(refusals('.a { transform: translateX(10px); transition: transform 1s; } .a.on { transform: rotate(10deg); }')).toEqual([`transform on a: a transition between two reachable states: ${m}`]);
    expect(refusals('.a { animation: k 1s infinite; } @keyframes k { from { transform: translateX(0px) } to { transform: rotate(90deg) } }')).toEqual([`transform in @keyframes k on a: ${m}`]);
    expect(refusals('.a { transform: translateX(5px); animation: k 1s infinite; } @keyframes k { to { transform: rotate(90deg) } }')).toEqual([`transform in @keyframes k on a: ${m}`]);
    expect(refusals('.a { animation: k 1s infinite; } @keyframes k { to { transform: matrix(1, 0, 0, 1, 5, 0) } }')).toEqual([`transform in @keyframes k on a: ${m}`]);
    // Neighbouring keyframes only: translateX and rotate never meet when none sits between them.
    expect(compile('.a { animation: k 1s infinite; } @keyframes k { from { transform: translateX(5px) } 50% { transform: none } to { transform: rotate(90deg) } }')).toEqual([]);
  });

  it('refuses a rotation after a scale that is non-uniform at either end, which skews the box between them (PNT2-m)', () => {
    expect(refusals('.a { animation: k 1s infinite; } @keyframes k { from { transform: scaleX(2) } to { transform: scaleX(1) rotate(90deg) } }')).toEqual([
      "transform in @keyframes k on a: a rotation after a non-uniform scale skews the box between these values, which Android's View transform cannot express (package PNT2-m)",
    ]);
    // 3D and skew are refused where the value is read, as in a static transform.
    expect(refusals('.a { animation: k 1s infinite; } @keyframes k { to { transform: rotate3d(1, 0, 0, 45deg) } }').some((d) => d.includes('PNT2-m'))).toBe(true);
  });

  it('refuses an animated transform on an element whose transform is none with a positioned descendant (its animated containing block)', () => {
    const tree = (css: string): FrontEndResult => {
      const input = inputFor(css, (r: SourceRef) => [div(r, 'a', ['a'], [div(r, 'p', ['p'])])]);
      return input;
    };
    const diags = (css: string): string[] => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(tree(css)).diagnostics.map((d) => d.message);
    const spin = '.a { animation: k 1s infinite; } @keyframes k { to { transform: rotate(90deg) } }';
    expect(diags(`${spin} .p { position: absolute; }`)).toEqual(['animation k on a animates transform on an element whose transform is none, with a positioned descendant, whose containing block it becomes: the containing block and stacking context it makes while it animates are not built yet (package ANIM-b2)']);
    expect(diags(spin)).toEqual([]);
    // With a transform of its own the element is refused as PNT2 refuses any transformed containing block, animated or not.
    expect(diags(`${spin} .a { transform: rotate(0deg); } .p { position: absolute; }`)).toEqual(["a transform on a makes it the containing block of the absolutely positioned p (css-transforms-1 §3), which Dragon's layout does not model yet"]);
  });

  it('refuses an animated transform on an element whose transform is none when its stacking context would reorder paint', () => {
    const diags = (css: string, kids: (r: SourceRef) => ReturnType<typeof div>[]): string[] => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(css, kids)).diagnostics.map((d) => d.message);
    const spin = 'body { margin: 0; } .a { height: 20px; animation: k 1s infinite; } @keyframes k { to { transform: translateX(10px) } }';
    const why = (s: string): string => `animation k on a animates transform on an element whose transform is none, with ${s}: the containing block and stacking context it makes while it animates are not built yet (package ANIM-b2)`;
    // A later sibling: Chrome paints the animating a over b, as a stacking context; native would paint b over it.
    const order = why('content its stacking context would paint in another order');
    expect(diags(`${spin} .b { height: 20px; margin-top: -10px; }`, (r) => [div(r, 'a', ['a']), div(r, 'b', ['b'])])).toEqual([order]);
    // An earlier positioned sibling (a layer item): Chrome paints the animating a over it, native under it.
    expect(diags(`${spin} .p { position: relative; height: 20px; }`, (r) => [div(r, 'p', ['p']), div(r, 'a', ['a'])])).toEqual([order]);
    // A z-index on a flex item inside it: its own stacking context would hold the item.
    expect(diags(`${spin} .a { display: flex; } .z { z-index: -1; height: 5px; }`, (r) => [div(r, 'a', ['a'], [div(r, 'z', ['z'])])])).toEqual([order]);
    // An earlier box (no text) and its own children are fine; a transform of its own already makes it a stacking context.
    expect(diags(`${spin} .e { height: 5px; } .c { height: 5px; }`, (r) => [div(r, 'e', ['e']), div(r, 'a', ['a'], [div(r, 'c', ['c'])])])).toEqual([]);
    expect(diags(`${spin} .a { transform: translateX(1px); } .b { height: 20px; }`, (r) => [div(r, 'a', ['a']), div(r, 'b', ['b'])])).toEqual([]);
  });

  it('refuses a missing 0% or 100% transform keyframe over another animation of transform (its underlying value is that animation)', () => {
    const css = '.a { animation: r 1s infinite, t 1s infinite; } @keyframes r { from { transform: rotate(0deg) } to { transform: rotate(90deg) } } @keyframes t { to { transform: translateX(10px) } }';
    expect(refusals(css)).toEqual(expect.arrayContaining(['animation t on a leaves out its 0% or 100% transform keyframe over another animation of transform, whose frames that keyframe would take: not built yet (package ANIM-b2)']));
    // Both ends written, or the lower animation the one with the gap, compile.
    expect(refusals(css.replace('@keyframes t { to', '@keyframes t { from { transform: translateX(0px) } to'))).toEqual([]);
    expect(refusals('.a { animation: t 1s infinite, r 1s infinite; } @keyframes r { from { transform: rotate(0deg) } to { transform: rotate(90deg) } } @keyframes t { to { transform: translateX(10px) } }')).toEqual([]);
  });

  it('carries the typed functions per endpoint (em in keyframes against the font size) and the origin of every transformed node', () => {
    const ap = program('.a { font-size: 10px; transform-origin: 0 0; animation: k 1s infinite; } @keyframes k { to { transform: translateX(2em) rotate(30deg) } }');
    expect(ap.keyframes[0]?.blocks[0]?.values).toEqual([{ property: 'transform', value: { kind: 'transform', fns: [{ kind: 'translate', fn: 'translateX', x: { value: 20, unit: 'px' }, y: { value: 0, unit: 'px' }, text: 'translatex(2em)' }, { kind: 'rotate', deg: 30, text: 'rotate(30deg)' }] } }]);
    expect(ap.bases.map((b) => [b.node, b.property, b.values])).toEqual([['a', 'transform', [{ kind: 'transform', fns: [] }, { kind: 'transform', fns: [] }]]]);
    expect(ap.origins).toEqual([{ node: 'a', values: [0, 1].map(() => ({ x: { kind: 'px', px: 0, percent: 0 }, y: { kind: 'px', px: 0, percent: 0 } })) }]);
    const t = animTablesOf(ap);
    expect(t.bases[0]?.kind).toBe('transform');
    expect(t.keyframes[0]?.blocks[0]?.values[0]?.value.ops.map((o) => [o.fn, o.x, o.angle])).toEqual([['translateX', { kind: 'px', px: 20, percent: 0 }, 0], ['rotate', { kind: 'px', px: 0, percent: 0 }, 30]]);
  });

  it('anim-spin: rotate(0deg) to rotate(360deg) over 20 s is matrix(0, 1, -1, 0, 0, 0) at 5000 ms, about the box centre', () => {
    const a = animate(SPIN);
    expect(a.matrix(20, 20)).toBe('matrix(1, 0, 0, 1, 0, 0)');
    a.advance(5000);
    expect(a.matrix(20, 20)).toBe('matrix(0, 1, -1, 0, 0, 0)');
    expect(a.writes()[0]?.origin).toEqual({ x: { kind: 'percent', px: 0, percent: 50 }, y: { kind: 'percent', px: 0, percent: 50 } });
  });

  it('anim-slide: translateX(100%) to 0% with ease is M5 at 250 ms, resolved against the border box at use, and the static value after', () => {
    const a = animate(SLIDE);
    // Before the transition the state program holds no transform write of a: the animator writes the static value.
    expect(a.matrix(200, 10)).toBe('matrix(1, 0, 0, 1, 200, 0)');
    a.open();
    a.advance(250);
    expect(a.writes()[0]?.ops.map((o) => [o.fn, o.x.kind])).toEqual([['translateX', 'percent']]);
    expect(a.matrix(200, 10)).toBe('matrix(1, 0, 0, 1, 39.5193, 0)');
    a.advance(300);
    expect(a.matrix(200, 10)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });
});
