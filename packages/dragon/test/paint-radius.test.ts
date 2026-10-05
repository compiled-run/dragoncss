// PNT1 border-radius (css-backgrounds-3 §5): parsing of the corner longhands and the shorthand with Chrome 145's rules beyond the
// grammar, computed values (em and rem to px, equal pairs collapsed), the refusals, the lowering to one write with typed facts, the
// emitted writer lines and the expected applied radii (the TS paint-radius.ts the device runs translated).
import { describe, expect, it } from 'vitest';
import { roundedShape } from '@dragon/layout';
import type { Diagnostic } from '../src/index.ts';
import type { Targets } from '../src/types.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { Declaration } from '../src/css/stylesheet.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import { RADIUS_EMITTER } from '../src/emit/paint/radius.ts';
import { div, expectCatalogued, explainOne, inputFor, spanTextOf } from './helpers.ts';

const SOURCE = { uri: 'dragon-source://test/radius.css', revision: 'r1', hash: 'sha256:0' };

function declare(property: string, value: string): { declaration: Declaration | null; diagnostics: Diagnostic[]; css: string } {
  const css = `.a { ${property}: ${value}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  return { declaration: rules[0]?.declarations[0] ?? null, diagnostics, css };
}

const spanOf = (css: string, d: Diagnostic): string => (d.origin.kind === 'authored' ? css.slice(d.origin.span.start, d.origin.span.end) : '<unlocated>');

function compile(css: string, targets: Targets = { ios: { minimum: '15.0' }, web: {} }) {
  const input = inputFor(`body { margin: 0; font-size: 20px; } ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'])])]);
  return { input, c: createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input) };
}

const CORNERS = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];

describe('border-radius: parse and computed values (Chrome 145 getComputedStyle)', () => {
  // [declaration, the four computed corners as Chrome 145 serializes them] (probed with the pinned Chrome)
  const cases: [string, string[]][] = [
    ['border-radius: 10px', ['10px', '10px', '10px', '10px']],
    ['border-radius: 10px 20px', ['10px', '20px', '10px', '20px']],
    ['border-radius: 10px / 20px', ['10px 20px', '10px 20px', '10px 20px', '10px 20px']],
    ['border-radius: 50%', ['50%', '50%', '50%', '50%']],
    ['border-radius: 1rem', ['16px', '16px', '16px', '16px']],
    ['border-radius: 2em', ['40px', '40px', '40px', '40px']],
    ['border-radius: 10px 20px 30px 40px / 5px 6px', ['10px 5px', '20px 6px', '30px 5px', '40px 6px']],
    ['border-radius: 0', ['0px', '0px', '0px', '0px']],
    ['border-radius: 1em/2em 3em', ['20px 40px', '20px 60px', '20px 40px', '20px 60px']],
    ['border-top-left-radius: 10px 10px', ['10px', '0px', '0px', '0px']],
    ['border-top-left-radius: 10px 20px', ['10px 20px', '0px', '0px', '0px']],
    ['border-top-left-radius: 0.35rem', ['5.6px', '0px', '0px', '0px']],
    ['border-top-left-radius: 0.5em 1rem', ['10px 16px', '0px', '0px', '0px']],
    ['border-top-left-radius: 1rem 16px', ['16px', '0px', '0px', '0px']],
    ['border-top-left-radius: 50% 50%', ['50%', '0px', '0px', '0px']],
    ['border-top-left-radius: 33.333%', ['33.333%', '0px', '0px', '0px']],
    ['border-top-left-radius: 1in 1pt', ['96px 1.3333333333333333px', '0px', '0px', '0px']],
    // -webkit-border-radius: Chrome's legacy parsing reads exactly two values with no "/" as horizontal / vertical.
    ['-webkit-border-radius: 10px', ['10px', '10px', '10px', '10px']],
    ['-webkit-border-radius: 10px 20px', ['10px 20px', '10px 20px', '10px 20px', '10px 20px']],
    ['-webkit-border-radius: 10px 20px 30px', ['10px', '20px', '30px', '20px']],
    ['-webkit-border-radius: 10px 20px / 5px', ['10px 5px', '20px 5px', '10px 5px', '20px 5px']],
    ['-webkit-border-radius: 1em 50%', ['20px 50%', '20px 50%', '20px 50%', '20px 50%']],
    ['-webkit-border-radius: 30px; border-radius: 4px', ['4px', '4px', '4px', '4px']],
    ['border-radius: 4px; -webkit-border-radius: 6px 2px', ['6px 2px', '6px 2px', '6px 2px', '6px 2px']],
  ];
  for (const [decl, want] of cases) {
    it(`${decl} computes to ${want.join(' | ')}`, () => {
      const { c } = compile(`.a { width: 100px; height: 50px; ${decl}; }`);
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(CORNERS.map((p) => explainOne(c, 'ios', 'a', p).value)).toEqual(want);
    });
  }

  it('a corner longhand with "/" or three values, a negative radius and a unitless non-zero radius are invalid, as in Chrome', () => {
    for (const [p, v] of [['border-top-left-radius', '10px / 20px'], ['border-top-left-radius', '10px 20px 30px'], ['border-radius', '-1px'], ['border-radius', '1px / 2px / 3px'], ['border-top-right-radius', '5']]) {
      const { declaration, diagnostics } = declare(p as string, v as string);
      expect(declaration, `${p}: ${v}`).toBeNull();
      expect(diagnostics.map((d) => d.code), `${p}: ${v}`).toEqual(['DRAGON_CSS_INVALID_VALUE']);
      expectCatalogued(diagnostics);
    }
  });

  it('CSS-wide keywords set each corner; inherit takes the parent computed corners', () => {
    const { c } = compile('.a { border-radius: 9px 3px; } .b { border-radius: inherit; } ');
    expect(CORNERS.map((p) => explainOne(c, 'ios', 'b', p).value)).toEqual(['9px', '3px', '9px', '3px']);
    const { declaration } = declare('border-radius', 'unset');
    expect(declaration?.longhands.map((l) => [l.property, l.value])).toEqual(CORNERS.map((p) => [p, { kind: 'keyword', value: 'unset' }]));
  });

  it('var() substitutes into the shorthand and the corner longhands', () => {
    const { c } = compile('.a { --r: 12px; --pair: 20px 6px; border-radius: var(--r); border-bottom-right-radius: var(--pair); }');
    expect(CORNERS.map((p) => explainOne(c, 'ios', 'a', p).value)).toEqual(['12px', '12px', '20px 6px', '12px']);
  });
});

describe('border-radius: refusals', () => {
  it('a calculation, a viewport unit and a font-metric unit in a radius are DRAGON_UNSUPPORTED_VALUE on the token', () => {
    for (const [p, v, span] of [['border-radius', 'calc(10px + 5%)', 'calc(10px + 5%)'], ['border-top-left-radius', '2vw 4px', '2vw'], ['border-radius', '1ex', '1ex'], ['border-radius', '10px / min(5px, 2%)', 'min(5px, 2%)']]) {
      const { declaration, diagnostics, css } = declare(p as string, v as string);
      expect(declaration, v).toBeNull();
      expect(diagnostics.map((d) => d.code), v).toEqual(['DRAGON_UNSUPPORTED_VALUE']);
      expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe(span);
      expectCatalogued(diagnostics);
    }
  });

  it('env() in a radius is refused by name, before the grammar substitutes it', () => {
    for (const p of ['border-radius', '-webkit-border-radius', 'border-top-left-radius']) {
      const { declaration, diagnostics, css } = declare(p, '4px env(safe-area-inset-top)');
      expect(declaration, p).toBeNull();
      expect(diagnostics.map((d) => [d.code, d.message]), p).toEqual([['DRAGON_UNSUPPORTED_VALUE', `${p}: env(safe-area-inset-top) is unsupported: env() in ${p} is not supported`]]);
      expect(spanOf(css, diagnostics[0] as Diagnostic)).toBe('env(safe-area-inset-top)');
    }
  });

  it('a rounded box with a dashed, dotted or double border side is refused for ios and android at the radius declaration (PNT1b), and not for web', () => {
    for (const style of ['dashed', 'dotted', 'double']) {
      const { c, input } = compile(`.a { width: 40px; height: 20px; border: 2px ${style} blue; border-radius: 6px; }`, { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} });
      const refused = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
      expect(refused.map((d) => d.target).sort(), style).toEqual(['android', 'ios']);
      for (const d of refused) {
        expect(spanTextOf(input, d)).toBe('6px');
        expect(d.message).toContain(`rounded ${style} borders are PNT1b`);
      }
      expectCatalogued(refused);
    }
  });

  it('a rounded html, body or replaced element is refused for ios and android at the radius declaration, and not for web', () => {
    const targets: Targets = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} };
    for (const [tag, css, says] of [['html', 'html { border-radius: 8px; }', 'propagates to the canvas'], ['body', 'body { border-radius: 8px; }', 'propagates to the canvas'], ['img', '.i { width: 20px; height: 20px; border-radius: 8px; }', 'draws replaced content square']] as const) {
      const input = inputFor(`body { margin: 0; } ${css}`, (r) => [{ ...div(r, 'i', ['i']), tag: 'img', attributes: [] } as never]);
      const c = createProjectWith({ projectId: 'test', targets }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
      const refused = c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE' && d.message.includes('rounds its corners'));
      expect(refused.map((d) => d.target).sort(), tag).toEqual(['android', 'ios']);
      for (const d of refused) {
        expect(spanTextOf(input, d), tag).toBe('8px');
        expect(d.message, tag).toContain(says);
      }
      expectCatalogued(refused);
    }
  });

  it('square corners with a dashed border, a zero-width dashed side and a solid rounded border are not refused', () => {
    for (const css of ['.a { border: 2px dashed blue; }', '.a { border: 2px solid blue; border-left: 0 dashed red; border-radius: 6px; }', '.a { border: 2px solid blue; border-radius: 6px 0 / 0 6px; border-style: dashed; }']) {
      const { c } = compile(css);
      expect(c.diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE'), css).toEqual([]);
    }
  });
});

describe('border-radius: lowering and emission', () => {
  const programs = (css: string) => {
    const { c } = compile(css, { ios: { minimum: '15.0' }, android: { minSdk: 31 } });
    const p = nativePrograms(c, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    return p.programs;
  };

  it('a box with a rounded corner gets one border-radius write of eight components and radius facts; square boxes get none', () => {
    const p = programs('.a { width: 100px; height: 50px; border-radius: 10px 50% / 1rem 2px; } .b { border-radius: 0 10px / 10px 0; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const lengths = [
      { percent: false, value: 10 }, { percent: true, value: 50 }, { percent: false, value: 10 }, { percent: true, value: 50 },
      { percent: false, value: 16 }, { percent: false, value: 2 }, { percent: false, value: 16 }, { percent: false, value: 2 },
    ];
    expect(a?.writes.filter((w) => w.kind === 'border-radius')).toEqual([expect.objectContaining({ kind: 'border-radius', key: 'dragonRadius.radiiPx', technique: 'dragon-owned-paint', lengths })]);
    expect(a?.facts).toEqual({ radius: { lengths } });
    const b = p['android-views'].nodes.find((n) => n.id === 'b');
    expect(b?.writes.some((w) => w.kind === 'border-radius')).toBe(false);
    expect(b?.facts).toEqual({});
  });

  it('emits the runtime writer on both backends and expects the clamped outer radii in device px', () => {
    const p = programs('.a { width: 100px; height: 40px; border-radius: 60px; }');
    const a = p.uikit.nodes.find((n) => n.id === 'a');
    const w = a?.writes.find((x) => x.kind === 'border-radius');
    if (w === undefined || w.kind !== 'border-radius') throw new Error('no radius write');
    expect(RADIUS_EMITTER.lines.uikit('v0', a as never, w)).toEqual(['  dragonSetRadii(v0, [RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0), RadiusLength(false, 60.0)])']);
    expect(RADIUS_EMITTER.lines['android-views']('v0', a as never, w)[0]).toMatch(/^ {2}dragonSetRadii\(v0, arrayOf\(RadiusLength\(false, 60\.0\)/);
    const box = { left: 0, top: 0, right: 200, bottom: 80, width: 200, height: 80 } as never;
    const applied = RADIUS_EMITTER.applied({ paint: { roundedShape } } as never, 'uikit', w, 2, { border: [0, 0, 0, 0], box, size: [200, 80], fontSize: null, replaced: null });
    // 120 + 120 device px over an 80 px side: the §5.5 factor 80 / 240 scales every radius to 40.
    expect(applied).toEqual([40, 40, 40, 40, 40, 40, 40, 40]);
  });
});
