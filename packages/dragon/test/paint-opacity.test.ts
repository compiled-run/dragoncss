// PNT1 opacity (css-color-4 §14.1): parsing with Chrome 145's rules, the computed value (a percentage to its number, clamped to
// [0, 1]), the refusals (a percentage calculation, a math function Dragon does not evaluate), the lowering to one write with facts,
// the emitted writer lines and the expected applied alpha (Chrome's paint alpha byte / 255 as a float32).
import { describe, expect, it } from 'vitest';
import { opacityAlpha8 } from '@dragon/layout';
import type { Diagnostic } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { EFFECTS_EMITTER } from '../src/emit/paint/effects.ts';
import type { Targets } from '../src/types.ts';
import { div, expectCatalogued, explainOne, inputFor } from './helpers.ts';

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
      const c = compile(`.a { height: 10px; opacity: ${v}; }`, { ios: { minimum: '15.0' }, web: {} });
      const errs = c.diagnostics.filter((d) => d.severity === 'error');
      expect(errs.map((d) => [d.code, d.target]), v).toEqual([['DRAGON_UNSUPPORTED_VALUE', 'ios']]);
      expect(errs[0]?.message, v).toMatch(/^a has opacity [0-9.]+; ios composites a translucent view with its own rounding, one off Chrome's Skia blend in a channel, so Dragon draws opacity 0 and 1 only until package PNT1-opacity-b pre-composites the rest$/);
      expectCatalogued(errs);
    }
    // An inherited fraction is refused where it computes; the declaration is the child's inherit.
    const c = compile('.a { opacity: 25%; } .b { height: 5px; opacity: inherit; }', { ios: { minimum: '15.0' }, web: {} });
    expect(c.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message.slice(0, 18))).toEqual(['a has opacity 0.25', 'b has opacity 0.25']);
  });
  it('opacity 0, 1 and the values that clamp to them compile on ios', () => {
    for (const v of ['0', '1', '0%', '100%', '1.5', '-2', '500%', 'calc(0.5 * 2)']) {
      const c = compile(`.a { height: 10px; opacity: ${v}; }`, { ios: { minimum: '15.0' }, web: {} });
      expect(c.diagnostics.filter((d) => d.severity === 'error'), v).toEqual([]);
    }
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
    expect(EFFECTS_EMITTER.applied(engine, 'uikit', w, 2, { border: [0, 0, 0, 0], box: {} as never, fontSize: null, replaced: null })).toBe(Math.fround(77 / 255));
  });

  it('refuses an opacity literal outside [0, 1) in the writer line', () => {
    expect(() => EFFECTS_EMITTER.lines.uikit('v0', {} as never, { kind: 'opacity', opacity: 1 } as never)).toThrow(/opacity 1 is not in \[0, 1\)/);
    expect(() => EFFECTS_EMITTER.lines.uikit('v0', {} as never, { kind: 'opacity', opacity: Number.NaN } as never)).toThrow(/is not in/);
  });
});
