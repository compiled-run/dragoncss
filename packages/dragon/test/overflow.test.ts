// OVFL Phase A in the compiler (T078J design A): every computed overflow pair compiles but clip beside visible (OVFL-c), html
// and body overflow is resolved by viewport propagation in the lowering (css-overflow-3 §3.3), and the engine input carries the
// used values. Chrome agreement is proven by the overflow fixture group (packages/parity).
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { FrontEndResult } from '../src/index.ts';
import { createProjectWith, iosLayoutProjection, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { div, inputFor, spanTextOf, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, rootFont: 'ua-default', direction: 'ltr' } as const;
const compile = (input: FrontEndResult, faults: CompilerFaults = NO_FAULTS) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' }).compile(input);
const one = (css: string): FrontEndResult => inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);

function root(input: FrontEndResult, faults: CompilerFaults = NO_FAULTS): LayoutBox {
  const c = compile(input, faults);
  const p = iosLayoutProjection(c, ENV, []);
  if (p.kind !== 'ready') throw new Error(`${p.reason} ${c.diagnostics.map((d) => d.message).join('; ')}`);
  return p.input.root;
}
const find = (b: LayoutBox, id: string): LayoutBox => {
  if (b.id === id) return b;
  for (const c of b.children) {
    if (c.kind !== 'box') continue;
    const f = find(c, id);
    if (f.id === id) return f;
  }
  return b;
};
const axes = (b: LayoutBox, id: string): [string, string] => {
  const f = find(b, id);
  if (f.id !== id) throw new Error(`no box ${id}`);
  return [f.style.overflowX, f.style.overflowY];
};

describe('OVFL compiler: overflow values', () => {
  it('auto, scroll, clip and hidden lower as written; hidden beside visible computes to auto', () => {
    expect(axes(root(one('.a { overflow: auto; } .b { overflow: scroll; }')), 'a')).toEqual(['auto', 'auto']);
    expect(axes(root(one('.a { overflow: auto; } .b { overflow: scroll; }')), 'b')).toEqual(['scroll', 'scroll']);
    expect(axes(root(one('.a { overflow: clip; }')), 'a')).toEqual(['clip', 'clip']);
    expect(axes(root(one('.a { overflow-x: hidden; }')), 'a')).toEqual(['hidden', 'auto']);
    expect(axes(root(one('.a { overflow-x: clip; overflow-y: scroll; }')), 'a')).toEqual(['hidden', 'scroll']);
  });

  it('clip beside visible is refused naming OVFL-c, located on the clip value', () => {
    const input = one('.a { overflow-x: clip; }');
    const ds = compile(input).diagnostics.filter((d) => d.code === 'DRAGON_UNSUPPORTED_VALUE');
    expect(ds.length).toBeGreaterThan(0);
    expect(ds[0]?.message).toContain('OVFL-c');
    expect(spanTextOf(input, ds[0] as (typeof ds)[number])).toBe('clip');
  });
});

describe('OVFL compiler: viewport propagation (css-overflow-3 §3.3)', () => {
  it('html propagates and uses visible; body keeps its overflow', () => {
    const r = root(one('html { overflow-x: hidden; } body { overflow: hidden; }'));
    expect(axes(r, 'html')).toEqual(['visible', 'visible']);
    expect(axes(r, 'body')).toEqual(['hidden', 'hidden']);
  });

  it('body propagates when html is visible on both axes, and uses visible', () => {
    const r = root(one('body { overflow: scroll; }'));
    expect(axes(r, 'html')).toEqual(['visible', 'visible']);
    expect(axes(r, 'body')).toEqual(['visible', 'visible']);
  });

  it('planted fault propagationFromBody takes body even when html is not visible', () => {
    const r = root(one('html { overflow-x: hidden; } body { overflow: hidden; }'), { ...NO_FAULTS, propagationFromBody: true });
    expect(axes(r, 'html')).toEqual(['hidden', 'auto']);
    expect(axes(r, 'body')).toEqual(['visible', 'visible']);
  });

  it('a non-root, non-body element never propagates', () => {
    expect(axes(root(one('.a { overflow: hidden; }')), 'a')).toEqual(['hidden', 'hidden']);
  });
});

describe('OVFL-p: a percentage relative offset the scrollable overflow does not decide is refused, never laid out', () => {
  const refusals = (css: string): string[] => compile(one(css)).diagnostics.filter((d) => d.message.includes('OVFL-p')).map((d) => `${d.code} ${d.target}: ${d.message}`);

  it('inside a scroll container, on top or bottom, a percentage or a calc with one, on every target', () => {
    expect(refusals('.a { overflow: auto; } .b { position: relative; top: 10%; }')).toEqual([
      'DRAGON_UNPROVEN_CONTEXT ios: position: relative with a percentage top on b inside the scroll container a: the scrollable overflow does not decide its basis yet (OVFL-p)',
      'DRAGON_UNPROVEN_CONTEXT web: position: relative with a percentage top on b inside the scroll container a: the scrollable overflow does not decide its basis yet (OVFL-p)',
    ]);
    expect(refusals('.a { overflow: hidden; } .b { position: relative; bottom: calc(10% + 2px); }')).toHaveLength(2);
  });

  it('on the root, whose scroll container is the viewport', () => {
    expect(refusals('html { position: relative; top: 5%; }')[0]).toContain('on html on the root (the viewport is its scroll container)');
  });

  it('a length offset, an offset outside every scroll container, and one under the element the viewport took its overflow from compile', () => {
    expect(refusals('.a { overflow: auto; } .b { position: relative; top: 5px; }')).toEqual([]);
    expect(refusals('.a { position: relative; top: 10%; } .b { position: relative; top: 10%; }')).toEqual([]);
    expect(refusals('html { overflow: hidden; } .a { position: relative; top: 10%; }')).toEqual([]);
    expect(refusals('.a { overflow: clip; } .b { position: relative; top: 10%; }')).toEqual([]);
  });
});
