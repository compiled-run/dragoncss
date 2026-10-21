// POSX-s: position: sticky at scroll offset 0 (css-position-3 §3.4). The expected tops and lefts are Chrome 145's
// getBoundingClientRect for the same documents (body margin 8px, a 400x300 viewport); the parity fixtures sticky-* compare the
// engine with Chrome's captures. These pin the rules: the viewport less the insets, the parent's content box less the box's margins,
// ancestors' relative offsets, right before left and bottom before top, and the refusals.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import type { LayoutBox, LayoutInput, LayoutStyle } from '../src/index.ts';
import { hitRefusal } from '../src/rt-hit.ts';
import { box, neutralEnvironment, pct, px } from './helpers.ts';

const env = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
type R = { x: number; y: number };
const BODY: Partial<LayoutStyle> = { marginTop: px(8), marginRight: px(8), marginBottom: px(8), marginLeft: px(8) };
/** html > body > kids, laid out; the sticky box s's absolute position in px. */
function at(...kids: LayoutBox[]): R {
  const r = layoutWithFaults(env(box('html', {}, [box('body', BODY, kids)])), ahemMeasurer, NO_ENGINE_FAULTS);
  if (r.kind !== 'ok') throw new Error(`${r.unsupported.code}: ${r.unsupported.detail}`);
  const s = absoluteRects(r.boxes).get('s');
  if (s === undefined) throw new Error('no s');
  return { x: s.x / 64, y: s.y / 64 };
}
function refusal(root: LayoutBox): string {
  const r = layoutWithFaults(env(root), ahemMeasurer, NO_ENGINE_FAULTS);
  return r.kind === 'ok' ? 'ok' : `${r.unsupported.code}: ${r.unsupported.detail}`;
}
const tall = (): LayoutBox => box('tall', { height: px(600) });
const sticky = (style: Partial<LayoutStyle>): LayoutBox => box('s', { position: 'sticky', height: px(30), ...style });

describe('POSX-s: position: sticky', () => {
  it('moves down to the top inset, as far as its parent\'s content box less its own margins lets it', () => {
    expect(at(box('p', { height: px(200) }, [sticky({ top: px(20) })]), tall())).toEqual({ x: 8, y: 20 });
    expect(at(box('p', { height: px(35) }, [sticky({ top: px(20) })]), tall())).toEqual({ x: 8, y: 13 });
    expect(at(box('p', { height: px(50) }, [sticky({ top: px(20), marginBottom: px(10) })]), tall())).toEqual({ x: 8, y: 18 });
    // A percentage inset is of the viewport's height.
    expect(at(box('p', { height: px(200) }, [sticky({ top: pct(10) })]), tall())).toEqual({ x: 8, y: 30 });
    // padding and border are outside the containing block.
    expect(at(box('p', { height: px(35), paddingTop: px(5), paddingBottom: px(7), borderBottomWidth: px(3) }, [sticky({ top: px(30) })]), tall())).toEqual({ x: 8, y: 18 });
  });

  it('moves up to the bottom inset, no higher than its parent\'s content box', () => {
    expect(at(box('p', { height: px(430) }, [box('k', { height: px(400) }), sticky({ bottom: px(20) })]))).toEqual({ x: 8, y: 250 });
    expect(at(box('p', { height: px(430) }, [box('k', { height: px(400) }), sticky({ bottom: pct(10) })]))).toEqual({ x: 8, y: 240 });
    expect(at(box('k', { height: px(300) }), box('p', { height: px(60) }, [box('k2', { height: px(30) }), sticky({ bottom: px(20) })]))).toEqual({ x: 8, y: 308 });
  });

  it('takes the top inset after a bottom one that cannot move it, and its ancestors\' relative offsets', () => {
    expect(at(box('p', { height: px(200) }, [sticky({ top: px(20), bottom: px(280) })]), tall())).toEqual({ x: 8, y: 20 });
    expect(at(box('p', { position: 'relative', top: px(-20), height: px(200) }, [sticky({ top: px(0) })]), tall())).toEqual({ x: 8, y: 0 });
  });

  it('sticks a flex item inside its container\'s content box', () => {
    expect(at(box('p', { display: 'flex', height: px(35), alignItems: 'flex-start' }, [sticky({ top: px(20), width: px(30) })]), tall())).toEqual({ x: 8, y: 13 });
  });

  it('moves along the inline axis to the left inset, or the right one', () => {
    const wide = box('wide', { width: px(900), height: px(10) });
    expect(at(box('p', { width: px(200) }, [sticky({ left: px(20), width: px(30) })]), wide)).toEqual({ x: 20, y: 8 });
    expect(at(box('p', { width: px(35) }, [sticky({ left: px(20), width: px(30) })]), wide)).toEqual({ x: 13, y: 8 });
    expect(at(box('p', { width: px(200) }, [sticky({ left: px(20), right: px(380), width: px(30) })]), wide)).toEqual({ x: 20, y: 8 });
    expect(at(box('p', { width: px(600), display: 'flex', justifyContent: 'flex-end' }, [sticky({ right: px(20), width: px(30) })]))).toEqual({ x: 350, y: 8 });
    expect(at(box('p', { width: px(200), direction: 'rtl' }, [sticky({ left: px(20), right: px(0), width: px(30), marginRight: px(180), direction: 'rtl' })]), wide)).toEqual({ x: -2, y: 8 });
  });

  it('carries its absolutely positioned boxes', () => {
    const s = box('s', { position: 'sticky', top: px(20), height: px(30) }, [box('a', { position: 'absolute', top: px(2), height: px(3) })]);
    const r = layoutWithFaults(env(box('html', {}, [box('body', BODY, [box('p', { height: px(200) }, [s]), tall()])])), ahemMeasurer, NO_ENGINE_FAULTS);
    if (r.kind !== 'ok') throw new Error(r.unsupported.detail);
    expect((absoluteRects(r.boxes).get('a')?.y ?? 0) / 64).toBe(22);
  });

  it('refuses a sticky root, one in a scroll container or another sticky box, an inline-level one, or under a percentage padding', () => {
    expect(refusal(box('html', { position: 'sticky' }))).toMatch(/^sticky: the root box/);
    expect(refusal(box('html', {}, [box('sc', { overflowX: 'hidden', overflowY: 'hidden' }, [box('b', {}, [sticky({ top: px(0) })])])]))).toMatch(/^sticky: the sticky s inside the scroll container sc/);
    expect(refusal(box('html', {}, [box('o', { position: 'sticky', top: px(0) }, [sticky({ top: px(0) })])]))).toMatch(/^sticky: the sticky s inside the sticky o/);
    expect(refusal(box('html', {}, [sticky({ top: px(0), display: 'inline-block' })]))).toMatch(/^sticky: the sticky s in the inline formatting context/);
    expect(refusal(box('html', { paddingTop: pct(5) }, [sticky({ top: px(0) })]))).toMatch(/^sticky: a percentage padding on html/);
    // overflow: clip makes no scroll container.
    expect(refusal(box('html', {}, [box('c', { overflowX: 'clip', overflowY: 'clip' }, [sticky({ top: px(0) })])]))).toBe('ok');
  });

  it('validates, and the hit table refuses it', () => {
    const v = validateLayoutInput(JSON.parse(JSON.stringify(env(box('html', {}, [sticky({ top: px(0) })])))));
    expect(v.ok).toBe(true);
    expect(hitRefusal(env(box('html', {}, [sticky({ top: px(0) })])))).toMatch(/^s is position: sticky/);
  });
});
