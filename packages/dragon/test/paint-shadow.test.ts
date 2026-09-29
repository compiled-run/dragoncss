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
import { div, expectCatalogued, explainOne, inputFor } from './helpers.ts';

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
    const c = compile('.a { box-shadow: 1px 2px 3px red; } .b { box-shadow: inherit; }');
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
    expect(SHADOW_EMITTER.applied({} as never, 'uikit', w, 2, { border: [0, 0, 0, 0], box: {} as never })).toEqual([[0, 1, 2, 3, 4, 1, 2, 3, 128], [1, 0, 0, 5, 0, 255, 0, 0, 255]]);
  });
});
