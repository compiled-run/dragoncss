// PNT1 opacity (css-color-4 §14.1): parsing with Chrome 145's rules, the computed value (a percentage to its number, clamped to
// [0, 1]), the refusals (a percentage calculation, a math function Dragon does not evaluate), the lowering to one write with facts,
// the emitted writer lines and the expected applied alpha (Chrome's paint alpha byte / 255 as a float32).
import { describe, expect, it } from 'vitest';
import { opacityAlpha8 } from '@dragon/layout';
import type { Diagnostic, DraftTree } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { EFFECTS_EMITTER } from '../src/emit/paint/effects.ts';
import { BACKGROUND_EMITTER } from '../src/emit/paint/background.ts';
import { nodeLit, StateEmitError } from '../src/emit/runtime/state.ts';
import { opacityAlpha8 as foldAlpha8 } from '../src/css/color.ts';
import type { Targets } from '../src/types.ts';
import { div, DOC, eq, expectCatalogued, explainOne, inputFor, not, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/opacity.css', revision: 'r1', hash: 'sha256:0' };

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { opacity: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

const spanOf = (css: string, d: Diagnostic): string => (d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : '<unlocated>');

function compile(css: string, targets: Targets = { web: {} }) {
  const input = inputFor(`body { margin: 0; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

describe('opacity: parse and computed values (Chrome 145 getComputedStyle)', () => {
  // [value, Chrome 145's computed string] (probed with the pinned Chrome; Dragon keeps the double, Chrome prints 6 digits)
  const cases: [string, string][] = [
    ['0.5', '0.5'], ['50%', '0.5'], ['1.5', '1'], ['-1', '0'], ['0', '0'], ['1', '1'], ['150%', '1'], ['-5%', '0'], ['calc(0.5)', '0.5'],
    ['0.001', '0.001'], ['calc(0.2 * 2)', '0.4'], ['min(0.3, 0.6)', '0.3'],
  ];
  for (const [value, want] of cases) {
    it(`opacity: ${value} computes to ${want}`, () => {
      const c = compile(`.a { height: 10px; opacity: ${value}; }`);
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(explainOne(c, 'web', 'a', 'opacity').value).toBe(want);
    });
  }
  it('opacity is not inherited; inherit takes the parent computed value and initial is 1', () => {
    const c = compile('.a { opacity: 25%; } .b { height: 5px; }');
    expect(explainOne(c, 'web', 'b', 'opacity').value).toBe('1');
    const d = compile('.a { opacity: 25%; } .b { height: 5px; opacity: inherit; }');
    expect(explainOne(d, 'web', 'b', 'opacity').value).toBe('0.25');
    const e = compile('.a { height: 5px; opacity: 0.3; opacity: initial; }');
    expect(explainOne(e, 'web', 'a', 'opacity').value).toBe('1');
  });
  it('a length, a keyword, two numbers and a colour are invalid, as in Chrome', () => {
    for (const v of ['1px', 'auto', '0.5 0.5', 'red', 'none']) {
      const { declaration, diagnostics } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });
  it('a calculation that is a percentage is DRAGON_UNSUPPORTED_VALUE on the token', () => {
    const { declaration, diagnostics, css } = declare('calc(50% + 10%)');
    expect(declaration).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe('calc(50% + 10%)');
    expect(diagnostics[0]?.message).toBe('opacity: calc(50% + 10%) is unsupported: a percentage inside a calculation is not supported');
    expectCatalogued(diagnostics);
  });
  it('a math function Chrome accepts and Dragon does not evaluate is refused on the token, never dropped', () => {
    for (const v of ['round(0.5)', 'abs(-0.5)']) {
      const { declaration, diagnostics, css } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(spanOf(css, diagnostics[0] as Diagnostic), v).toBe(v);
      expectCatalogued(diagnostics);
    }
  });
  it('env() is refused by name, as in every value Dragon parses itself', () => {
    const { declaration, diagnostics } = declare('env(safe-area-inset-top, 0.5)');
    expect(declaration).toBeNull();
    expect(diagnostics.map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
    expect(diagnostics[0]?.message).toMatch(/env\(\) in opacity is not supported/);
  });
});

describe('opacity: the native targets draw 0 and 1 only', () => {
  it('a fractional opacity is refused on ios by name, at the declaration, naming PNT1-opacity-b, and compiles for web', () => {
    for (const v of ['0.5', '50%', '0.001', 'calc(0.2 * 2)']) {
      // A rounded box is neither a fold nor a group native pre-composites.
      const c = compile(`.a { height: 10px; border-radius: 2px; opacity: ${v}; }`, { ios: { minimum: '15.0' }, web: {} });
      const errs = c.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => [d.code, d.target]), v).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, v).toMatch(/^a has opacity [0-9.]+; ios composites a translucent view with its own rounding, one off Chrome's Skia blend in a channel, so Dragon draws a fractional opacity only on a box whose one paint is an opaque background, which Chrome folds into the fill, or on a group it pre-composites \(PNT1-opacity-b\), and this one is not: a has a border radius$/);
      expectCatalogued(errs);
    }
    // An inherited fraction is refused where it computes; the declaration is the child's inherit (a bordered b, as an empty one folds).
    const c = compile('.a { opacity: 25%; } .b { height: 5px; border: 1px solid rgb(0, 0, 0); opacity: inherit; }', { ios: { minimum: '15.0' }, web: {} });
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message.slice(0, 18))).toEqual(['a has opacity 0.25', 'b has opacity 0.25']);
  });
  it('opacity 0, 1 and the values that clamp to them compile on ios', () => {
    for (const v of ['0', '1', '0%', '100%', '1.5', '-2', '500%', 'calc(0.5 * 2)']) {
      const c = compile(`.a { height: 10px; opacity: ${v}; }`, { ios: { minimum: '15.0' }, web: {} });
      expect(c.diagnostics.filter((d) => d.severity === 'error'), v).toEqual([]);
    }
  });
});

// PNT1-opacity-b (first part): Chrome folds a group of one draw into the draw (cc PlaybackFoldingIterator), so a box whose only paint
// is an opaque fill paints as the fill with the opacity's alpha byte; measured equal in Chrome 145 (analysis/paint-values/effects.ts).
describe('opacity: a group of one opaque fill folds into the fill on native', () => {
  const native = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
  const errors = (css: string): string[] => compile(css, native).diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target} ${d.message.slice(0, 16)}`).filter((m) => / has opacity /.test(m));
  const leaf = 'height: 5px; background-color: rgb(10, 20, 30);';
  it('compiles on native a fraction on an empty box with an opaque or transparent fill', () => {
    for (const css of [`.b { ${leaf} opacity: 0.3; }`, '.b { height: 5px; opacity: 45%; }', `.b { ${leaf} border: 0 solid rgb(0, 0, 0); outline: 2px none rgb(0, 0, 0); opacity: 0.7; }`]) {
      expect(errors(css), css).toEqual([]);
    }
  });
  it('refuses on native a fraction whose group paints more than one fill, or composites as a layer', () => {
    for (const extra of ['border-radius: 3px;', 'border: 1px dashed rgb(0, 0, 0);', 'border: 1px solid rgb(0, 0, 0); border-left-color: rgb(9, 9, 9);', 'outline: 1px solid rgb(0, 0, 0);', 'box-shadow: 1px 1px rgb(0, 0, 0);', 'background-color: rgba(10, 20, 30, 0.5);', 'transform: translateX(1px);', 'position: fixed;', 'display: list-item;', 'will-change: transform;', 'overflow: scroll;']) {
      expect(errors(`.b { ${leaf} ${extra} opacity: 0.3; }`), extra).toEqual(['ios b has opacity 0.', 'android b has opacity 0.']);
    }
    // A box with a child is a group of more than one draw: it does not fold, and native pre-composites it (opacity-group).
    expect(errors(`.a { ${leaf} opacity: 0.3; } .b { height: 2px; }`)).toEqual([]);
    expect(errors(`.a { ${leaf} opacity: 0.3; } .b { height: 2px; border-radius: 1px; }`)).toEqual(['ios a has opacity 0.', 'android a has opacity 0.']);
  });
  it('refuses on native a folded fill whose background-color animates or transitions (the animator writes the colour alpha)', () => {
    const fold = 'animates the fill a fractional opacity is folded into, and the animated colour would drop the opacity: not built yet (package PNT1-opacity-b)';
    const all = (r: { diagnostics: readonly Diagnostic[] }): string[] => r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(all(compile(`.b { ${leaf} opacity: 0.5; animation: k 1s infinite; } @keyframes k { from { background-color: rgb(255, 0, 0) } to { background-color: rgb(0, 0, 255) } }`, native))).toEqual([`background-color on b ${fold}`]);
    // A transition between two states, the fold in either.
    const stated = (css: string) => {
      const input = inputFor(`body { margin: 0; } ${css}`, (r) => {
        const d = div(r, 'b', ['b']);
        const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: d.origin };
        return [{ ...d, classes: [...d.classes, on] }];
      });
      const tree = input.tree as DraftTree;
      const root = tree.components[0] as DraftTree['components'][number];
      return createProjectWith({ projectId: 'test', targets: native }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile({ ...input, tree: { ...tree, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } });
    };
    expect(all(stated(`.b { ${leaf} transition: background-color 1s; } .b.on { background-color: rgb(200, 0, 0); opacity: 0.5; }`))).toEqual([`background-color on b ${fold}`]);
    expect(all(stated(`.b { ${leaf} opacity: 0.5; } .b.on { background-color: rgb(200, 0, 0); }`))).toEqual([]);
  });
  it('writes the fill with the opacity alpha byte and no opacity write; a transparent fill stays transparent', () => {
    const c = compile(`.b { ${leaf} opacity: 0.3; } .a { height: 20px; }`, { ios: { minimum: '15.0' }, android: { minSdk: 31 } });
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const program of [p.programs.uikit, p.programs['android-views']]) {
      const b = program.nodes.find((n) => n.id === 'b');
      expect(b?.writes.filter((w) => w.kind === 'opacity' || w.kind === 'background-color')).toEqual([expect.objectContaining({ kind: 'background-color', color: { r: 10, g: 20, b: 30, alpha: opacityAlpha8(0.3) } })]);
    }
    const t = nativePrograms(compile('.b { height: 5px; opacity: 0.3; }', { ios: { minimum: '15.0' }, android: { minSdk: 31 } }), []);
    if (t.kind !== 'ready') throw new Error(t.reason);
    expect(t.programs.uikit.nodes.find((n) => n.id === 'b')?.writes.filter((w) => w.kind === 'opacity' || w.kind === 'background-color')).toEqual([expect.objectContaining({ kind: 'background-color', color: { r: 0, g: 0, b: 0, alpha: 0 } })]);
  });
  it('marks a translucent folded fill, which native draws as Chrome\'s opaque bytes; bytes 0 and 255 and plain colours stay unmarked', () => {
    const bg = (decl: string) => {
      const p = nativePrograms(compile(`.b { ${decl} }`, { ios: { minimum: '15.0' }, android: { minSdk: 31 } }), []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      const n = p.programs.uikit.nodes.find((x) => x.id === 'b');
      const w = n?.writes.find((x) => x.kind === 'background-color');
      if (n === undefined || w === undefined || w.kind !== 'background-color') throw new Error(`${decl}: no background write`);
      return { n, w };
    };
    const plain = bg('height: 5px; background-color: rgba(10, 20, 30, 0.3);');
    expect([`${leaf} opacity: 0.3;`, `${leaf} opacity: 0.999;`, `${leaf} opacity: 0.00196;`].map((d) => [bg(d).w.color.alpha, bg(d).w.folded])).toEqual([[77, true], [255, undefined], [0, undefined]]);
    expect(plain.w.folded).toBeUndefined();
    const { n, w } = bg(`${leaf} opacity: 0.3;`);
    expect(BACKGROUND_EMITTER.lines.uikit('v0', n, w)).toEqual(['  dragonBackground(v0, DragonRGBA8(10, 20, 30, 77), folded: true)']);
    expect(BACKGROUND_EMITTER.lines['android-views']('v0', n, w)).toEqual(['  dragonBackground(v0, DragonRGBA8(10, 20, 30, 77), folded = true)']);
    expect(BACKGROUND_EMITTER.lines.uikit('v0', plain.n, plain.w)).toEqual([`  dragonBackground(v0, DragonRGBA8(10, 20, 30, ${plain.w.color.alpha}))`]);
    // The state runtime has no folded writer, as it has no opacity writer: such a node is refused by name.
    expect(() => nodeLit('swift', n)).toThrow(StateEmitError);
    expect(() => nodeLit('kotlin', n)).toThrow(/folded into the fill has no state-node write/);
  });
  it('keeps the platform blend for a folded fill an offset can move over an earlier sibling\'s fill', () => {
    const folded = (decl: string) => {
      const input = inputFor(`body { margin: 0; } .s { height: 5px; background-color: rgb(200, 0, 0); } .b { ${leaf} opacity: 0.3; ${decl} }`, (r) => [div(r, 'a', ['a'], [div(r, 's', ['s']), div(r, 'b', ['b'])])]);
      const p = nativePrograms(createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 } } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input), []);
      if (p.kind !== 'ready') throw new Error(p.reason);
      const w = p.programs.uikit.nodes.find((x) => x.id === 'b')?.writes.find((x) => x.kind === 'background-color');
      if (w === undefined || w.kind !== 'background-color') throw new Error(`${decl}: no background write`);
      return [w.color.alpha, w.folded];
    };
    // Over the sibling at top: -5px the backdrop is the sibling's red, not the ancestors' fills the folded bytes model.
    expect(folded('position: relative; top: -5px;')).toEqual([77, undefined]);
    expect(folded('position: absolute; top: 0;')).toEqual([77, undefined]);
    expect([folded(''), folded('position: relative;'), folded('position: relative; top: 0; left: 0px;')]).toEqual([[77, true], [77, true], [77, true]]);
  });
  it("the lowering's alpha byte is @dragon/layout's opacityAlpha8", () => {
    const vals: number[] = [];
    for (let k = 0; k <= 255; k++) for (const d of [0, 0.4999, 0.5, 0.5001]) vals.push((k + d) / 255);
    for (let i = 0; i <= 10000; i++) vals.push(i / 10000);
    for (const v of vals) expect(foldAlpha8(v), String(v)).toBe(opacityAlpha8(v));
  });
});

// PNT1-opacity-b (second part): a group native pre-composites itself (analysis paint-values/effects.ts opacityGroupPlans): plain
// boxes with opaque fills, solid one-colour opaque borders and opaque plain text, over a backdrop of such boxes in its clipping
// opaque ancestor (or the canvas).
describe('opacity: a group native pre-composites', () => {
  const native = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
  // w holds an under rect u, an optional labelled p, and the group g with its text and a child k.
  const build = (css: string, label = false) => {
    const input = inputFor(`body { margin: 0; font-family: Ahem; font-size: 10px; } .u { height: 10px; background-color: rgb(0, 0, 200); } .g { margin-top: -5px; height: 20px; background-color: rgb(250, 250, 0); border: 2px solid rgb(0, 90, 0); color: rgb(0, 0, 0); } .k { height: 4px; background-color: rgb(200, 0, 0); } ${css}`, (r) => [
      div(r, 'w', ['w'], [div(r, 'u', ['u']), ...(label ? [div(r, 'p', ['p'], [text(r, 'pt', 'Hi')])] : []), div(r, 'g', ['g'], [text(r, 'gt', 'Ab'), div(r, 'k', ['k'])])]),
    ]);
    return createProjectWith({ projectId: 'test', targets: native }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  };
  const errors = (c: ReturnType<typeof build>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.target} ${d.message}`);
  it('admits a group with text, a border and a child over an earlier rect, with an opacity-group write naming the painters', () => {
    const c = build('.g { opacity: 0.4; }');
    expect(errors(c)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const program of [p.programs.uikit, p.programs['android-views']]) {
      const g = program.nodes.find((n) => n.id === 'g');
      expect(g?.writes.filter((w) => w.kind === 'opacity' || w.kind === 'opacity-group')).toEqual([expect.objectContaining({ kind: 'opacity-group', key: 'dragonGroup', technique: 'dragon-owned-paint', opacity: 0.4, backdrop: null, painters: expect.arrayContaining(['u']) })]);
      expect(g?.facts['effects']).toEqual({ opacity: 0.4 });
      const w = g?.writes.find((x) => x.kind === 'opacity-group');
      if (w === undefined) throw new Error('no group write');
      const painters = (w as { painters: readonly string[] }).painters;
      expect(painters.includes('g') || painters.includes('k'), 'a painter inside the group').toBe(false);
    }
    const g = p.programs.uikit.nodes.find((n) => n.id === 'g');
    const w = g?.writes.find((x) => x.kind === 'opacity-group');
    expect(EFFECTS_EMITTER.lines.uikit('v0', g as never, w as never)[0]).toMatch(/^ {2}dragonSetOpacityGroup\(t, v0, 0\.4, nil, \[.*"u".*\]\)$/);
    expect(EFFECTS_EMITTER.lines['android-views']('v0', g as never, w as never)[0]).toMatch(/^ {2}dragonSetOpacityGroup\(t, v0, 0\.4, null, listOf<String>\(.*"u".*\)\)$/);
  });
  it('takes an opaque clipping ancestor as the backdrop, and paints the canvas white without one', () => {
    const c = build('.w { overflow: hidden; background-color: rgb(255, 255, 255); } .g { opacity: 0.4; }');
    expect(errors(c)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const w = p.programs.uikit.nodes.find((n) => n.id === 'g')?.writes.find((x) => x.kind === 'opacity-group') as { backdrop: string | null; painters: readonly string[] } | undefined;
    expect(w?.backdrop).toBe('w');
    expect(w?.painters[0]).toBe('w');
  });
  it('refuses on native a group whose content or backdrop the overlay cannot draw as Chrome does, naming why', () => {
    const cases: [string, boolean, string][] = [
      ['.g { opacity: 0.4; } .k { opacity: 0.5; }', false, 'k inside it has opacity 0.5, a nested group'],
      ['.g { opacity: 0.4; will-change: opacity; }', false, 'it has will-change: opacity, a compositor layer'],
      ['.g { opacity: 0.4; text-shadow: 1px 1px rgb(0, 0, 0); }', false, 'the text of g has a text-shadow'],
      ['.g { opacity: 0.4; color: rgba(0, 0, 0, 0.5); }', false, 'the text of g is not opaque'],
      ['.g { opacity: 0.4; border-left-color: rgb(1, 2, 3); }', false, 'g has border sides in more than one colour, which meet on a diagonal'],
      ['.g { opacity: 0.4; }', true, 'the text of p paints before it in its backdrop the canvas'],
      ['.g { opacity: 0.4; } .u { border-radius: 2px; }', false, 'a painter before it in its backdrop: u has a border radius'],
      ['.g { opacity: 0.4; } .w { overflow: auto; }', false, 'it is inside w, a scroller'],
      ['.g { opacity: 0.4; } .w { text-decoration: underline; }', false, 'it is inside w, whose text decoration reaches its text'],
    ];
    for (const [css, label, why] of cases) {
      const errs = errors(build(css, label)).filter((m) => / has opacity 0\.4;/.test(m));
      expect(errs, css).toEqual(['ios', 'android'].map((t) => expect.stringMatching(new RegExp(`^${t} g has opacity 0\\.4; .*, and this one is not: ${why.replace(/[.()]/g, (x) => `\\${x}`)}$`))));
    }
  });
  it('draws a box that folds as a folded fill and never as a group, and refuses a group that a folded fill paints before', () => {
    const c = build('.u { opacity: 0.3; }');
    expect(errors(c)).toEqual([]);
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    for (const program of [p.programs.uikit, p.programs['android-views']]) {
      const u = program.nodes.find((n) => n.id === 'u');
      expect(u?.writes.filter((w) => w.kind === 'opacity' || w.kind === 'opacity-group' || w.kind === 'background-color')).toEqual([expect.objectContaining({ kind: 'background-color', color: { r: 0, g: 0, b: 200, alpha: foldAlpha8(0.3) }, folded: true })]);
    }
    const errs = errors(build('.u { opacity: 0.3; } .g { opacity: 0.4; }')).filter((m) => / has opacity 0\.4;/.test(m));
    expect(errs).toEqual(['ios', 'android'].map((t) => expect.stringMatching(new RegExp(`^${t} g has opacity 0\\.4; .*, and this one is not: u paints before it with opacity 0\\.3$`))));
  });
  it('admits a group under the element whose overflow the viewport takes, which neither clips nor scrolls', () => {
    for (const css of ['html { overflow-y: scroll; }', 'body { overflow: auto; }', 'html { overflow: hidden; }']) expect(errors(build(`${css} .g { opacity: 0.4; }`)), css).toEqual([]);
  });
  it('refuses on native a member\'s text decoration that reaches the text of a box inside it', () => {
    const input = inputFor('body { margin: 0; font-family: Ahem; font-size: 10px; } .g { height: 20px; background-color: rgb(250, 250, 0); opacity: 0.4; } .k { color: rgb(0, 0, 0); }', (r) => [
      div(r, 'g', ['g'], [div(r, 'k', ['k'], [text(r, 'kt', 'Ab')])]),
    ]);
    const decorated = inputFor('body { margin: 0; font-family: Ahem; font-size: 10px; } .g { height: 20px; background-color: rgb(250, 250, 0); text-decoration: underline; opacity: 0.4; } .k { color: rgb(0, 0, 0); }', (r) => [
      div(r, 'g', ['g'], [div(r, 'k', ['k'], [text(r, 'kt', 'Ab')])]),
    ]);
    const run = (i: typeof input) => errors(createProjectWith({ projectId: 'test', targets: native }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(i));
    expect(run(input)).toEqual([]);
    expect(run(decorated)).toEqual(['ios', 'android'].map((t) => expect.stringMatching(new RegExp(`^${t} g has opacity 0\\.4; .*, and this one is not: g has a text-decoration-line, which reaches the text inside it$`))));
  });
  it('refuses on native an animation or transition on a member or a backdrop painter', () => {
    const motion = (who: string) => `on ${who}, which a pre-composited opacity or filter group draws or composites over: the group's composite is recomputed on layout and paint changes, not on animation frames (package PNT1-opacity-b)`;
    const all = (c: ReturnType<typeof build>): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message);
    expect(all(build('.g { opacity: 0.4; } .k { animation: k 1s infinite; } @keyframes k { from { height: 4px } to { height: 6px } }'))).toEqual([`an animation ${motion('k')}`, `an animation ${motion('k')}`]);
    expect(all(build('.g { opacity: 0.4; } .u { transition: height 1s; }'))).toEqual([`a transition ${motion('u')}`, `a transition ${motion('u')}`]);
    // An ancestor before the group in its backdrop is a painter too.
    expect(all(build('.g { opacity: 0.4; } .w { transition: height 1s; }'))).toEqual([`a transition ${motion('w')}`, `a transition ${motion('w')}`]);
    // Without the group, nothing is refused.
    expect(all(build('.w { transition: height 1s; }'))).toEqual([]);
  });
});

describe('opacity: lowering and emission', () => {
  const programs = (css: string) => {
    const c = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 } });
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };

  it('a box with opacity below 1 gets one opacity write with the computed opacity and effects facts; opacity 1 gets none', () => {
    const p = programs('.a { height: 20px; opacity: 0%; } .b { height: 5px; opacity: 1.5; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    expect(a?.writes.filter((w) => w.kind === 'opacity')).toEqual([expect.objectContaining({ kind: 'opacity', key: 'alpha', technique: 'native-property', opacity: 0, css: ['opacity'] })]);
    expect(a?.facts['effects']).toEqual({ opacity: 0 });
    const b = p['android-views'].nodes.find((n) => n.id === 'b');
    expect(b?.writes.some((w) => w.kind === 'opacity')).toBe(false);
    expect(b?.facts['effects']).toBeUndefined();
  });

  it('emits the runtime writer with the opacity on both backends and expects the float32 of the alpha byte / 255', () => {
    const p = programs('.a { height: 20px; opacity: 0; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const w0 = a?.writes.find((x) => x.kind === 'opacity');
    if (w0 === undefined || w0.kind !== 'opacity') throw new Error('no opacity write');
    expect(EFFECTS_EMITTER.lines.uikit('v0', a as never, w0)).toEqual(['  dragonSetOpacity(v0, 0.0)']);
    // The writer takes any opacity in [0, 1) (a runtime write, PNT1-opacity-b); the lowering writes 0 only today.
    const w = { ...w0, opacity: 0.3 };
    expect(EFFECTS_EMITTER.lines.uikit('v0', a as never, w)).toEqual(['  dragonSetOpacity(v0, 0.3)']);
    expect(EFFECTS_EMITTER.lines['android-views']('v0', a as never, w)).toEqual(['  dragonSetOpacity(v0, 0.3)']);
    const engine = { float32: Math.fround, opacityAlpha8 } as never;
    // Skia's getAlpha of the float 0.3 is 77 (76.5000030 rounds up), as the Chrome capture shows (pnt1-effects.test.ts).
    expect(opacityAlpha8(0.3)).toBe(77);
    expect(EFFECTS_EMITTER.applied(engine, 'uikit', w, 2, { border: [0, 0, 0, 0], box: {} as never, size: [0, 0], fontSize: null, replaced: null, scroll: null })).toBe(Math.fround(77 / 255));
  });

  it('refuses an opacity literal outside [0, 1) in the writer line', () => {
    expect(() => EFFECTS_EMITTER.lines.uikit('v0', {} as never, { kind: 'opacity', opacity: 1 } as never)).toThrow(/opacity 1 is not in \[0, 1\)/);
    expect(() => EFFECTS_EMITTER.lines.uikit('v0', {} as never, { kind: 'opacity', opacity: Number.NaN } as never)).toThrow(/is not in/);
  });
});
