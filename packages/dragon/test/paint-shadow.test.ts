// PNT1 box-shadow (css-backgrounds-3 §7.1): parsing with Chrome 145's rules beyond the grammar, computed values (lengths to px,
// currentcolor to the element's color, Chrome's serialization order), the refusals, the lowering to one write with typed facts,
// the emitted writer lines and the expected applied shadows.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { SHADOW_EMITTER } from '../src/emit/paint/shadow.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf, text } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/shadow.css', revision: 'r1', hash: 'sha256:0' };

function declare(value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { box-shadow: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

const spanOf = (css: string, d: Diagnostic): string => (d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : '<unlocated>');

function compile(css: string, targets: Targets = { ios: { minimum: '15.0' }, web: {} }) {
  const input = inputFor(`body { margin: 0; font-size: 20px; color: rgb(10, 20, 30); } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]);
  return createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
}

describe('box-shadow: parse and computed values (Chrome 145 getComputedStyle)', () => {
  // [value, Chrome 145's computed string] (probed with the pinned Chrome; body color rgb(10, 20, 30), font-size 20px)
  const cases: [string, string][] = [
    ['inset 1px 2px', 'rgb(10, 20, 30) 1px 2px 0px 0px inset'],
    ['1px 2px inset red', 'rgb(255, 0, 0) 1px 2px 0px 0px inset'],
    ['red inset 1px 2px 3px', 'rgb(255, 0, 0) 1px 2px 3px 0px inset'],
    ['1px 2px 3px 4px rgba(1,2,3,.5)', 'rgba(1, 2, 3, 0.5) 1px 2px 3px 4px'],
    ['0 0 1em 0.5rem #abc', 'rgb(170, 187, 204) 0px 0px 20px 8px'],
    ['1px 1px currentcolor', 'rgb(10, 20, 30) 1px 1px 0px 0px'],
    ['1px 1px 0 0 transparent', 'rgba(0, 0, 0, 0) 1px 1px 0px 0px'],
    ['none', 'none'],
    ['NONE', 'none'],
    ['0.1px 0.25px 1.5px -2.25px blue', 'rgb(0, 0, 255) 0.1px 0.25px 1.5px -2.25px'],
    ['0 0 0 0.35rem rgba(255, 255, 255, 0.05)', 'rgba(255, 255, 255, 0.05) 0px 0px 0px 5.6px'],
    ['1px 2px red, 3px 4px 5px 6px blue inset', 'rgb(255, 0, 0) 1px 2px 0px 0px, rgb(0, 0, 255) 3px 4px 5px 6px inset'],
    ['1px 1px hsl(120 50% 50% / 0.5)', 'rgba(64, 191, 64, 0.5) 1px 1px 0px 0px'],
  ];
  for (const [value, want] of cases) {
    it(`box-shadow: ${value} computes to ${want}`, () => {
      const c = compile(`.a { width: 60px; height: 30px; box-shadow: ${value}; }`);
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(explainOne(c, 'ios', 'a', 'box-shadow').value).toBe(want);
    });
  }

  it('one length, five lengths, a negative blur, two insets, two colours and none in a list are invalid, as in Chrome', () => {
    for (const v of ['1px', '1px 2px 3px 4px 5px', '1px 2px -3px', 'inset inset 1px 1px', '1px 1px red blue', '1px 1px, none', '1px red 2px']) {
      const { declaration, diagnostics } = declare(v);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });

  it('CSS-wide keywords set box-shadow; inherit takes the parent computed shadows', () => {
    // .a clips its overflow, so .b's shadow stays off .a's own (PM ruling on shadows, option 2: otherwise refused on native).
    const c = compile('.a { box-shadow: 1px 2px 3px red; overflow: hidden; } .b { box-shadow: inherit; }');
    expect(explainOne(c, 'ios', 'b', 'box-shadow').value).toBe('rgb(255, 0, 0) 1px 2px 3px 0px');
  });
});

describe('box-shadow: refusals', () => {
  it('a calculation, a viewport unit, a font-metric unit and a colour outside the subset are DRAGON_UNSUPPORTED_VALUE on the token', () => {
    for (const [v, span] of [['calc(1px + 1px) 2px', 'calc(1px + 1px)'], ['1vw 2px', '1vw'], ['1px 1ex', '1ex'], ['1px 1px lab(50% 40 59)', 'lab(50% 40 59)']]) {
      const { declaration, diagnostics, css } = declare(v as string);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe(span);
      expectCatalogued(diagnostics);
    }
  });
});

describe('box-shadow: native refusals of what the companion-view shadow does not draw as Chrome does', () => {
  const targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
  const refusedOf = (input: ReturnType<typeof inputFor>) => {
    const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
    return c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('box-shadow'));
  };
  it('html, body, a replaced element and a transformed box are refused for ios and android at the box-shadow value, and not for web', () => {
    for (const [what, css, tag, says] of [
      ['html', 'html { box-shadow: 0 0 4px red; }', 'div', 'does not draw on the root or body'],
      ['body', 'body { box-shadow: 0 0 4px red; }', 'div', 'does not draw on the root or body'],
      ['img', '.i { width: 20px; height: 20px; box-shadow: 0 0 4px red; }', 'img', 'does not draw on replaced content'],
      ['transform', '.i { width: 20px; height: 20px; box-shadow: 0 0 4px red; transform: rotate(10deg); }', 'div', 'a box-shadow and a transform'],
    ] as const) {
      const input = inputFor(`body { margin: 0; } ${css}`, (r) => [{ ...div(r, 'i', ['i']), tag } as never]);
      const refused = refusedOf(input);
      expect(refused.map((d) => d.target).sort(), what).toEqual(['android', 'ios']);
      for (const d of refused) {
        expect(spanTextOf(input, d), what).toBe('0 0 4px red');
        expect(d.message, what).toContain(says);
      }
      expectCatalogued(refused);
    }
  });
  it('a plain shadowed box, transform: none and box-shadow: none on the root are not refused', () => {
    for (const css of ['.i { box-shadow: 0 0 4px red; }', '.i { box-shadow: 0 0 4px red; transform: none; }', 'body { box-shadow: none; }']) {
      expect(refusedOf(inputFor(`body { margin: 0; } ${css}`, (r) => [div(r, 'i', ['i'])])), css).toEqual([]);
    }
  });
});

describe('box-shadow: native refusals of a backdrop the shadow is not baked against (PM ruling on shadows, option 2)', () => {
  const targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
  type Node = { id: string; cls: string; kids?: Node[]; text?: string };
  const build = (r: Parameters<Parameters<typeof inputFor>[1]>[0], n: Node): ReturnType<typeof div> => div(r, n.id, n.cls.split(' '), [...(n.text === undefined ? [] : [text(r, `${n.id}t`, n.text)]), ...(n.kids ?? []).map((k) => build(r, k))]);
  const refusals = (css: string, nodes: Node[]) => {
    const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } ${css}`, (r) => nodes.map((n) => build(r, n))));
    return c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('does not bake'));
  };
  const S = '.s { width: 40px; height: 20px; box-shadow: 0 0 8px rgba(0, 0, 0, 0.5); }';
  it('accepts a shadow over earlier backgrounds only: ancestors, earlier siblings and their children, rounded or translucent', () => {
    expect(refusals(`.p { background-color: #eee; } .a { height: 10px; background-color: rgba(0, 0, 255, 0.5); border-radius: 4px; } ${S}`, [{ id: 'p', cls: 'p', kids: [{ id: 'a', cls: 'a', kids: [{ id: 'a1', cls: 'a' }] }, { id: 's', cls: 's' }] }])).toEqual([]);
  });
  it('refuses, on ios and android only, a shadow after an earlier border, shadow, transform, positioned box, clip or replaced content', () => {
    for (const [what, css] of [['a border', '.a { border: 1px solid red; }'], ['a box-shadow', '.a { box-shadow: 0 0 2px red; }'], ['a transform', '.a { transform: rotate(5deg); }'], ['position: relative', '.a { position: relative; }'], ['an overflow clip', '.a { overflow: hidden; }']] as const) {
      const r = refusals(`${css} ${S}`, [{ id: 'a', cls: 'a' }, { id: 's', cls: 's' }]);
      expect(r.map((d) => d.target).sort(), what).toEqual(['android', 'ios']);
      expect(r[0]?.message, what).toContain(`a (${what})`);
      expectCatalogued(r);
    }
  });
  it('refuses a positioned or transformed ancestor, an inline-level shadowed box and an ancestor border it is not clipped away from', () => {
    expect(refusals(`.p { position: relative; } ${S}`, [{ id: 'p', cls: 'p', kids: [{ id: 's', cls: 's' }] }])).toHaveLength(2);
    expect(refusals(`.p { transform: translate(1px); } ${S}`, [{ id: 'p', cls: 'p', kids: [{ id: 's', cls: 's' }] }])).toHaveLength(2);
    expect(refusals(`.p { border: 2px solid; } ${S}`, [{ id: 'p', cls: 'p', kids: [{ id: 's', cls: 's' }] }])).toHaveLength(2);
    // An ancestor that clips at its padding box keeps the shadow off its own border and outer shadow.
    expect(refusals(`.p { border: 2px solid; box-shadow: 0 0 4px red; overflow: hidden; } ${S}`, [{ id: 'p', cls: 'p', kids: [{ id: 's', cls: 's' }] }])).toEqual([]);
    expect(refusals(`.p { overflow: hidden; box-shadow: inset 0 0 4px red; } ${S}`, [{ id: 'p', cls: 'p', kids: [{ id: 's', cls: 's' }] }])).toHaveLength(2);
  });
  it('accepts earlier flex siblings with shadows or borders only when the gap exceeds both reaches, and no item reorders or has a negative margin', () => {
    // The shadow reaches 8 * 1.5 + 2 = 14 px; the earlier item's 2 * 1.5 + 2 = 5 px.
    const row = (gap: number, extra = '') => refusals(`.row { display: flex; column-gap: ${gap}px; row-gap: ${gap}px; } .a { width: 10px; height: 10px; box-shadow: 0 0 2px red; } ${S} ${extra}`, [{ id: 'row', cls: 'row', kids: [{ id: 'a', cls: 'a' }, { id: 's', cls: 's' }] }]);
    expect(row(20)).toEqual([]);
    expect(row(19)).toHaveLength(2);
    // order reorders the paint of every item, so both shadows are refused.
    expect(row(30, '.a { order: 1; }')).toHaveLength(4);
    expect(row(30, '.a { margin-left: -2px; }')).toHaveLength(2);
    // A shadow inside a clipping item stays in that item: only the earlier item's reach counts against the gap.
    expect(refusals(`.row { display: flex; column-gap: 6px; } .a { width: 10px; height: 10px; box-shadow: 0 0 2px red; } .c { overflow: hidden; } ${S}`, [{ id: 'row', cls: 'row', kids: [{ id: 'a', cls: 'a' }, { id: 'c', cls: 'c', kids: [{ id: 's', cls: 's' }] }] }])).toEqual([]);
  });
  it('refuses text in an earlier flex item (painted wholly beneath), and accepts text earlier in block flow (painted above)', () => {
    expect(refusals(`.row { display: flex; column-gap: 40px; } ${S}`, [{ id: 'row', cls: 'row', kids: [{ id: 'a', cls: 'a', text: 'XX' }, { id: 's', cls: 's' }] }])).toHaveLength(2);
    expect(refusals(S, [{ id: 'a', cls: 'a', text: 'XX' }, { id: 's', cls: 's' }])).toEqual([]);
  });
});

describe('box-shadow: lowering and emission', () => {
  const programs = (css: string) => {
    const c = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 } });
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };

  it('a box with shadows gets one box-shadow write with the computed shadows in list order and shadow facts; none gets no write', () => {
    const p = programs('.a { box-shadow: 0 0.25rem 0.5em rgba(0, 0, 0, 0.48), inset 1px 2px currentcolor; } .b { box-shadow: none; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const shadows = [
      { inset: false, x: 0, y: 4, blur: 10, spread: 0, color: { r: 0, g: 0, b: 0, alpha: 122 } },
      { inset: true, x: 1, y: 2, blur: 0, spread: 0, color: { r: 10, g: 20, b: 30, alpha: 255 } },
    ];
    expect(a?.writes.filter((w) => w.kind === 'box-shadow')).toEqual([expect.objectContaining({ kind: 'box-shadow', key: 'dragonShadow.shadows', technique: 'dragon-owned-paint', shadows })]);
    expect(a?.facts).toEqual({ shadow: { shadows } });
    const b = p['android-views'].nodes.find((n) => n.id === 'b');
    expect(b?.writes.some((w) => w.kind === 'box-shadow')).toBe(false);
  });

  it('emits the runtime writer with the tree on both backends and expects the shadows as [inset, x, y, blur, spread, r, g, b, a]', () => {
    const p = programs('.a { box-shadow: 1px 2px 3px 4px rgba(1, 2, 3, 0.5), inset 0 0 5px red; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const w = a?.writes.find((x) => x.kind === 'box-shadow');
    if (w === undefined || w.kind !== 'box-shadow') throw new Error('no shadow write');
    expect(SHADOW_EMITTER.lines.uikit('v0', a as never, w)).toEqual(['  dragonSetShadows(t, v0, [ShadowInput(false, 1.0, 2.0, 3.0, 4.0, 1.0, 2.0, 3.0, 128.0), ShadowInput(true, 0.0, 0.0, 5.0, 0.0, 255.0, 0.0, 0.0, 255.0)])']);
    expect(SHADOW_EMITTER.lines['android-views']('v0', a as never, w)).toEqual(['  dragonSetShadows(t, v0, arrayOf(ShadowInput(false, 1.0, 2.0, 3.0, 4.0, 1.0, 2.0, 3.0, 128.0), ShadowInput(true, 0.0, 0.0, 5.0, 0.0, 255.0, 0.0, 0.0, 255.0)))']);
    expect(SHADOW_EMITTER.applied({} as never, 'uikit', w, 2, { border: [0, 0, 0, 0], box: {} as never, size: [0, 0], fontSize: null, replaced: null })).toEqual([[0, 1, 2, 3, 4, 1, 2, 3, 128], [1, 0, 0, 5, 0, 255, 0, 0, 255]]);
  });
});
