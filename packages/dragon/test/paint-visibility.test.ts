// T150a visibility (notes/T150-visibility-spec.md): the longhand (inherited, initial visible, computed as specified), the native
// refusals (an inline box whose visibility differs from its block container's; a hidden body with its own background beside html's;
// a visibility write in a state program), the lowering (one write per box that is not visible, with facts; none for a visible or
// anonymous box) and the emitted native code (the stage gate, the text-leaf hook, the companion and outline hidden flags, the
// background and shadow backdrop that skip a hidden box, the readback and the two plants).
import { describe, expect, it } from 'vitest';
import type { StateEmit } from 'dragon';
import { deriveStateProgram, emitNativeSupport, emitStatePrograms } from 'dragon';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { applyPlant } from '../src/emit/native-support.ts';
import { VISIBILITY_EMITTER } from '../src/emit/paint/visibility.ts';
import type { ElementNode, FrontEndResult, SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/visibility.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[] } {
  const css = `.a { visibility: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics };
}

const span = (ref: SourceRef, id: string, classes: string[], children: TreeNode[] = []): ElementNode => ({ ...div(ref, id, classes, children), tag: 'span' });

function compileInput(input: FrontEndResult, targets: Targets = { ios: { minimum: '15.0' }, web: {} }) {
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

const compile = (css: string, targets?: Targets) => compileInput(inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'XX')])])]), targets);

const errors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');

function programs(input: FrontEndResult) {
  const p = nativePrograms(compileInput(input, NATIVE), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

describe('visibility: parse and computed values (Chrome 145 getComputedStyle, M1)', () => {
  it('computes each keyword as specified; collapse stays collapse', () => {
    for (const k of ['visible', 'hidden', 'collapse']) expect(explainOne(compile(`.a { height: 10px; visibility: ${k}; }`), 'ios', 'a', 'visibility').value, k).toBe(k);
  });
  it('is inherited with initial visible; a child may set visible again; inherit, initial, unset and var() resolve as Chrome does', () => {
    expect(explainOne(compile('.a { height: 10px; }'), 'ios', 'a', 'visibility').value).toBe('visible');
    expect(explainOne(compile('.a { visibility: hidden; }'), 'ios', 'b', 'visibility').value).toBe('hidden');
    expect(explainOne(compile('.a { visibility: collapse; } .b { visibility: visible; }'), 'ios', 'b', 'visibility').value).toBe('visible');
    expect(explainOne(compile('.a { visibility: hidden; } .b { visibility: initial; }'), 'ios', 'b', 'visibility').value).toBe('visible');
    expect(explainOne(compile('.a { visibility: hidden; } .b { visibility: unset; }'), 'ios', 'b', 'visibility').value).toBe('hidden');
    expect(explainOne(compile('.a { visibility: collapse; } .b { visibility: visible; visibility: inherit; }'), 'ios', 'b', 'visibility').value).toBe('collapse');
    expect(explainOne(compile('.a { --v: hidden; visibility: var(--v); }'), 'ios', 'a', 'visibility').value).toBe('hidden');
  });
  it('anything but the three keywords is invalid', () => {
    for (const v of ['none', 'auto', '1px', 'hidden visible', 'show', 'force-hidden']) {
      const { declaration, diagnostics } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });
  it('never moves layout: a hidden and a collapsed box keep the frames of the visible one', () => {
    const frames = (css: string) => programs(inputFor(`body { margin: 0; } .a { display: flex; } .b { width: 30px; height: 10px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'x', ['b']), div(r, 'y', ['b', 'y']), div(r, 'z', ['b'])])])).uikit.root;
    const base = frames('');
    expect(frames('.y { visibility: hidden; }')).toEqual(base);
    expect(frames('.y { visibility: collapse; }')).toEqual(base);
  });
});

describe('visibility: native refusals', () => {
  const inline = (css: string) => compileInput(inputFor(`body { margin: 0; } .s { display: inline; } ${css}`, (r) => [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), span(r, 's', ['s'], [text(r, 's-t', 'YY')])])]));
  it('refuses an inline box whose visibility differs from its block container, at its declaration, on ios only', () => {
    for (const css of ['.s { visibility: hidden; }', '.a { visibility: hidden; } .s { visibility: visible; }']) {
      const c = inline(css);
      const errs = errors(c).filter((d) => d.message.includes('the inline box'));
      expect(errs.map((d) => [d.code, d.target]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, css).toMatch(/^the inline box s has visibility (hidden|visible) and its block container a does not paint alike; ios draws/);
      expectCatalogued(errs);
    }
    const located = inline('.s { visibility: collapse; }');
    const input = inputFor('body { margin: 0; } .s { display: inline; } .s { visibility: collapse; }', () => []);
    expect(spanTextOf(input, errors(located).find((d) => d.message.includes('the inline box')) as Diagnostic)).toBe('collapse');
  });
  it('accepts an inline box that paints like its container: hidden beside collapse, or both visible', () => {
    for (const css of ['', '.a { visibility: hidden; } .s { visibility: collapse; }', '.a { visibility: collapse; }']) {
      expect(errors(inline(css)).filter((d) => d.message.includes('the inline box')), css).toEqual([]);
    }
  });
  it('refuses a hidden body with its own background when html has one too; either background alone compiles', () => {
    const root = (css: string) => compileInput(inputFor(`body { margin: 0; } ${css}`, (r) => [div(r, 'a', ['a'])]));
    const c = root('html { background-color: red; } body { visibility: hidden; background-color: blue; }');
    const errs = errors(c);
    expect(errs.map((d) => [d.code, d.target])).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
    expect(errs[0]?.message).toMatch(/^body has visibility hidden and a background of its own \(html has one too\)/);
    expectCatalogued(errs);
    expect(errors(root('body { visibility: hidden; background-color: blue; }'))).toEqual([]);
    expect(errors(root('html { background-color: red; visibility: hidden; }'))).toEqual([]);
    expect(errors(root('html { background-color: red; } body { visibility: collapse; }'))).toEqual([]);
  });
});

describe('visibility: lowering', () => {
  const tree = (r: SourceRef): TreeNode[] => [div(r, 'h', ['h'], [text(r, 'h-t', 'XX'), div(r, 'v', ['v'], [text(r, 'v-t', 'YY')]), div(r, 'c', ['c'])])];
  it('writes each box that is not visible once, with its keyword and facts; a visible box, an anonymous box and a text node get none', () => {
    const p = programs(inputFor('body { margin: 0; font-family: Ahem; font-size: 10px; } .h { visibility: hidden; } .v { visibility: visible; } .c { visibility: collapse; height: 4px; }', tree));
    for (const prog of [p.uikit, p['android-views']]) {
      const writes = (id: string) => prog.nodes.find((n) => n.id === id)?.writes.filter((w) => w.kind === 'visibility');
      expect(writes('h')).toEqual([expect.objectContaining({ kind: 'visibility', value: 'hidden', canvas: false, key: 'visibility', technique: 'dragon-owned-paint', css: ['visibility'] })]);
      expect(writes('c')).toEqual([expect.objectContaining({ value: 'collapse', canvas: false })]);
      expect(writes('v')).toEqual([]);
      expect(prog.nodes.find((n) => n.id === 'h')?.facts['visibility']).toEqual({ visible: false, value: 'hidden' });
      expect(prog.nodes.find((n) => n.id === 'v')?.facts['visibility']).toBeUndefined();
      // The hidden box's text run sits in an anonymous box, which has no write; the device hides it through h (DragonTree.textNode).
      const anon = prog.nodes.find((n) => n.kind === 'anonymous' && n.parent === 'h');
      expect(anon?.writes.some((w) => w.kind === 'visibility')).toBe(false);
      expect(prog.nodes.filter((n) => n.kind === 'text').every((n) => n.writes.every((w) => w.kind !== 'visibility'))).toBe(true);
      // The visibility write comes last on a box, after the shadow and outline writes that make the views it hides.
      expect(prog.nodes.find((n) => n.id === 'h')?.writes.at(-1)?.kind).toBe('visibility');
    }
  });
  it('marks the background of html and body as the canvas\'s', () => {
    const p = programs(inputFor('html { visibility: hidden; } body { margin: 0; }', (r) => [div(r, 'a', ['a'])]));
    const canvas = (id: string) => (p.uikit.nodes.find((n) => n.id === id)?.writes.find((w) => w.kind === 'visibility') as { canvas: boolean } | undefined)?.canvas;
    expect(canvas('html')).toBe(true);
    expect(canvas('body')).toBe(true);
    expect(canvas('a')).toBe(false);
  });
});

describe('visibility: emission', () => {
  const w = { kind: 'visibility', value: 'hidden', canvas: false } as never;
  it('emits the one runtime writer with the keyword and the canvas flag on both backends', () => {
    expect(VISIBILITY_EMITTER.lines.uikit('v0', {} as never, w)).toEqual(['  dragonVisibility(v0, "hidden", false)']);
    expect(VISIBILITY_EMITTER.lines['android-views']('v1', {} as never, { kind: 'visibility', value: 'collapse', canvas: true } as never)).toEqual(['  dragonVisibility(v1, "collapse", true)']);
    expect(() => VISIBILITY_EMITTER.lines.uikit('v0', {} as never, { kind: 'visibility', value: 'Hidden"', canvas: false } as never)).toThrow(/is not a CSS keyword/);
  });
  it('expects the keyword, the gate shut, the box view shown and no native paint of the box left showing', () => {
    expect(VISIBILITY_EMITTER.applied({} as never, 'uikit', w, 2, {} as never)).toEqual(['hidden', 1, 0, 0]);
  });
  for (const backend of ['uikit', 'android-views'] as const) {
    const files = emitNativeSupport(backend);
    const all = files.map((f) => f.text).join('\n');
    const ios = backend === 'uikit';
    it(`${backend}: gates every paint stage first in dragonPaintBox`, () => {
      const stages = files.find((f) => f.path.endsWith(ios ? 'DragonPaintStages.swift' : 'DragonPaintStages.kt'))?.text ?? '';
      const body = stages.slice(stages.indexOf(ios ? 'public func dragonPaintBox(' : 'fun dragonPaintBox('));
      const lines = body.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('//'));
      expect(lines[1]?.trim()).toBe(ios ? 'if !v.dragonVisible { return }' : 'if (!v.dragonVisible) return');
    });
    it(`${backend}: hides a text view with its element (through an anonymous box) and never hides a box view`, () => {
      expect(all).toContain(ios ? 'if let o = owner, o.dragonKind == "anonymous" { owner = o.dragonParent.flatMap { views[$0] as? DragonBoxView } }' : 'if (owner != null && owner.dragonKind == "anonymous") owner = owner.dragonParent?.let { views[it] as? DragonBoxView }');
      expect(all).toContain(ios ? 'v.isHidden = !o.dragonVisible' : 'v.visibility = if (owner.dragonVisible) android.view.View.VISIBLE else android.view.View.INVISIBLE');
      // A text view without a built box to follow fails the build instead of showing its runs.
      expect(all).toContain(ios ? 'guard let o = owner else { fatalError("dragon: text \\(id) has no built box' : 'if (owner == null) throw IllegalStateException("dragon: text " + id + " has no built box "');
      // The writer hides the box view itself only in the subtree plant build.
      expect(all).toContain(ios ? 'if dragonVisibilityPlantSubtree { v.isHidden = !visible }' : 'if (DRAGON_VISIBILITY_PLANT_SUBTREE) v.visibility = if (visible) View.VISIBLE else View.INVISIBLE');
    });
    it(`${backend}: hides the shadow companion and the outline view where they are made, and skips a hidden box's background in a shadow backdrop`, () => {
      const file = (stem: string): string => files.find((f) => f.path.endsWith(`${stem}.${ios ? 'swift' : 'kt'}`))?.text ?? '';
      expect(file('DragonPaintShadow').match(/dragonVisibilityCompanion\(s, v\)/g)?.length).toBe(1);
      expect(file('DragonPaintOutline').match(/dragonVisibilityCompanion\(o, v\)/g)?.length).toBe(1);
      expect(all).toContain(ios ? 'if c.a == 0 || !(b.dragonVisible || b.dragonVisibilityCanvas) { continue }' : 'if (c.a == 0 || !(b.dragonVisible || b.dragonVisibilityCanvas)) continue');
      expect(all).toContain(ios ? 'if v.dragonVisible ? dragonRoundedPath(v, v.dragonShape, inner: false) == nil : v.dragonVisibilityCanvas {' : 'v.background = if (if (v.dragonVisible) dragonRoundedPath(v, v.dragonShape, false) == null else v.dragonVisibilityCanvas)');
    });
    it(`${backend}: each plant replaces exactly one line`, () => {
      for (const plant of VISIBILITY_EMITTER.plants) {
        const [from, to] = plant.replace[backend];
        const planted = applyPlant(files, from, to, plant.name);
        expect(planted.map((f) => f.text).join('\n')).toContain(to);
      }
    });
  }
});

describe('visibility: state programs (T150b lifts this)', () => {
  it('refuses a visibility write in a state program by name', () => {
    const p = programs(inputFor('body { margin: 0; } .a { height: 10px; visibility: hidden; }', (r) => [div(r, 'a', ['a'])]));
    const sp = deriveStateProgram('uikit', [{ assignment: [], isInitial: true, program: p.uikit }]);
    const emit: StateEmit = { id: 'v', fixture: 'v', direction: 'ltr', compilerDigest: 'sha256:0', viewport: { width: 400, height: 300 }, program: sp, scripts: [] };
    expect(() => emitStatePrograms('uikit', [emit])).toThrow('a: visibility hidden in a state program has no state-node write (T150b adds it)');
  });
});
