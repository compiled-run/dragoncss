// background-clip: text over a background colour (background-clip-text.ts): the value parses and computes on every target, through
// the -webkit- alias, var(), !important and inherit, and a later declaration or the background shorthand takes it away; a transparent
// colour clipped to text changes nothing, and transparent text over a colour draws its glyphs in that colour natively, with the box's
// own colour suppressed, per state; every other text clip is refused where it applies (an image or the canvas on every target; text
// that is not transparent, hidden text, child elements, an inline box, borders, radii, shadows, decorations, overflow clips, an
// inherited color and animations natively).
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { NativeProgram } from '../src/internal.ts';
import type { Assignment, DraftTree, FrontEndResult, SourceRef, Targets, TreeNode } from '../src/types.ts';
import { div, DOC, eq, expectCatalogued, explainOne, inputFor, not, spanTextOf, text } from './helpers.ts';

const ALL: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
const BASE = 'body { margin: 0; font-family: Ahem; font-size: 10px; } .a { width: 40px; height: 20px; } ';

// The clipped box a holds the text a-t only; p beside it holds p-t.
const tree = (r: SourceRef): TreeNode[] => [div(r, 'a', ['a'], [text(r, 'a-t', 'XX')]), div(r, 'p', ['p'], [text(r, 'p-t', 'YY')])];
// a holds text and a child element b with its own text.
const nested = (r: SourceRef): TreeNode[] => [div(r, 'a', ['a'], [text(r, 'a-t', 'XX'), div(r, 'b', ['b'], [text(r, 'b-t', 'YY')])])];

const compile = (css: string, body: (r: SourceRef) => TreeNode[] = tree, targets: Targets = ALL) =>
  createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(BASE + css, body));
const errors = (c: { diagnostics: readonly Diagnostic[] }): Diagnostic[] => c.diagnostics.filter((d) => d.severity === 'error');
const clipErrors = (c: { diagnostics: readonly Diagnostic[] }): string[] => errors(c).filter((d) => d.message.includes('background-clip: text on') || d.message.includes('clipped to text')).map((d) => `${d.target}: ${d.message}`).sort();

function programsOf(compiled: object, assignment: Assignment = []): readonly NativeProgram[] {
  const p = nativePrograms(compiled, assignment);
  if (p.kind !== 'ready') throw new Error(p.reason);
  return [p.programs.uikit, p.programs['android-views']];
}

const colourOf = (prog: NativeProgram, id: string, kind: 'background-color' | 'text-color'): readonly number[] => {
  const w = prog.nodes.find((n) => n.id === id)?.writes.find((x) => x.kind === kind);
  if (w === undefined || !('color' in w)) throw new Error(`${id}: no ${kind} write`);
  const c = (w as unknown as { color: { r: number; g: number; b: number; alpha: number } }).color;
  return [c.r, c.g, c.b, c.alpha];
};

describe('background-clip: text parses and computes as Chrome 145 does', () => {
  const at = (css: string, node = 'a') => explainOne(compile(`.a { ${css} }`), 'web', node, 'background-clip').value;
  it('in any ASCII case, in a list, through the -webkit- alias, var(), !important and an explicit inherit', () => {
    expect(at('background-clip: text;')).toBe('text');
    expect(at('background-clip: TEXT;')).toBe('text');
    expect(at('background-clip: text, border-box;')).toBe('text, border-box');
    expect(at('-webkit-background-clip: text;')).toBe('text');
    expect(at('--c: text; background-clip: var(--c);')).toBe('text');
    expect(explainOne(compile('.a { background-clip: text !important; } .a { background-clip: border-box; }'), 'web', 'a', 'background-clip').value).toBe('text');
    expect(explainOne(compile('.a { background-clip: text; } .b { background-clip: inherit; }', nested), 'web', 'b', 'background-clip').value).toBe('text');
  });
  it('a later declaration and the background shorthand reset it; it is not inherited', () => {
    expect(at('background-clip: text; background-clip: padding-box;')).toBe('padding-box');
    expect(at('background-clip: text; background: red;')).toBe('border-box');
    expect(at('background: red; background-clip: text;')).toBe('text');
    expect(explainOne(compile('.a { background-clip: text; }', nested), 'web', 'b', 'background-clip').value).toBe('border-box');
  });
  it('background-origin still refuses text, and so does the shorthand, which would set the origin to it', () => {
    // Chrome's background-origin grammar has no text; the shorthand's one box keyword sets both longhands.
    expect(errors(compile('.a { background-origin: text; }')).map((d) => d.code)).toEqual(['DRAGON_CSS_INVALID_VALUE']);
    expect(errors(compile('.a { background: red text; }')).map((d) => d.code)).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
  });
});

describe('background-clip: text over a transparent colour changes nothing, on every target', () => {
  for (const css of ['.a { background-clip: text; }', '.a { -webkit-background-clip: text; color: rgb(10, 20, 30); }', '.a { background-clip: text; background-color: transparent; }', '.a { background-clip: text; } .b { color: red; }']) {
    it(css, () => {
      const c = compile(css, css.includes('.b') ? nested : tree);
      expect(errors(c)).toEqual([]);
      for (const prog of programsOf(c)) {
        expect(colourOf(prog, 'a', 'background-color')).toEqual([0, 0, 0, 0]);
        expect(colourOf(prog, 'a:text0', 'text-color')).toEqual(css.includes('rgb(10') ? [10, 20, 30, 255] : [0, 0, 0, 255]);
      }
    });
  }
});

describe('background-clip: text with transparent text over a colour draws the glyphs in the colour natively', () => {
  for (const [css, want] of [
    ['.a { background-color: rgb(200, 30, 40); background-clip: text; color: transparent; }', [200, 30, 40, 255]],
    ['.a { background: rgba(0, 0, 255, 0.5); -webkit-background-clip: text; color: rgba(0, 0, 0, 0); }', [0, 0, 255, 128]],
    ['.a { --t: text; background-color: rgb(1, 2, 3); background-clip: var(--t); color: transparent; display: flex; }', [1, 2, 3, 255]],
    ['.a { background-color: rgb(9, 8, 7); background-clip: text, border-box; color: transparent; }', [9, 8, 7, 255]],
  ] as const) {
    it(css, () => {
      const c = compile(css);
      expect(errors(c)).toEqual([]);
      for (const prog of programsOf(c)) {
        expect(colourOf(prog, 'a', 'background-color')).toEqual([0, 0, 0, 0]);
        expect(colourOf(prog, 'a:text0', 'text-color')).toEqual(want);
        expect(colourOf(prog, 'p:text0', 'text-color')).toEqual([0, 0, 0, 255]);
      }
    });
  }
  it('a losing text clip leaves the colour on the box and the text as it is', () => {
    const c = compile('.a { background-color: rgb(200, 30, 40); background-clip: text; background-clip: border-box; color: rgb(0, 128, 0); }');
    expect(errors(c)).toEqual([]);
    for (const prog of programsOf(c)) {
      expect(colourOf(prog, 'a', 'background-color')).toEqual([200, 30, 40, 255]);
      expect(colourOf(prog, 'a:text0', 'text-color')).toEqual([0, 128, 0, 255]);
    }
  });
});

describe('background-clip: text per state', () => {
  /** a gains class on in the open state. */
  const stated = (css: string): FrontEndResult => {
    const input = inputFor(BASE + css, (r) => {
      const [a, p] = tree(r) as [TreeNode & { classes: unknown[]; origin: unknown }, TreeNode];
      const on = { value: [{ when: eq('open', true), value: { owner: DOC, sheet: 's', name: 'on' } }, { when: not(eq('open', true)), value: null }], origin: a.origin };
      return [{ ...a, classes: [...a.classes, on] } as TreeNode, p];
    });
    const t = input.tree as DraftTree;
    const root = t.components[0] as DraftTree['components'][number];
    return { ...input, tree: { ...t, components: [{ ...root, states: [{ id: 'open', domain: [false, true], initial: false, origin: root.origin }] }] } };
  };
  const open = (v: boolean): Assignment => [{ state: { instance: DOC, state: 'open' }, value: v }];
  const user = (input: FrontEndResult) => createProjectWith({ projectId: 'test', targets: ALL }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  it('each state draws its own case: inert when closed, the glyphs in the colour when open', () => {
    const c = user(stated('.a { background-clip: text; color: transparent; } .a.on { background-color: rgb(50, 60, 70); }'));
    // Closed, transparent text over a transparent colour would hide the text: refused natively; the open state draws it.
    expect(clipErrors(c)).toEqual(['android', 'ios'].map((t) => `${t}: background-clip: text on a: the text is transparent and so is the background colour clipped to it, so the text would not show; Dragon refuses text that cannot be seen (BG2c)`));
    const d = user(stated('.a { background-clip: text; color: transparent; background-color: rgb(1, 1, 1); } .a.on { background-color: rgb(50, 60, 70); }'));
    expect(errors(d)).toEqual([]);
    for (const [v, want] of [[false, [1, 1, 1, 255]], [true, [50, 60, 70, 255]]] as const) {
      for (const prog of programsOf(d, open(v))) {
        expect(colourOf(prog, 'a', 'background-color')).toEqual([0, 0, 0, 0]);
        expect(colourOf(prog, 'a:text0', 'text-color')).toEqual(want);
      }
    }
  });
  it('a state whose text is not transparent is refused natively, at the clip', () => {
    const input = stated('.a { background-clip: text; color: transparent; background-color: rgb(1, 1, 1); } .a.on { color: blue; }');
    const ds = errors(user(input));
    expect(ds.map((d) => d.target).sort()).toEqual(['android', 'ios']);
    for (const d of ds) expect(spanTextOf(input, d)).toBe('text');
    expectCatalogued(ds);
  });
  it(':hover is analysed per state: a hovered colour under text that is not transparent is refused natively, never on web', () => {
    const lanes = createProjectWith({ projectId: 'test', targets: ALL }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', interactionLanes: true });
    const c = lanes.compile(inputFor(`${BASE}.a { background-clip: text; } .a:hover { background-color: rgb(200, 0, 0); }`, tree));
    expect(clipErrors(c)).toEqual(['android', 'ios'].map((t) => `${t}: background-clip: text on a: the text is not transparent: Chrome draws it over the background colour seen through the same glyph coverage, which one native glyph draw matches only for transparent text (BG2c)`));
    expect(errors(c).filter((d) => d.target === 'web')).toEqual([]);
  });
  it('a transition or animation of a colour or of the clip on a text clip box is refused natively', () => {
    const transition = stated('.a { background-clip: text; color: transparent; background-color: rgb(1, 1, 1); transition: background-color 1s; } .a.on { background-color: rgb(50, 60, 70); }');
    const ds = errors(user(transition)).filter((d) => d.message.includes('clipped to text as the colour of the glyphs'));
    expect(ds.map((d) => [d.target, d.message]).sort()).toEqual(['android', 'ios'].map((t) => [t, 'a transition of background-color on a: the native targets draw a background colour clipped to text as the colour of the glyphs, set once per state, and the native animator would change background-color without redrawing them (BG2c)']));
    expectCatalogued(ds);
    const keyframed = compile('.a { background-clip: text; background-color: transparent; animation: f 1s forwards; } @keyframes f { to { background-color: red; } }');
    expect(errors(keyframed).filter((d) => d.message.startsWith('an animation of background-color on a:')).map((d) => d.target).sort()).toEqual(['android', 'ios']);
    const clipped = compile('.a { animation: g 1s forwards; } @keyframes g { to { background-clip: text; } }');
    expect(errors(clipped).filter((d) => d.message.startsWith('an animation of background-clip on a:')).map((d) => d.target).sort()).toEqual(['android', 'ios']);
    expect(errors(compile('.a { background-clip: text; animation: f 1s; } @keyframes f { to { background-color: red; } }', tree, { web: {} }))).toEqual([]);
  });
});

describe('background-clip: text refusals', () => {
  const fill = 'background-color: rgb(200, 30, 40); background-clip: text; color: transparent;';
  const nativeOnly = (reason: string) => ['android', 'ios'].map((t) => `${t}: background-clip: text on a: ${reason} (BG2c)`);
  for (const [css, reason, body] of [
    ['.a { background-color: rgb(200, 30, 40); background-clip: text; }', 'the text is not transparent: Chrome draws it over the background colour seen through the same glyph coverage, which one native glyph draw matches only for transparent text', tree],
    ['.a { background-clip: text; color: transparent; }', 'the text is transparent and so is the background colour clipped to it, so the text would not show; Dragon refuses text that cannot be seen', tree],
    [`.a { ${fill} }`, 'the box has child elements, whose own paint and text Chrome draws under and through the clipped colour', nested],
    [`.a { ${fill} display: inline; }`, 'the box is display: inline, and Dragon draws the clip on block, flow-root, flex and grid boxes only', tree],
    [`.a { ${fill} display: inline-block; }`, 'the box is display: inline-block, and Dragon draws the clip on block, flow-root, flex and grid boxes only', tree],
    [`.a { ${fill} border: 1px solid red; }`, 'the box has a border', tree],
    [`.a { ${fill} border-radius: 2px; }`, 'the box has a border radius', tree],
    [`.a { ${fill} box-shadow: 1px 1px red; }`, 'the box has a box shadow', tree],
    [`.a { ${fill} text-shadow: 1px 1px red; }`, 'the text has a text shadow', tree],
    [`.a { ${fill} text-decoration: underline; }`, 'the text is decorated', tree],
    [`.a { ${fill} overflow: hidden; }`, 'the box clips its overflow', tree],
  ] as const) {
    it(`natively: ${css}`, () => {
      const c = compile(css, body);
      expect(clipErrors(c)).toEqual(nativeOnly(reason));
      expectCatalogued(errors(c));
    });
  }
  it('natively: an inherited transparent color', () => {
    const c = compile('.a { color: transparent; } .b { background-color: red; background-clip: text; }', nested);
    expect(clipErrors(c)).toEqual(['android', 'ios'].map((t) => `${t}: background-clip: text on b: the box inherits its transparent color, which an ancestor's animation or state could change under the native glyphs (BG2c)`));
  });
  it('on every target: a gradient clipped to text, and a text clip on html or body', () => {
    const g = compile('.a { background: linear-gradient(red, blue); background-clip: text; color: transparent; }');
    expect(clipErrors(g)).toEqual(['android', 'ios', 'web'].map((t) => `${t}: background-clip: text on a: a background image clipped to text is not drawn by Dragon yet; only a background colour is (BG2c)`));
    const b = compile('body { background-clip: text; }');
    expect(clipErrors(b).map((m) => m.split(':')[0])).toEqual(['android', 'ios', 'web']);
    expectCatalogued(errors(g));
  });
});
