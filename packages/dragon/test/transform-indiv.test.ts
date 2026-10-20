// PNT2 (css-transforms-2 §4): the individual transforms translate, rotate and scale. They parse as Chrome 145 does and compute alike
// (packages/parity/test/transform-indiv-parse.test.ts pins that against Chrome), their 2D parts compose before transform about
// transform-origin into the one native transform write, a z translation, another rotation axis and a z scale are refused naming
// PNT2-m, a composition that skews is refused, and each makes a stacking context and a containing block as transform does. The Chrome
// cases are transform-indiv-values, transform-indiv-compose and the reject-transform-indiv-* fixtures (packages/parity/fixtures).
import { describe, expect, it } from 'vitest';
import type { TransformOp } from '@dragon/layout';
import type { Compiled, FrontEndResult } from '../src/index.ts';
import { createProjectWith, nativePrograms, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import { valueToString } from '../src/analysis/computed.ts';
import { ANIMATION_KINDS } from '../src/css/animation-kinds.ts';
import { UNADMITTED } from '../src/css/animation-kinds/kinds.ts';
import { LONGHANDS } from '../src/css/properties.ts';
import { parseStylesheet } from '../src/css/stylesheet.ts';
import type { Diagnostic } from '../src/types.ts';
import { div, inputFor, spanTextOf, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const SOURCE = { uri: 'dragon-source://test/transform-indiv.css', revision: 'r1', hash: 'sha256:0' };
type Body = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => ReturnType<Parameters<typeof inputFor>[1]>;

function compile(css: string, body: Body = (r) => [div(r, 'a', ['a'], [text(r, 't', 'XX')])]): { input: FrontEndResult; c: Compiled<'ios' | 'android' | 'web'> } {
  const input = inputFor(`${FONT} ${css}`, body);
  const c = createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(input);
  return { input, c };
}

const errors = (r: { input: FrontEndResult; c: Compiled<'ios' | 'android' | 'web'> }): string[] => r.c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${JSON.stringify(spanTextOf(r.input, d))} ${d.message}`);

/** The declared value one declaration sets, `dropped` when Chrome drops it, or `refused <message>`. */
function parsed(decl: string): string {
  const css = `.a { ${decl}; }`;
  const diagnostics: Diagnostic[] = [];
  const rules = parseStylesheet(css, { source: SOURCE, start: 0, end: css.length }, { id: 's', owner: 'doc', scope: 'document' }, 0, diagnostics);
  if (diagnostics.some((d) => d.code === 'DRAGON_CSS_INVALID_VALUE')) return 'dropped';
  if (diagnostics.length > 0) return diagnostics.map((d) => `refused ${d.message}`).join('; ');
  const l = rules[0]?.declarations[0]?.longhands ?? [];
  if (l.length !== 1) throw new Error(`${decl}: ${l.length} longhands`);
  return valueToString((l[0] as (typeof l)[number]).value);
}

function webRule(r: { c: Compiled<'ios' | 'android' | 'web'> }): string {
  const web = r.c.outputs.web;
  if (web.kind !== 'ready') throw new Error('web output blocked');
  return web.files.find((f) => f.path === WEB_CSS_PATH)?.text ?? '';
}

function uikit(r: { c: Compiled<'ios' | 'android' | 'web'> }, id: string) {
  const p = nativePrograms(r.c, []);
  if (p.kind !== 'ready') throw new Error(p.reason);
  const n = p.programs.uikit.nodes.find((x) => x.id === id);
  if (n === undefined) throw new Error(`no node ${id}`);
  return n;
}

const px = (v: number) => ({ kind: 'px', px: v, percent: 0 });
const pct = (v: number) => ({ kind: 'percent', px: 0, percent: v });

describe('translate, rotate and scale: the registry and the parse', () => {
  it('follow will-change in the transform family and interpolate in Chrome without a writer yet', () => {
    expect(LONGHANDS.slice(LONGHANDS.indexOf('transform'), LONGHANDS.indexOf('transform') + 6)).toEqual(['transform', 'transform-origin', 'will-change', 'translate', 'rotate', 'scale']);
    for (const p of ['translate', 'rotate', 'scale'] as const) expect(ANIMATION_KINDS[p], p).toBe(UNADMITTED);
  });

  it('parse as Chrome 145 does and compute to x and y: a zero z translation and a z axis are dropped, a percentage scale is a number', () => {
    const want: [string, string][] = [
      ['translate: none', 'none'], ['translate: NONE', 'none'], ['translate: 10px', '10px 0px'], ['translate: 10px 20px', '10px 20px'], ['translate: 10px 0', '10px 0px'],
      ['translate: 10px 0%', '10px 0%'], ['translate: 0 0', '0px 0px'], ['translate: 10px 20px 0', '10px 20px'], ['translate: 0px 0px 0px', '0px 0px'], ['translate: 50% 25%', '50% 25%'],
      ['translate: 1em 2rem', '1em 2rem'], ['translate: -0px', '0px 0px'], ['translate: 1e3px', '1000px 0px'],
      ['rotate: none', 'none'], ['rotate: 45deg', '45deg'], ['rotate: 0deg', '0deg'], ['rotate: 1turn', '360deg'], ['rotate: 100grad', '90deg'], ['rotate: z 45deg', '45deg'],
      ['rotate: 45deg z', '45deg'], ['rotate: Z 45DEG', '45deg'], ['rotate: 0 0 1 45deg', '45deg'], ['rotate: 0 0 2 45deg', '45deg'], ['rotate: 45deg 0 0 1', '45deg'], ['rotate: -90deg', '-90deg'],
      ['rotate: 0 0 0.5 30deg', '30deg'],
      ['scale: none', 'none'], ['scale: 2', '2 2'], ['scale: 2 3', '2 3'], ['scale: 2 2', '2 2'], ['scale: 2 2 1', '2 2'], ['scale: 2 3 1', '2 3'], ['scale: 50%', '0.5 0.5'],
      ['scale: 50% 200%', '0.5 2'], ['scale: 200% 2', '2 2'], ['scale: 0', '0 0'], ['scale: -1 1', '-1 1'], ['scale: 1 1 1', '1 1'], ['scale: 50% 50% 100%', '0.5 0.5'],
    ];
    for (const [d, v] of want) expect(parsed(d), d).toBe(v);
    expect(parsed('rotate: 0.5rad')).toBe(`${0.5 * (180 / Math.PI)}deg`);
  });

  it('drop every value Chrome drops', () => {
    for (const d of ['translate: 10', 'translate: 10px 20px 5%', 'translate: 10px,20px', 'translate: 10px 20px 30px 40px', 'translate: none 10px', 'translate: auto', 'rotate: 0', 'rotate: x', 'rotate: 45', 'rotate: 45deg 10deg', 'scale: 2,3', 'scale: 2px', 'scale: 2 3 4 5', 'scale: none 2']) {
      expect(parsed(d), d).toBe('dropped');
    }
  });

  it('refuse a z translation, a rotation about another axis and a z scale naming PNT2-m, and the forms transform functions refuse', () => {
    const refused: [string, string][] = [
      ['translate: 10px 20px 5px', 'a z translation moves the box off the plane'], ['translate: 10px 0 1em', 'a z translation'],
      ['rotate: x 45deg', 'a rotation axis other than z'], ['rotate: 45deg y', 'a rotation axis other than z'], ['rotate: 1 0 0 45deg', 'a rotation axis other than z'],
      ['rotate: 0 0 -1 45deg', 'a rotation axis other than z'], ['rotate: 0 0 0 45deg', 'a rotation axis other than z'], ['rotate: x 0deg', 'a rotation axis other than z'],
      ['scale: 2 3 4', 'a z scale is a 3D transform'], ['scale: 1 1 2', 'a z scale is a 3D transform'],
    ];
    for (const [d, m] of refused) {
      expect(parsed(d), d).toContain(m);
      expect(parsed(d), d).toContain('PNT2-m');
    }
    expect(parsed('translate: calc(10px + 5%)')).toContain('calc() in translate is not supported yet');
    expect(parsed('translate: 5vw')).toContain('vw in translate would be resolved');
    expect(parsed('rotate: calc(45deg)')).toContain('calc() in rotate is not supported yet');
    expect(parsed('scale: calc(2)')).toContain('calc() in scale is not supported yet');
    expect(parsed('scale: 1e39')).toContain('is out of range');
  });

  it('locate a refusal at the 3D part, once for every target as it parses', () => {
    const at = (css: string): string[] => errors(compile(css)).map((e) => /^\S+ \S+ "[^"]*"/.exec(e)?.[0] ?? e);
    expect(at('.a { translate: 1px 2px 3px; }')).toEqual(['null DRAGON_UNSUPPORTED_VALUE "3px"']);
    expect(at('.a { rotate: 1 1 0 9deg; }')).toEqual(['null DRAGON_UNSUPPORTED_VALUE "1"']);
    expect(at('.a { scale: 1 2 3; }')).toEqual(['null DRAGON_UNSUPPORTED_VALUE "3"']);
  });
});

describe('translate, rotate and scale: the computed values and the web output', () => {
  it('compute translate lengths in px and write each where one is not none, else none of them', () => {
    const r = compile('.a { font-size: 20px; translate: 1em 2rem; rotate: 0.25turn; scale: 150% 2; }');
    expect(errors(r)).toEqual([]);
    expect(webRule(r)).toContain('translate: 20px 32px;');
    expect(webRule(r)).toContain('rotate: 90deg;');
    expect(webRule(r)).toContain('scale: 1.5 2;');
    const s = compile('.a { rotate: 10deg; }');
    expect(webRule(s)).toContain('translate: none;');
    expect(webRule(s)).toContain('scale: none;');
    expect(webRule(compile(''))).not.toMatch(/(^|[^-])(translate|rotate|scale):/m);
  });

  it('write a declaration through var() after substitution through the same rules', () => {
    const ok = compile('.a { --t: 10% 2px; translate: var(--t); }');
    expect(errors(ok)).toEqual([]);
    expect(webRule(ok)).toContain('translate: 10% 2px;');
    expect(errors(compile('.a { --r: x 3deg; rotate: var(--r); }')).join()).toContain('PNT2-m');
  });
});

describe('translate, rotate and scale: the effective transform', () => {
  it('composes translate, rotate, scale, then transform, about transform-origin, in one write', () => {
    const r = compile('.a { width: 40px; height: 20px; transform: translateX(3px) rotate(-90deg); scale: 2 3; rotate: 90deg; translate: -50% 4px; transform-origin: 0 0; }');
    expect(errors(r)).toEqual([]);
    const n = uikit(r, 'a');
    const w = n.writes.find((x) => x.kind === 'transform') as unknown as { ops: TransformOp[]; css: string[]; origin: unknown };
    expect(w.css).toEqual(['transform', 'translate', 'rotate', 'scale', 'transform-origin']);
    expect(w.ops).toMatchObject([
      { fn: 'translate', x: pct(-50), y: px(4) },
      { fn: 'rotate', angle: 90 },
      { fn: 'scale', sx: 2, sy: 3 },
      { fn: 'translateX', x: px(3) },
      { fn: 'rotate', angle: -90 },
    ]);
    expect(w.origin).toEqual({ x: px(0), y: px(0) });
  });

  it('writes an individual transform alone, and nothing for none', () => {
    for (const [css, op] of [['translate: 5px', { fn: 'translate', x: px(5), y: px(0) }], ['rotate: 1turn', { fn: 'rotate', angle: 360 }], ['scale: 0.5', { fn: 'scale', sx: 0.5, sy: 0.5 }]] as const) {
      const w = uikit(compile(`.a { ${css}; }`), 'a').writes.find((x) => x.kind === 'transform') as unknown as { ops: TransformOp[] };
      expect(w.ops, css).toMatchObject([op]);
    }
    expect(uikit(compile('.a { translate: none; rotate: none; scale: none; }'), 'a').writes.some((x) => x.kind === 'transform')).toBe(false);
  });

  it('refuses a composition with a rotation after a non-uniform scale, and accepts the orthogonal ones', () => {
    for (const css of ['scale: 2 1; transform: rotate(30deg)', 'scale: 2 1; rotate: 0deg; transform: rotate(45deg)']) {
      const e = errors(compile(`.a { ${css}; }`));
      expect(e, css).toHaveLength(3);
      expect(e[0], css).toContain('compose to a rotation after a non-uniform scale');
    }
    for (const css of ['rotate: 30deg; scale: 2 1', 'scale: 2 1; transform: rotate(90deg)', 'scale: 2; transform: rotate(30deg)', 'translate: 3px; scale: 2 1; transform: translate(1px)']) {
      expect(errors(compile(`.a { ${css}; }`)), css).toEqual([]);
    }
  });

  it('makes a stacking context and a containing block, as transform does', () => {
    const abs: Body = (r) => [div(r, 'a', ['a'], [div(r, 'p', ['p'])])];
    for (const css of ['translate: 0px', 'rotate: 0deg', 'scale: 1']) {
      const e = errors(compile(`.a { ${css}; } .p { position: absolute; }`, abs));
      expect(e.join(), css).toContain('the containing block of the absolutely positioned p');
      expect(e[0], css).toContain(`"${css.split(': ')[1] as string}"`);
      expect(errors(compile(`.a { position: relative; ${css}; } .p { position: absolute; }`, abs)), css).toEqual([]);
      const stacking = uikit(compile(`.a { ${css}; }`), 'a').facts['stacking'] as { layer: string };
      expect(stacking.layer, css).not.toBe('flow');
    }
    expect(errors(compile('body { scale: 2; }')).join()).toContain('a transform on <body>');
  });
});
