// css-env-1 env(safe-area-inset-*) (ENV-SAFE): accepted wherever a length is, emitted as written for web, lowered to the engine's
// EnvLength for native, keyed <env()> so only its own profile rows prove it, and every other environment variable refused by name.
import { describe, expect, it } from 'vitest';
import type { CalcExpr, LayoutBox } from '@dragon/layout';
import type { CompilerFaults } from '../src/internal.ts';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS, WEB_CSS_PATH } from '../src/internal.ts';
import { envAsZero } from '../src/css/env.ts';
import { mathFunctionRefusal } from '../src/css/units.ts';
import { div, inputFor } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const project = (faults: CompilerFaults = NO_FAULTS, profiles: 'derive' | 'enforce' = 'derive') =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles, direction: 'ltr' });
const tree = (ref: Parameters<typeof div>[0]) => [div(ref, 'x', ['x'])];
const compile = (css: string, faults: CompilerFaults = NO_FAULTS, profiles: 'derive' | 'enforce' = 'derive') => project(faults, profiles).compile(inputFor(`${FONT} ${css}`, tree));

function find(b: LayoutBox, id: string): LayoutBox | null {
  if (b.id === id) return b;
  for (const c of b.children) {
    if (c.kind !== 'box') continue;
    const hit = find(c, id);
    if (hit !== null) return hit;
  }
  return null;
}

function styleOf(css: string, faults: CompilerFaults = NO_FAULTS): LayoutBox['style'] {
  const c = compile(css, faults);
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(`${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
  const box = find(p.input.root, 'x');
  if (box === null) throw new Error('no box x');
  return box.style;
}

function webCss(css: string, faults: CompilerFaults = NO_FAULTS): string {
  const web = compile(css, faults).outputs.web;
  if (web.kind !== 'ready') throw new Error('web output not ready');
  return (web.files.find((f) => f.path === WEB_CSS_PATH) as { text: string }).text;
}

const env = (side: 'top' | 'right' | 'bottom' | 'left', value = 1): CalcExpr => ({ kind: 'env', value, side });

describe('env(safe-area-inset-*) is accepted wherever a length is', () => {
  it('alone, with a fallback, and in the padding, margin and inset longhands and shorthands', () => {
    const s = styleOf('.x { position: absolute; width: env(safe-area-inset-top); height: env(safe-area-inset-bottom, 20px); padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left); margin-bottom: env(safe-area-inset-bottom); top: env(safe-area-inset-top); left: env(safe-area-inset-left); }');
    expect(s.width).toEqual({ kind: 'calc', expr: env('top'), range: 'non-negative' });
    expect(s.height).toEqual({ kind: 'calc', expr: env('bottom'), range: 'non-negative' });
    expect([s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft]).toEqual([
      { kind: 'calc', expr: env('top'), range: 'non-negative' },
      { kind: 'calc', expr: env('right'), range: 'non-negative' },
      { kind: 'px', value: 0 },
      { kind: 'calc', expr: env('left'), range: 'non-negative' },
    ]);
    expect(s.marginBottom).toEqual({ kind: 'calc', expr: env('bottom'), range: 'all' });
    expect(s.top).toEqual({ kind: 'calc', expr: env('top'), range: 'all' });
    expect(s.left).toEqual({ kind: 'calc', expr: env('left'), range: 'all' });
  });

  it('inside calc(), min(), max() and clamp(): the inset stays a leaf the engine reads, and subtraction negates it exactly', () => {
    const s = styleOf('.x { width: calc(100% - env(safe-area-inset-left) - env(safe-area-inset-right)); height: max(env(safe-area-inset-bottom), 12px); padding-top: calc(env(safe-area-inset-top) + 8px); padding-left: min(env(safe-area-inset-left), 5%); padding-bottom: clamp(4px, env(safe-area-inset-bottom), 30px); }');
    expect(s.width).toEqual({ kind: 'calc', expr: { kind: 'sum', terms: [{ kind: 'percent', value: 100 }, env('left', -1), env('right', -1)] }, range: 'non-negative' });
    expect(s.height).toEqual({ kind: 'calc', expr: { kind: 'max', terms: [env('bottom'), { kind: 'px', value: 12 }] }, range: 'non-negative' });
    expect(s.paddingTop).toEqual({ kind: 'calc', expr: { kind: 'sum', terms: [env('top'), { kind: 'px', value: 8 }] }, range: 'non-negative' });
    expect(s.paddingLeft).toEqual({ kind: 'calc', expr: { kind: 'min', terms: [env('left'), { kind: 'percent', value: 5 }] }, range: 'non-negative' });
    expect(s.paddingBottom).toEqual({ kind: 'calc', expr: { kind: 'clamp', min: { kind: 'px', value: 4 }, value: env('bottom'), max: { kind: 'px', value: 30 } }, range: 'non-negative' });
  });

  it('web output keeps env() as written; the feature key is <env()>, alone or inside a math function', () => {
    const css = '.x { width: env(safe-area-inset-top, 20px); padding-top: calc(env(safe-area-inset-top) + 8px); height: 10px; }';
    const out = webCss(css);
    expect(out).toContain('width: env(safe-area-inset-top,20px);');
    expect(out).toContain('padding-top: calc(env(safe-area-inset-top) + 8px);');
    const c = compile(css);
    for (const t of ['ios', 'web'] as const) {
      const keys = compiledFeatures(c, t, []);
      expect(keys.some((k) => k.startsWith('width:<env()>@')), t).toBe(true);
      expect(keys.some((k) => k.startsWith('padding-top:<env()>@')), t).toBe(true);
      expect(keys.some((k) => k.startsWith('padding-top:<calc()>@')), t).toBe(false);
    }
  });

  it('through var(): a custom property holding env() substitutes it', () => {
    const s = styleOf(':root { --top: env(safe-area-inset-top); } .x { padding-top: var(--top); margin-top: calc(var(--top) + 2px); }');
    expect(s.paddingTop).toEqual({ kind: 'calc', expr: env('top'), range: 'non-negative' });
    expect(s.marginTop).toEqual({ kind: 'calc', expr: { kind: 'sum', terms: [env('top'), { kind: 'px', value: 2 }] }, range: 'all' });
  });

  it('env() is no longer a refused math function', () => {
    expect(mathFunctionRefusal('env')).toBeNull();
  });
});

describe('what env() refuses, by name', () => {
  const refusal = (css: string): string => {
    const c = compile(css, NO_FAULTS, 'enforce');
    const d = c.diagnostics.find((x) => x.severity === 'error');
    if (d === undefined) throw new Error(`no error for ${css}`);
    expect(c.outputs.web.kind, css).toBe('blocked');
    expect(c.outputs.ios.kind, css).toBe('blocked');
    return `${d.code} ${d.message}`;
  };
  it('every name but the four insets, a misplaced call, and a calculation the inset cannot complete', () => {
    expect(refusal('.x { width: env(safe-area-max-inset-top); }')).toMatch(/^DRAGON_UNSUPPORTED_VALUE width: env\(safe-area-max-inset-top\) is unsupported: .*collapsing toolbars/);
    expect(refusal('.x { width: env(keyboard-inset-height, 0px); }')).toMatch(/^DRAGON_UNSUPPORTED_VALUE .*on-screen keyboard.*KBD/);
    expect(refusal('.x { width: env(nope, 5px); }')).toMatch(/^DRAGON_UNSUPPORTED_VALUE .*env\(nope\) is not a safe-area inset, so Chrome uses its fallback/);
    expect(refusal('.x { width: env(nope); }')).toMatch(/Chrome 145 does not define it/);
    expect(refusal('.x { width: env(SAFE-AREA-INSET-TOP, 5px); }')).toMatch(/case-sensitive/);
    expect(refusal('.x { width: calc(1px + env(safe-area-max-inset-left)); }')).toMatch(/^DRAGON_UNSUPPORTED_VALUE width: env\(safe-area-max-inset-left\)/);
    expect(refusal('.x { background-color: rgb(env(safe-area-inset-top) 0 0); }')).toMatch(/env\(\) is supported only as a length/);
    expect(refusal('.x { transform: translateX(env(safe-area-inset-top)); }')).toMatch(/env\(\) in transform is not supported/);
    expect(refusal('.x { width: calc(env(safe-area-inset-top) + 2); }')).toMatch(/^DRAGON_UNSUPPORTED_VALUE .*adds a number and a length/);
    expect(refusal('.x { font-size: env(safe-area-inset-top); }')).toMatch(/^DRAGON_UNSUPPORTED_VALUE .*font-size/);
    expect(refusal('.x { color: env(safe-area-inset-top); }')).toMatch(/^DRAGON_CSS_INVALID_VALUE/);
  });
});

describe('planted faults', () => {
  it('envResolvedToZero writes 0px for every env() call', () => {
    expect(envAsZero('calc(env(safe-area-inset-top, calc(1px + 2px)) + env(safe-area-inset-left))')).toBe('calc(0px + 0px)');
    expect(webCss('.x { width: env(safe-area-inset-top); padding-top: calc(env(safe-area-inset-top) + 8px); }', { ...NO_FAULTS, envResolvedToZero: true })).toMatch(/width: 0px;[\s\S]*padding-top: calc\(0px \+ 8px\);/);
  });
  it('envSideSwapped lowers each inset to the opposite side', () => {
    const s = styleOf('.x { width: env(safe-area-inset-top); padding-left: calc(env(safe-area-inset-left) + 1px); }', { ...NO_FAULTS, envSideSwapped: true });
    expect(s.width).toEqual({ kind: 'calc', expr: env('bottom'), range: 'non-negative' });
    expect(s.paddingLeft).toEqual({ kind: 'calc', expr: { kind: 'sum', terms: [env('right'), { kind: 'px', value: 1 }] }, range: 'non-negative' });
  });
});
