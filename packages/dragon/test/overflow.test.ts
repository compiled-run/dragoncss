// OVFL Phase A in the compiler (T078J design A): every computed overflow pair compiles but clip beside visible (OVFL-c), html
// and body overflow is resolved by viewport propagation in the lowering (css-overflow-3 §3.3), and the engine input carries the
// used values. Chrome agreement is proven by the overflow fixture group (packages/parity).
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { FrontEndResult } from '../src/index.ts';
import { androidProfile, createProjectWith, iosLayoutProjection, iosProfile, nativePrograms, NO_FAULTS, PROFILE_NOTES, querySupport, webProfile } from '../src/internal.ts';
import type { Diagnostic } from '../src/index.ts';
import type { CompilerFaults } from '../src/faults.ts';
import { DOC, div, inputFor, spanTextOf, text } from './helpers.ts';

const FONT = 'body { margin: 0; font-family: Ahem; font-size: 10px; }';
const errorsOf = (c: { readonly diagnostics: readonly Diagnostic[] }): string[] => c.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.target}: ${d.message}`);
const ENV = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, rootFont: 'ua-default', direction: 'ltr' } as const;
// lanes: compile as the parity lanes do (interactionLanes).
const compile = (input: FrontEndResult, faults: CompilerFaults = NO_FAULTS, lanes = false) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr', interactionLanes: lanes }).compile(input);
const one = (css: string): FrontEndResult => inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]);

function root(input: FrontEndResult, faults: CompilerFaults = NO_FAULTS): LayoutBox {
  const c = compile(input, faults, true);
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

describe('R3: the web overflow claims carry the overlay-scrollbar environment limit', () => {
  const web = webProfile.rows.filter((r) => /^overflow-[xy]:/.test(r.feature));
  const scrolling = web.filter((r) => /:(auto|scroll)$/.test(r.feature));

  it('every web overflow auto and scroll row carries the PROFILE_NOTES note; hidden, clip and visible reserve no gutter and carry none', () => {
    expect(scrolling.length).toBeGreaterThan(0);
    for (const r of scrolling) expect(r.note, `${r.feature}@${r.context}`).toBe(PROFILE_NOTES.overlayScrollbars);
    for (const r of web.filter((x) => !scrolling.includes(x))) expect(r.note, `${r.feature}@${r.context}`).toBeUndefined();
    expect(PROFILE_NOTES.overlayScrollbars).toContain('15px');
    for (const r of [...iosProfile.rows, ...webProfile.rows.filter((x) => !/^overflow-[xy]:/.test(x.feature))]) expect(r.note, `${r.feature}@${r.context}`).toBeUndefined();
  });

  it('explain and querySupport state the note on web, and not on ios', () => {
    const c = compile(one('.a { overflow: auto; height: 5px; }'), NO_FAULTS, true);
    const at = (target: 'web' | 'ios') => {
      const r = c.explain({ target, at: { node: 'a', instance: DOC }, property: 'overflow-y' });
      if (r.kind !== 'found') throw new Error(JSON.stringify(r));
      return r.cases[0]?.support;
    };
    expect(at('web')).toMatchObject({ feature: 'overflow-y:auto', note: PROFILE_NOTES.overlayScrollbars });
    expect(at('ios')?.note).toBeUndefined();
    const q = querySupport({ kind: 'possibilities', target: { kind: 'web' }, css: 'overflow-y: scroll' });
    if (q.kind !== 'needs-context') throw new Error(q.kind);
    for (const cand of q.candidates) expect(cand.note).toBe(PROFILE_NOTES.overlayScrollbars);
  });
});

describe('OVFL-B: native scroll views for overflow auto and scroll', () => {
  const NATIVE = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
  const run = (css: string) =>
    createProjectWith({ projectId: 'test', targets: NATIVE }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`${FONT} ${css}`, (r) => [div(r, 'a', ['a'], [div(r, 'b', ['b'], [text(r, 't', 'XX')])])]));
  const writesOf = (css: string, id: string) => {
    const p = nativePrograms(run(css), []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const n = p.programs.uikit.nodes.find((x) => x.id === id);
    if (n === undefined) throw new Error(`no node ${id}`);
    return n.writes.filter((w) => w.key.startsWith('dragonClip') || w.key.startsWith('dragonScroll')).map((w) => (w.kind === 'scroll-container' ? `${w.key} ${w.x} ${w.y}` : w.key));
  };

  it('auto and scroll compile on native; each axis that is auto or scroll scrolls, a hidden axis is locked', () => {
    for (const css of ['.a { overflow: auto; }', '.a { overflow: scroll; }', '.a { overflow-x: hidden; }', 'html { overflow-x: hidden; }']) expect(errorsOf(run(css)), css).toEqual([]);
    expect(writesOf('.a { overflow: auto; }', 'a')).toEqual(['dragonClip.frame', 'dragonScroll.range true true']);
    expect(writesOf('.a { overflow-x: hidden; }', 'a')).toEqual(['dragonClip.frame', 'dragonScroll.range false true']);
    expect(writesOf('.a { overflow-x: scroll; overflow-y: hidden; }', 'a')).toEqual(['dragonClip.frame', 'dragonScroll.range true false']);
    expect(writesOf('.a { overflow: hidden; }', 'a')).toEqual(['dragonClip.frame']);
    expect(writesOf('.a { overflow: clip; }', 'a')).toEqual(['dragonClip.frame']);
  });

  it('the native auto and scroll rows exist for the contexts the fixtures prove', () => {
    for (const prof of [iosProfile, androidProfile]) {
      expect(prof.rows.some((r) => r.feature === 'overflow-y:auto' && r.context === 'block/ltr'), prof.target).toBe(true);
      expect(prof.rows.some((r) => r.feature === 'overflow-x:scroll' && r.context === 'block/rtl'), prof.target).toBe(true);
    }
  });
});
