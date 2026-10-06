// T065 ANIM-b1: the animation tables of a program (lower/anim-program.ts) and the web output's animation longhands and
// @keyframes (R15), on a document with one free boolean state.
import { describe, expect, it } from 'vitest';
import { analyzeAnimations } from '../src/analysis/animations.ts';
import { parseKeyframesRules } from '../src/css/at-rules/keyframes.ts';
import type { KeyframesSource } from '../src/css/at-rules/keyframes.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { ResolvedElement } from '../src/analysis/resolve.ts';
import type { Diagnostic, DraftTree, FrontEndResult, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import { internalRecord } from '../src/project.ts';
import { lowerAnimProgram } from '../src/lower/anim-program.ts';
import { div, DOC, eq, inputFor, not, text } from './helpers.ts';

function stated(css: string, child: (r: SourceRef) => TreeNode[] = () => []): FrontEndResult {
  const input = inputFor(css, (r) => {
    const d = div(r, 'a', ['a'], child(r));
    const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: d.origin };
    return [{ ...d, classes: [...d.classes, on] }, div(r, 'b', ['b'])];
  });
  const tree = input.tree as DraftTree;
  const root = tree.components[0] as DraftTree['components'][number];
  return { ...input, tree: { ...tree, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } };
}

function program(css: string, child?: (r: SourceRef) => TreeNode[], knownProperty: (name: string) => boolean = () => true) {
  const input = stated(css, child);
  const compiled = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  const cases = (internalRecord(compiled)?.cases ?? []).map((c) => ({ key: c.key, resolved: c.resolved as ResolvedElement }));
  const diagnostics: Diagnostic[] = [];
  const sources: KeyframesSource[] = [];
  const source = input.snapshot.sources[0] as { ref: SourceRef };
  const rules = parseStylesheet(css, { source: source.ref, start: 0, end: css.length }, { id: 's', owner: DOC, scope: 'document' }, 0, diagnostics, [], [], sources);
  const analysis = analyzeAnimations({ cases, rules, allRules: rules, keyframes: parseKeyframesRules(sources, diagnostics), faults: NO_FAULTS, knownProperty }, diagnostics);
  expect(diagnostics).toEqual([]);
  return lowerAnimProgram(analysis, cases);
}

describe('lowerAnimProgram', () => {
  it('has one slot per (element, property) whose value differs between assignments, with each listing, and none for unchanged ones', () => {
    const p = program('.a { width: 10px; height: 5px; color: rgb(0, 0, 0); transition: width 1s ease 0.5s, height 2s; } .a.on { width: 20px; color: rgb(9, 9, 9); }');
    expect(p.slots.map((s) => [s.node, s.property, s.kind, s.range, s.values, s.listings.map((l) => [l?.mode, l?.delay, l?.duration, l?.easing.text])])).toEqual([
      ['a', 'width', 'length', 'non-negative', [{ kind: 'length', px: 10, percent: 0, calc: false }, { kind: 'length', px: 20, percent: 0, calc: false }], [['listed', 0.5, 1, 'ease'], ['listed', 0.5, 1, 'ease']]],
    ]);
  });

  it('a legacy alias in transition-property or the transition shorthand lists its property, as Chrome resolves it', () => {
    const slots = (css: string) => program(css, undefined, () => false).slots.map((s) => [s.node, s.property, s.listings.map((l) => [l?.mode, l?.duration])]);
    const width = '.a { width: 10px; margin-left: 1px; } .a.on { width: 20px; margin-left: 4px; }';
    expect(slots(`${width} .a { transition: -webkit-logical-width 1s; }`)).toEqual(slots(`${width} .a { transition: inline-size 1s; }`));
    expect(slots(`${width} .a { transition: -webkit-logical-width 1s; }`)).toEqual([['a', 'width', [['listed', 1], ['listed', 1]]]]);
    expect(slots(`${width} .a { transition-property: -WEBKIT-MARGIN-START, -webkit-logical-width; transition-duration: 2s; }`)).toEqual(slots(`${width} .a { transition-property: margin-inline-start, inline-size; transition-duration: 2s; }`));
    expect(slots(`${width} .a { transition-property: -webkit-margin-start; transition-duration: 2s; }`)).toEqual([['a', 'margin-left', [['listed', 2], ['listed', 2]]]]);
  });

  it('expands all and carries the unlisted and initial modes per assignment', () => {
    const p = program('.a { margin-left: 1px; transition: all 1s; } .a.on { margin-left: 4px; transition: none; }');
    expect(p.slots.map((s) => [s.property, s.listings.map((l) => l?.mode)])).toEqual([['margin-left', ['listed', 'unlisted']]]);
    const q = program('.a { margin-left: 1px; } .a.on { margin-left: 4px; transition: margin 1s; }');
    expect(q.slots.map((s) => [s.property, s.listings.map((l) => l?.mode)])).toEqual([['margin-left', ['initial', 'listed']]]);
  });

  it('lists each animation per assignment, resolves each used @keyframes once, and closes an animated colour over its inheritors', () => {
    const p = program(
      '.a { animation: k 2s linear infinite paused; border-top-color: currentcolor; } .a.on { animation-play-state: running; } .t { border-left-color: currentcolor; } @keyframes k { from { color: rgb(1, 2, 3) } 50% { width: 2em; animation-timing-function: ease-in } }',
      (r) => [div(r, 't', ['t'], [text(r, 'x', 'X')])],
    );
    expect(p.animations.map((a) => [a.node, a.lists.map((l) => l?.map((e) => [e.name, e.paused, e.duration, e.iterations]))])).toEqual([['a', [[['k', true, 2, Infinity]], [['k', false, 2, Infinity]]]]]);
    expect(p.keyframes).toEqual([{ name: 'k', blocks: [
      { offsets: [0], easing: null, values: [{ property: 'color', value: { kind: 'color', r: 1, g: 2, b: 3, alpha: 1 } }] },
      { offsets: [0.5], easing: expect.objectContaining({ text: 'ease-in' }), values: [{ property: 'width', value: { kind: 'length', px: 32, percent: 0, calc: false } }] },
    ] }]);
    // Every border colour computes to currentcolor here (its initial value), so each follows the animated colour.
    const sides = ['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];
    expect(p.closure).toEqual([{ source: { node: 'a', property: 'color' }, writes: [...sides.map((property) => ({ node: 'a', property })), { node: 't', property: 'color' }, ...sides.map((property) => ({ node: 't', property }))] }]);
  });
});

describe('web output (R15)', () => {
  const web = (css: string, child?: (r: SourceRef) => TreeNode[]): string => {
    const c = createProjectWith({ projectId: 'test', targets: { web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(stated(css, child));
    const out = c.outputs.web;
    if (out.kind !== 'ready') throw new Error('web output blocked');
    return (out.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
  };

  it('writes every animation longhand of an element that declares one, resolved per state, and each used @keyframes under its name', () => {
    const css = web('.a { transition: color 333.3ms steps(2, jump-start); } .a.on { animation: "a b" 1s 2; } @keyframes "a b" { 20% { width: 1em } } @keyframes unused { to { width: 1px } }');
    expect(css).toContain('  transition-property: color;\n  transition-duration: 0.3333s;\n  transition-timing-function: steps(2, jump-start);');
    expect(css).toContain('  animation-name: "a b";\n  animation-duration: 1s;');
    expect(css).toContain('@keyframes "a b" {\n  20% { width: 1em; }\n}');
    expect(css).not.toContain('unused');
  });

  it('keeps an inherited colour inherited under an element that declares an animation, so it follows each frame (R9)', () => {
    const css = web('.a { color: rgb(1, 2, 3); transition: color 1s; } .a.on { color: rgb(4, 5, 6); } .u { color: rgb(7, 8, 9); }', (r) => [div(r, 't', ['t']), div(r, 'u', ['u'])]);
    const colors = [...css.matchAll(/\.(dg\d+) \{[^}]*?\n  color: ([^;]+);/g)].map((m) => m[2]);
    // html and body, then a, t inheriting, u its own, b outside any source, and a with on.
    expect(colors).toEqual(['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(1, 2, 3)', 'inherit', 'rgb(7, 8, 9)', 'rgb(0, 0, 0)', 'rgb(4, 5, 6)']);
    expect(css).toContain('transition-property: color;');
  });

  it('leaves an element without animation declarations, and a document without @keyframes, as before', () => {
    const plain = web('.a { width: 1px; } .a.on { width: 2px; }');
    expect(plain).not.toMatch(/transition|animation|@keyframes/);
  });
});
