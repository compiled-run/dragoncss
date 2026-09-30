// css-values-4 §6 length units: the conversion ratios, em and rem resolution (with em compounding through font-size), the precise
// refusals, and that computed px values reach the layout projection while the declared unit keeps its own feature key.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import { compiledFeatures, createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import { lengthToPx, mathFunctionRefusal, unitRefusal } from '../src/css/units.ts';
import { parseMath } from '../src/css/math.ts';
import { div, inputFor, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, direction: 'ltr', rootFont: 'ua-default' } as const;
const project = () => createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' });

function find(b: LayoutBox, id: string): LayoutBox {
  if (b.id === id) return b;
  for (const c of b.children) {
    if (c.kind !== 'box') continue;
    const hit = find(c, id);
    if (hit.id === id) return hit;
  }
  return b;
}

function style(css: string, tree: Parameters<typeof inputFor>[1], id: string): LayoutBox {
  const c = project().compile(inputFor(`${FONT} ${css}`, tree));
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(`${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
  return find(p.input.root, id);
}

describe('unit registry conversions', () => {
  it('absolute units use the Blink ratios in double', () => {
    const none = { em: 0, rem: 0 };
    expect(lengthToPx(1, 'in', none)).toBe(96);
    expect(lengthToPx(1, 'cm', none)).toBe(96 / 2.54);
    expect(lengthToPx(1, 'mm', none)).toBe(96 / 2.54 / 10);
    expect(lengthToPx(1, 'q', none)).toBe(96 / 2.54 / 10 / 4);
    expect(lengthToPx(3, 'pt', none)).toBe(4);
    expect(lengthToPx(1.5, 'pc', none)).toBe(24);
    expect(lengthToPx(2, 'em', { em: 13.3, rem: 16 })).toBe(26.6);
    expect(lengthToPx(2, 'rem', { em: 13.3, rem: 16 })).toBe(32);
    expect(lengthToPx(1, 'vw', none)).toBeNull();
  });
  it('viewport, font-metric, line-height and container units and math functions are refused with a reason', () => {
    for (const u of ['svh', 'lvh', 'dvh', 'svw', 'ex', 'ch', 'cap', 'ic', 'lh', 'rlh', 'cqw']) expect(unitRefusal(u), u).not.toBeNull();
    for (const u of ['px', 'cm', 'mm', 'q', 'in', 'pt', 'pc', 'em', 'rem', 'furlong']) expect(unitRefusal(u), u).toBeNull();
    for (const f of ['round', 'mod', 'rem', 'abs', 'sign', 'env', 'ROUND']) expect(mathFunctionRefusal(f), f).not.toBeNull();
    expect(mathFunctionRefusal('rgb')).toBeNull();
  });
  it('V1 of the value model accepts vw, vh, vi, vb, vmin and vmax, and calc(), min(), max() and clamp(); the engine resolves them', () => {
    for (const u of ['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax']) {
      expect(unitRefusal(u), u).toBeNull();
      expect(lengthToPx(1, u, { em: 0, rem: 0 }), u).toBeNull();
    }
    for (const f of ['calc', 'min', 'max', 'clamp', 'CALC']) expect(mathFunctionRefusal(f), f).toBeNull();
  });
});

describe('computed lengths', () => {
  it('em in font-size compounds from the parent; em elsewhere uses the element font-size; rem uses the root', () => {
    const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'o', ['o'], [div(r, 'i', ['i'], [text(r, 't', 'X')])])];
    const i = style('.o { font-size: 1.5em; } .i { font-size: 0.5em; width: 2em; padding-left: 1rem; margin-top: 1in; border-left: 3pt solid; }', tree, 'i');
    expect(i.style.width).toEqual({ kind: 'px', value: 15 });
    expect(i.style.paddingLeft).toEqual({ kind: 'px', value: 16 });
    expect(i.style.marginTop).toEqual({ kind: 'px', value: 96 });
  });
  it('rem on the root font-size resolves against the initial font-size, and every rem then uses it', () => {
    const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'])];
    const a = style('html { font-size: 1.25rem; } .a { width: 2rem; height: 1em; }', tree, 'a');
    expect(a.style.width).toEqual({ kind: 'px', value: 40 });
    expect(a.style.height).toEqual({ kind: 'px', value: 10 });
  });
  it('the feature key keeps the declared unit', () => {
    const c = project().compile(inputFor(`${FONT} .a { width: 2em; height: 1cm; }`, (r) => [div(r, 'a', ['a'])]));
    const keys = compiledFeatures(c, 'ios', []);
    expect(keys).toContain('width:<length-em>@block/ltr');
    expect(keys).toContain('height:<length-cm>@block/ltr');
  });
  it('a refused unit is DRAGON_UNSUPPORTED_VALUE at its token, with the reason', () => {
    const c = project().compile(inputFor(`${FONT} .a { width: 50svw; }`, (r) => [div(r, 'a', ['a'])]));
    const d = c.diagnostics.find((x) => x.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(d?.message).toMatch(/^width: 50svw is unsupported: small, large and dynamic viewport units need the viewport inputs of the value-model package V2/);
  });
  it('a viewport unit and a calculation reach the layout projection as engine calculations, with em as a leaf of the element font size', () => {
    const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'a', ['a'])];
    const a = style('.a { width: 50vw; height: calc(10px + 2em); }', tree, 'a');
    expect(a.style.width).toEqual({ kind: 'calc', expr: { kind: 'viewport', value: 50, axis: 'width', size: 'large' }, range: 'non-negative' });
    expect(a.style.height).toEqual({ kind: 'calc', expr: { kind: 'sum', terms: [{ kind: 'px', value: 10 }, { kind: 'em', value: 2, fontSize: { kind: 'px', value: 10 } }] }, range: 'non-negative' });
  });
});

describe('math function checks', () => {
  const LENGTH = { type: 'length', percent: true } as const;
  it('a division by zero is refused when the dividend is not a literal the parser folds (10vi, a sum with a percentage)', () => {
    for (const t of ['calc(10vi / 0)', 'calc(10vb / (1 - 1))', 'calc((100% - 10px) / 0)', 'calc(10px / 0)', 'calc(1vi * (1 / 0))']) {
      const r = parseMath(t, LENGTH);
      expect(r.ok, t).toBe(false);
      if (!r.ok) expect(r.reason, t).toContain('divides by zero');
    }
    expect(parseMath('calc(10vi / 4)', LENGTH).ok).toBe(true);
  });
  it('nested functions count toward the nesting limit, as nested parentheses do', () => {
    const nest = (n: number, open: (inner: string) => string): string => {
      let t = '1px';
      for (let i = 0; i < n; i++) t = open(t);
      return t;
    };
    expect(parseMath(`calc(${nest(30, (x) => `min(${x}, 2%)`)})`, LENGTH).ok).toBe(true);
    expect(parseMath(`calc(${nest(40, (x) => `min(${x}, 2%)`)})`, LENGTH).ok).toBe(false);
    expect(parseMath(`calc(${nest(40, (x) => `(${x})`)})`, LENGTH).ok).toBe(false);
    // Far past the limit the parser refuses instead of overflowing the stack.
    expect(parseMath(`calc(${nest(5000, (x) => `max(${x}, 1%)`)})`, LENGTH).ok).toBe(false);
  });
  it('a negative flex-grow or flex-shrink calculation is clamped to 0 (css-values-4 §10.10), in the longhands and the flex shorthand', () => {
    const tree = (r: Parameters<Parameters<typeof inputFor>[1]>[0]) => [div(r, 'o', ['o'], [div(r, 'i', ['i'], [text(r, 't', 'X')])])];
    const a = style('.o { display: flex; } .i { flex-grow: calc(-1); flex-shrink: calc(0 - 3); }', tree, 'i');
    expect([a.style.flexGrow, a.style.flexShrink]).toEqual([0, 0]);
    const b = style('.o { display: flex; } .i { flex: calc(-2) calc(2 - 5) 0px; }', tree, 'i');
    expect([b.style.flexGrow, b.style.flexShrink]).toEqual([0, 0]);
    const c = style('.o { display: flex; } .i { flex-grow: calc(1 + 1); flex-shrink: calc(3 / 2); }', tree, 'i');
    expect([c.style.flexGrow, c.style.flexShrink]).toEqual([2, 1.5]);
  });
});
