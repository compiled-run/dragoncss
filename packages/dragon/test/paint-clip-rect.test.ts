// MASK-CLIP clip: the longhand (auto or rect() with four length-or-auto edges, comma or whitespace separated, not inherited, initial
// auto, each length computed to px), the native refusals (an applied rect that is not empty at every size; an empty one beside a
// view outside the box view, on a box that is not visible, or over text one accessibility label cannot carry), the lowering (one
// write per absolutely positioned box whose rect is empty, the clip label when its subtree has text; none where clip does not
// apply) and the emitted native code (the writers, the readbacks and the plant).
import { describe, expect, it } from 'vitest';
import { emitNativeSupport } from 'dragon';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { ClipEdges } from '../src/css/properties/clip-rect.ts';
import { CLIP_RECT_LONGHANDS, clipsEverything } from '../src/css/properties/clip-rect.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { TOUCH_ACTION_LONGHANDS } from '../src/css/properties/touch-action.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { applyPlant } from '../src/emit/native-support.ts';
import { CLIP_EMITTER } from '../src/emit/paint/clip.ts';
import type { FrontEndResult, SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/clip.css', revision: 'r1', hash: 'sha256:0' };
const NATIVE: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 } };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .p { position: relative; width: 100px; height: 50px; } ';

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[] } {
  const css = `.a { clip: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics };
}

function compileInput(input: FrontEndResult, targets: Targets = { ios: { minimum: '15.0' }, web: {} }) {
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

// Text sits beside the clipped box, in its own block: text inside a hidden box is refused natively (accessibility, below).
const tree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'])]), div(r, 't', ['t'], [text(r, 't-t', 'XX')])])];
// The visually-hidden pattern: text in the clipped box (a-t), and text in a box inside it (b-t).
const textTree = (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])];
const input = (css: string) => inputFor(BASE + css, tree);
const compile = (css: string, targets?: Targets) => compileInput(input(css), targets);
const errors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const clipErrors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => errors(c).filter((d) => d.message.startsWith('a has clip: '));

function programs(css: string) {
  const p = nativePrograms(compileInput(input(css), NATIVE), []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return p.programs;
}

const HIDDEN = '.a { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); } ';

describe('clip: parse and computed values (Chrome 145 Clip::ParseSingleValue and getComputedStyle)', () => {
  it('follows touch-action, before clip-path', () => {
    expect([...CLIP_RECT_LONGHANDS]).toEqual(['clip']);
    expect(LONGHANDS[LONGHANDS.indexOf('clip') - 1]).toBe(TOUCH_ACTION_LONGHANDS[TOUCH_ACTION_LONGHANDS.length - 1]);
    expect(LONGHANDS[LONGHANDS.indexOf('clip') + 1]).toBe('clip-path');
  });

  it('computes auto, and each rect() edge to px with auto kept, as Chrome serializes it with commas', () => {
    // On web, which draws every rect (a rect that is not empty is refused on native only).
    const at = (css: string) => explainOne(compile(`.a { position: absolute; ${css} }`), 'web', 'a', 'clip').value;
    expect(at('')).toBe('auto');
    expect(at('clip: auto;')).toBe('auto');
    expect(at('clip: rect(0, 0, 0, 0);')).toBe('rect(0px, 0px, 0px, 0px)');
    expect(at('clip: rect(0 0 0 0);')).toBe('rect(0px, 0px, 0px, 0px)');
    expect(at('clip: RECT(1px,AUTO,0,-2px);')).toBe('rect(1px, auto, 0px, -2px)');
    expect(at('clip: rect(1em 2rem auto 0.5em);')).toBe('rect(10px, 32px, auto, 5px)');
    expect(at('clip: rect(1in, 0, 0, 0);')).toBe('rect(96px, 0px, 0px, 0px)');
  });
  it('is not inherited; inherit, initial and var() resolve as Chrome does', () => {
    expect(explainOne(compile('.a { position: absolute; clip: rect(0, 0, 0, 0); }'), 'ios', 'b', 'clip').value).toBe('auto');
    expect(explainOne(compile('.a { clip: rect(0, 0, 0, 0); } .b { clip: inherit; }'), 'ios', 'b', 'clip').value).toBe('rect(0px, 0px, 0px, 0px)');
    expect(explainOne(compile('.a { clip: rect(0, 0, 0, 0); clip: initial; }'), 'ios', 'a', 'clip').value).toBe('auto');
    expect(explainOne(compile('.a { --c: rect(1px 1px 1px 1px); clip: var(--c); }'), 'ios', 'a', 'clip').value).toBe('rect(1px, 1px, 1px, 1px)');
  });
  it('drops what Chrome drops: mixed separators, three or five edges, percentages, unitless non-zero numbers, other shapes', () => {
    for (const v of ['rect(1px, 2px 3px, 4px)', 'rect(1px 2px, 3px 4px)', 'rect(1px, 2px, 3px)', 'rect(0 0 0 0 0)', 'rect(1%, 0, 0, 0)', 'rect(1, 0, 0, 0)', 'inset(0)', 'none', 'rect()', '0']) {
      const { declaration, diagnostics } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });
  it('refuses a calculation and a viewport unit at the edge, on every target', () => {
    for (const [v, edge] of [['rect(calc(1px + 1px), 0, 0, 0)', 'calc(1px + 1px)'], ['rect(0 1vw 0 0)', '1vw']] as const) {
      const css = `.a { clip: ${v}; }`;
      const c = compile(css);
      const errs = errors(c).filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(errs.length, v).toBeGreaterThan(0);
      expect(spanTextOf(input(css), errs[0] as Diagnostic), v).toBe(edge);
      expectCatalogued(errs);
    }
  });
});

describe('clip: whether a rect clips everything at every box size (CSS2 §11.1.2)', () => {
  const px = (...e: (number | null)[]): ClipEdges => e.map((v) => (v === null ? null : { value: v, unit: 'px' })) as unknown as ClipEdges;
  it('is true when right is at or left of left (auto left is 0), or bottom at or above top', () => {
    expect(clipsEverything(px(0, 0, 0, 0))).toBe(true);
    expect(clipsEverything(px(1, 1, 1, 1))).toBe(true);
    expect(clipsEverything(px(null, 0, null, null))).toBe(true);
    expect(clipsEverything(px(null, -3, null, null))).toBe(true);
    expect(clipsEverything(px(5, null, 5, null))).toBe(true);
    expect(clipsEverything(px(0, 10, 10, 20))).toBe(true);
    expect(clipsEverything(px(5, 10, 4, 0))).toBe(true);
  });
  it('is false for a rect with room on both axes, and null where an auto right or bottom meets the box size', () => {
    expect(clipsEverything(px(0, 10, 10, 0))).toBe(false);
    expect(clipsEverything(px(-5, 1, 1, -5))).toBe(false);
    expect(clipsEverything(px(0, null, 10, 0))).toBe(null);
    expect(clipsEverything(px(null, null, null, null))).toBe(null);
    expect(clipsEverything(px(2, 10, null, 0))).toBe(null);
  });
  it('throws on an edge not computed to px', () => {
    expect(() => clipsEverything([{ value: 1, unit: 'em' }, null, null, null])).toThrow(/not computed to px/);
  });
});

describe('clip: native refusals', () => {
  it('compiles an empty rect on an absolutely positioned box everywhere, and any rect where clip does not apply', () => {
    expect(errors(compile(HIDDEN, NATIVE))).toEqual([]);
    expect(errors(compile('.a { position: absolute; clip: rect(0, auto, 0, auto); }', NATIVE))).toEqual([]);
    expect(errors(compile('.a { position: absolute; clip: rect(1px 1px 1px 1px); }', NATIVE))).toEqual([]);
    for (const pos of ['static', 'relative']) expect(errors(compile(`.a { position: ${pos}; clip: rect(0, 10px, 10px, 0); }`, NATIVE)), pos).toEqual([]);
  });
  it('refuses at its declaration, on native only, a rect that is not empty at every size', () => {
    for (const v of ['rect(0, 10px, 10px, 0)', 'rect(2px, auto, auto, 0)', 'rect(auto, auto, auto, auto)']) {
      const css = `.a { position: absolute; clip: ${v}; }`;
      const c = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
      const errs = clipErrors(c);
      expect(errs.map((d) => [d.code, d.target]).sort(), v).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs.find((d) => d.target === 'ios')?.message, v).toMatch(/^a has clip: rect\(.*\), which clips it to a rect that is not empty at every size; ios draws only a clip that hides the whole box/);
      expect(spanTextOf(input(css), errs[0] as Diagnostic), v).toBe(v);
      expectCatalogued(errs);
    }
  });
  it('refuses an em or rem edge whose font size has no build-time value, saying so (not that the rect is not empty)', () => {
    const errs = clipErrors(compile('.a { position: absolute; font-size: 1vw; clip: rect(0, 0em, 0, 0); }', NATIVE));
    expect(errs.map((d) => d.target).sort()).toEqual(['android', 'ios']);
    expect(errs.find((d) => d.target === 'ios')?.message).toBe('a has clip: rect(0px, 0em, 0px, 0px), whose em edge has no build-time font size to compute it against; ios needs every clip edge in px at build time');
    expectCatalogued(errs);
  });
  it('refuses an empty rect beside a view outside the box view, or on a box that is not visible, and names it', () => {
    const cases: readonly [string, RegExp][] = [
      ['.a { box-shadow: 0 0 0 2px red; }', /it has a box-shadow, drawn by a companion view beside the box view/],
      ['.a { outline: 1px solid red; }', /it has an outline, drawn in the root view/],
      ['.b { outline: 1px solid red; }', /b has an outline, drawn in the root view/],
      ['.b { position: relative; z-index: 1; }', /b has z-index 1, and its layer may be hosted under a stacking context outside the box view/],
      ['.a { visibility: hidden; }', /it is hidden too, and the visibility readback reads the same hidden flag/],
    ];
    for (const [css, why] of cases) {
      const errs = clipErrors(compile(HIDDEN + css));
      expect(errs.map((d) => [d.code, d.target]), css).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, css).toMatch(why);
      expectCatalogued(errs);
    }
    // A z-index 0 or one that does not apply (a static box outside a flex or grid container) keeps the layer inside the box view.
    for (const css of ['.b { position: relative; z-index: 0; }', '.b { z-index: 3; }', '.b { outline: 0px solid red; }', '.b { outline-style: none; }']) expect(clipErrors(compile(HIDDEN + css)), css).toEqual([]);
  });
  it('carries the text of an empty rect as one accessibility label, which Chrome keeps in its accessibility tree', () => {
    // Chrome paints nothing of the box and keeps its text in the accessibility tree; natively the box view draws nothing and is one
    // accessibility element whose label is the text (the clip label write, below), so the visually-hidden pattern compiles.
    const both = (css: string, body = textTree) => clipErrors(compileInput(inputFor(BASE + css, body), { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }));
    expect(both(HIDDEN)).toEqual([]);
    // The coverage probe's shape: an auto-sized absolutely positioned box over two blocks of text, and no overflow clip.
    expect(both('.a { position: absolute; clip: rect(0, 0, 0, 0); }', (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'c1', [], [text(r, 'c1-t', 'Hi')]), div(r, 'c2', [], [text(r, 'c2-t', 'Hi')])])])])).toEqual([]);
    // Inline emphasis, a paragraph and a generated ::before run together in the label.
    expect(both(`${HIDDEN} .b::before { content: "Z"; }`, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [{ ...div(r, 'b', ['b'], [text(r, 'b-t', 'YY')]), tag: 'p' }, { ...div(r, 's', [], [text(r, 's-t', 'QQ')]), tag: 'strong' }])])])).toEqual([]);
    // Tags that read as their text, an anchor without href among them (u, code, abbr and sup are allowed too, but Dragon does not
    // support those elements yet).
    const all = (css: string, body: (r: SourceRef) => TreeNode[]) => errors(compileInput(inputFor(BASE + css, body), { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }));
    for (const tag of ['label', 'a', 'span', 'b']) expect(all(HIDDEN, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), { ...div(r, 'b', ['b'], [text(r, 'b-t', 'YY')]), tag }])])]), tag).toEqual([]);
    // Text under visibility: hidden is not in Chrome's accessibility tree either: it is left out of the label, not refused.
    expect(all(`${HIDDEN} .b { visibility: hidden; }`, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])])).toEqual([]);
    // Text under display: none is in no accessibility tree, so a focusable box there does not matter.
    expect(both(`${HIDDEN} .b { display: none; }`, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), { ...div(r, 'b', ['b'], [text(r, 'b-t', 'YY')]), tag: 'button' }])])])).toEqual([]);
  });
  it('refuses, on native only, text one accessibility label of the box cannot carry, and names why', () => {
    const attr = (name: string, value: string) => ({ name, value: [{ when: { kind: 'true' as const }, value }], origin: { kind: 'unlocated' as const, reason: 'test' } });
    // b is the element the case changes: a tag, an attribute or a style.
    const inner = (change: (b: ReturnType<typeof div>) => ReturnType<typeof div>) => (r: SourceRef): TreeNode[] => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), change(div(r, 'b', ['b'], [text(r, 'b-t', 'YY')]))])])];
    const same = (b: ReturnType<typeof div>) => b;
    const cases: readonly [string, (r: SourceRef) => TreeNode[], RegExp][] = [
      ['', inner((b) => ({ ...b, tag: 'a', attributes: [attr('href', '#x')] })), /but b is focusable, and a label cannot take focus or act as <a> does;/],
      ['', inner((b) => ({ ...b, tag: 'h2' })), /but b is <h2>, whose role or content Chrome exposes beyond its text;/],
      ['', inner((b) => ({ ...b, attributes: [attr('aria-hidden', 'true')] })), /but b has the aria-hidden attribute, which changes what Chrome exposes beyond its text;/],
      ['', inner((b) => ({ ...b, attributes: [attr('role', 'heading')] })), /but b has the role attribute/],
      ['', inner((b) => ({ ...b, attributes: [attr('title', 'T')] })), /but b has the title attribute/],
      ['.b { position: fixed; }', inner(same), /but b is fixed, and its view may be hosted outside the box view;/],
      ['.b { position: absolute; clip: rect(0, 0, 0, 0); }', inner(same), /but b is hidden by its own clip too, and nested labels are not proven;/],
      ['.a { height: 0; }', inner(same), /but it has height 0px, and a view with no area is not visible to the user \(View\.isVisibleToUser\), so TalkBack would skip its label;/],
      ['.a { max-width: 0%; }', inner(same), /but it has max-width 0%/],
    ];
    for (const [css, body, why] of cases) {
      const errs = clipErrors(compileInput(inputFor(BASE + HIDDEN + css, body), { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} }));
      expect(errs.map((d) => [d.code, d.target]).sort(), `${css} ${why}`).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'android'], ['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      for (const d of errs) expect(d.message, `${css} ${why}`).toMatch(why);
      expect(errs.find((d) => d.target === 'ios')?.message, css).toMatch(/^a has clip: rect\(0px, 0px, 0px, 0px\), which hides it whole, and its text a:text0 stays in Chrome's accessibility tree, but .*; ios carries the text only as the accessibilityLabel of the box view, which VoiceOver reads as one element$/);
      expect(errs.find((d) => d.target === 'android')?.message, css).toMatch(/; android carries the text only as the contentDescription of the box view, which TalkBack reads as one node$/);
      expectCatalogued(errs);
    }
    // The box's own tag counts too; a box without text loses nothing, whatever it is.
    const own = clipErrors(compileInput(inputFor(BASE + HIDDEN, (r) => [div(r, 'p', ['p'], [{ ...div(r, 'a', ['a'], [text(r, 'a-t', 'XX')]), tag: 'h2' }])]), NATIVE));
    expect(own.map((d) => d.target).sort()).toEqual(['android', 'ios']);
    for (const d of own) expect(d.message).toContain('but it is <h2>, whose role');
    expect(clipErrors(compileInput(inputFor(BASE + HIDDEN, (r) => [div(r, 'p', ['p'], [{ ...div(r, 'a', ['a']), tag: 'h2' }])]), NATIVE))).toEqual([]);
  });
});

describe('clip: the label of a box its empty rect hides (lower/paint/clip-label.ts)', () => {
  const lowered = (css: string, body: (r: SourceRef) => TreeNode[]) => {
    const p = nativePrograms(compileInput(inputFor(BASE + css, body), NATIVE), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };
  it('runs the leaves of one inline formatting context together and joins blocks with a space, on both backends alike', () => {
    const p = lowered(HIDDEN, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'c1', [], [text(r, 'c1-t', '  Hello  ')]), div(r, 'c2', [], [text(r, 'c2-t', 'wor'), { ...div(r, 's', [], [text(r, 's-t', 'ld')]), tag: 'span' }, text(r, 'c2-u', ' !')])])])]);
    for (const prog of [p.uikit, p['android-views']]) {
      const writes = prog.nodes.find((n) => n.id === 'a')?.writes.filter((w) => w.kind.startsWith('clip-rect')) ?? [];
      expect(writes).toEqual([expect.objectContaining({ kind: 'clip-rect-label', label: 'Hello world !', css: ['clip'] })]);
    }
    expect(p.uikit.nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-rect-label')).toEqual(expect.objectContaining({ key: 'dragonClipRect.label', technique: 'native-property' }));
    expect(p['android-views'].nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-rect-label')).toEqual(expect.objectContaining({ key: 'dragonClipRect.label' }));
  });
  it('runs an inline-block in with the inline text around it, in tree order and with no separator of its own', () => {
    const ib = (r: SourceRef, id: string, value: string) => ({ ...div(r, id, ['ib'], [text(r, `${id}-t`, value)]), tag: 'span' });
    const label = (body: (r: SourceRef) => TreeNode[]) => lowered(`${HIDDEN} .ib { display: inline-block; }`, body).uikit.nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-rect-label');
    expect(label((r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'Hello '), ib(r, 's', 'world')])])])).toEqual(expect.objectContaining({ label: 'Hello world' }));
    expect(label((r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'X'), ib(r, 's', 'Y'), text(r, 'a-u', 'Z')])])])).toEqual(expect.objectContaining({ label: 'XYZ' }));
  });
  it('leaves out text under visibility: hidden, and keeps the hidden write when that is all the text', () => {
    const kinds = (css: string) => lowered(`${HIDDEN} ${css}`, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'YY'), div(r, 'c', ['c'], [text(r, 'c-t', 'ZZ')])])])])]).uikit.nodes.find((n) => n.id === 'a')?.writes.filter((w) => w.kind.startsWith('clip-rect'));
    expect(kinds('.b { visibility: hidden; }')).toEqual([expect.objectContaining({ kind: 'clip-rect-empty' })]);
    // A visible element under a hidden one is exposed again (visibility inherits, and Chrome reads the element's own value).
    expect(kinds('.b { visibility: hidden; } .c { visibility: visible; }')).toEqual([expect.objectContaining({ kind: 'clip-rect-label', label: 'ZZ' })]);
    expect(clipErrors(compileInput(inputFor(`${BASE + HIDDEN} .b { visibility: hidden; }`, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])])]), NATIVE))).toEqual([]);
  });
  it('reads a <br> as a space and leaves the descendants unwritten; a box without text keeps the hidden write', () => {
    const p = lowered(HIDDEN, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'], [text(r, 'a-t', 'AB'), { ...div(r, 'br', []), tag: 'br' }, text(r, 'a-u', 'CD')])])]);
    expect(p.uikit.nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-rect-label')).toEqual(expect.objectContaining({ label: 'AB CD' }));
    expect(p.uikit.nodes.filter((n) => n.writes.some((w) => w.kind.startsWith('clip-rect'))).map((n) => n.id)).toEqual(['a']);
    expect(programs(HIDDEN).uikit.nodes.find((n) => n.id === 'a')?.writes.map((w) => w.kind).filter((k) => k.startsWith('clip-rect'))).toEqual(['clip-rect-empty']);
  });
});

describe('clip: hit testing (R13; the hit lane refuses the clip fixtures by name, hit-capture.ts hitRefusal)', () => {
  it('refuses an interaction rule on native beside a clipped box, not on web', () => {
    const lanes = createProjectWith({ projectId: 'test', targets: { web: {}, ios: { minimum: '15.0' } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', interactionLanes: true });
    const found = errors(lanes.compile(input(`${HIDDEN} .p:hover { background-color: #0c0; }`))).map((d) => `${d.code} [${d.target}] ${d.message}`);
    expect(found).toEqual(['DRAGON_UNSUPPORTED_SELECTOR [ios] :hover needs Dragon hit testing through clip on a, which is not built yet (package SELD-R2b)']);
  });
});

describe('clip: lowering', () => {
  it('writes an absolutely positioned box whose rect is empty, after its overflow clip; its descendants and other boxes get none', () => {
    const p = programs(HIDDEN);
    for (const prog of [p.uikit, p['android-views']]) {
      const kinds = (id: string) => prog.nodes.find((n) => n.id === id)?.writes.map((w) => w.kind).filter((k) => k === 'padding-box-clip' || k === 'clip-rect-empty');
      expect(kinds('a')).toEqual(['padding-box-clip', 'clip-rect-empty']);
      expect(kinds('b')).toEqual([]);
      expect(kinds('p')).toEqual([]);
      expect(prog.nodes.find((n) => n.id === 'a')?.writes.find((w) => w.kind === 'clip-rect-empty')).toEqual(expect.objectContaining({ key: 'dragonClipRect.hidden', technique: 'native-property', css: ['clip'] }));
    }
  });
  it('writes nothing where clip does not apply, and never moves layout', () => {
    for (const pos of ['static', 'relative']) {
      const p = programs(`.a { position: ${pos}; clip: rect(0, 0, 0, 0); }`);
      expect(p.uikit.nodes.some((n) => n.writes.some((w) => w.kind === 'clip-rect-empty')), pos).toBe(false);
    }
    const css = '.a { position: absolute; left: 3px; top: 4px; width: 7px; height: 5px; } ';
    expect(programs(`${css}.a { clip: rect(0 0 0 0); }`).uikit.root).toEqual(programs(css).uikit.root);
  });
});

describe('clip: emission', () => {
  const w = { kind: 'clip-rect-empty' } as never;
  it('emits the clip label writer with the label as an escaped string literal, and expects the label read back', () => {
    const label = { kind: 'clip-rect-label', label: 'Say "hi" $x \\ é' } as never;
    expect(CLIP_EMITTER.lines.uikit('v0', {} as never, label)).toEqual(['  dragonClipRectLabel(v0, "Say \\"hi\\" $x \\\\ \\u{e9}")']);
    expect(CLIP_EMITTER.lines['android-views']('v1', {} as never, label)).toEqual(['  dragonClipRectLabel(v1, "Say \\"hi\\" \\$x \\\\ \\u00e9")']);
    for (const backend of ['uikit', 'android-views'] as const) expect(CLIP_EMITTER.applied({} as never, backend, label, 2, {} as never)).toBe('Say "hi" $x \\ é');
    expect(() => CLIP_EMITTER.applied({} as never, 'uikit', { kind: 'clip-rect-label', label: '' } as never, 2, {} as never)).toThrow(/is not a non-empty string/);
    expect(() => CLIP_EMITTER.lines.uikit('v0', {} as never, { kind: 'clip-rect-label', label: '' } as never)).toThrow(/is not a non-empty string/);
  });
  it('emits the one runtime writer on both backends and expects the box view hidden', () => {
    expect(CLIP_EMITTER.lines.uikit('v0', {} as never, w)).toEqual(['  dragonClipRectEmpty(v0)']);
    expect(CLIP_EMITTER.lines['android-views']('v1', {} as never, w)).toEqual(['  dragonClipRectEmpty(v1)']);
    expect(CLIP_EMITTER.applied({} as never, 'uikit', w, 2, {} as never)).toBe(1);
    expect(CLIP_EMITTER.lines.uikit('v0', {} as never, { kind: 'padding-box-clip' } as never)).toEqual(['  v0.dragonEnableClip()']);
  });
  for (const backend of ['uikit', 'android-views'] as const) {
    const files = emitNativeSupport(backend);
    const ios = backend === 'uikit';
    const clip = files.find((f) => f.path.endsWith(ios ? 'DragonPaintClip.swift' : 'DragonPaintClip.kt'))?.text ?? '';
    it(`${backend}: hides the box view itself and reads back whether it is hidden`, () => {
      expect(clip).toContain(ios ? '  v.isHidden = true\n' : '  v.visibility = View.INVISIBLE\n');
      expect(clip).toContain(ios ? 'if v.dragonClipRectEmpty { out.append(("dragonClipRect.hidden", .number(v.isHidden ? 1 : 0))) }' : 'if (v.dragonClipRectEmpty) out.add(Pair("dragonClipRect.hidden", DumpJson.Num(if (v.visibility == View.INVISIBLE) 1.0 else 0.0)))');
    });
    it(`${backend}: the clip label draws nothing, is one accessibility element and reads back the label only while it is exposed`, () => {
      if (ios) {
        for (const line of ['  m.frame = .zero\n  v.layer.mask = m\n', '  v.isAccessibilityElement = true\n', '  v.accessibilityLabel = label\n', '  v.isUserInteractionEnabled = false\n']) expect(clip).toContain(line);
        expect(clip).toContain('if x.isHidden || x.alpha < 0.01 || x.accessibilityElementsHidden || (x !== v && x.isAccessibilityElement) { return false }');
        expect(clip).toContain('if let l = v.dragonClipRectLabel { out.append(("dragonClipRect.label", dragonClipRectExposed(v, l) ? .string(l) : .null)) }');
      } else {
        for (const line of ['  v.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES\n', '  v.isScreenReaderFocusable = true\n', '  v.contentDescription = label\n']) expect(clip).toContain(line);
        expect(clip).toContain('return info.isVisibleToUser && info.contentDescription?.toString() == label && info.childCount == 0');
        expect(clip).toContain('if (l != null) out.add(Pair("dragonClipRect.label", if (dragonClipRectExposed(v, l)) DumpJson.Str(l) else DumpJson.Null))');
        // The box members: no draw of the box or its children, and no accessibility children.
        const box = files.map((f) => f.text).join('\n');
        expect(box).toContain('  override fun draw(canvas: Canvas) {\n    if (dragonClipRectLabel != null) return\n');
        expect(box).toContain('  override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {\n    if (dragonClipRectLabel != null) return\n');
        expect(box).toContain('  override fun onInterceptHoverEvent(event: android.view.MotionEvent): Boolean = dragonClipRectLabel != null || super.onInterceptHoverEvent(event)\n');
      }
      // The plant ignores the label writer too: nothing is masked or labelled.
      expect(clip).toContain(ios ? 'public func dragonClipRectLabel(_ v: DragonBoxView, _ label: String) {\n  if dragonClipRectPlantIgnored { return }\n' : 'fun dragonClipRectLabel(v: DragonBoxView, label: String) {\n  if (DRAGON_CLIP_RECT_PLANT_IGNORED) return\n');
    });
    it(`${backend}: the clip-rect-ignored plant turns the writer into a no-op`, () => {
      const plant = CLIP_EMITTER.plants.find((p) => p.name === 'clip-rect-ignored');
      if (plant === undefined) throw new Error('no clip-rect-ignored plant');
      const [from, to] = plant.replace[backend];
      const planted = applyPlant(files, from, to, plant.name).map((f) => f.text).join('\n');
      expect(planted).toContain(ios ? 'public let dragonClipRectPlantIgnored = true' : 'const val DRAGON_CLIP_RECT_PLANT_IGNORED = true');
      expect(clip).toContain(ios ? 'if dragonClipRectPlantIgnored { return }' : 'if (DRAGON_CLIP_RECT_PLANT_IGNORED) return');
    });
  }
});
