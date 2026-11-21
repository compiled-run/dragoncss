// SIZE-KW: height, min-height and max-height of stretch (css-sizing-4 §3.1; Chrome's -webkit-fill-available computes to it) on a
// block-level box in block flow. The expected sizes are Chrome 145's getBoundingClientRect for the same documents (body margin 0,
// a 400x300 viewport); the parity fixtures sizing-stretch-height* compare the engine with Chrome's captures. These pin the rules: the
// containing block's height less the margins that count, as a percentage resolves against it, and the refusals.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import type { LayoutBox, LayoutInput, LayoutStyle } from '../src/index.ts';
import { box, neutralEnvironment, pct, px } from './helpers.ts';

const env = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
const STRETCH = { kind: 'stretch' } as const;
type R = { y: number; height: number };

function layOut(html: Partial<LayoutStyle>, body: Partial<LayoutStyle>, kids: LayoutBox[]): Map<string, { y: number; height: number }> {
  const r = layoutWithFaults(env(box('html', html, [box('body', body, kids)])), ahemMeasurer, NO_ENGINE_FAULTS);
  if (r.kind !== 'ok') throw new Error(`${r.unsupported.code}: ${r.unsupported.detail}`);
  return absoluteRects(r.boxes);
}

/** html > body (margin 0) > kids, laid out; box a's absolute top and height in px. */
function at(...kids: LayoutBox[]): R {
  const a = layOut({}, {}, kids).get('a');
  if (a === undefined) throw new Error('no a');
  return { y: a.y / 64, height: a.height / 64 };
}

function refusal(...kids: LayoutBox[]): string {
  const r = layoutWithFaults(env(box('html', {}, [box('body', {}, kids)])), ahemMeasurer, NO_ENGINE_FAULTS);
  return r.kind === 'ok' ? 'ok' : `${r.unsupported.code}: ${r.unsupported.detail}`;
}

const content = (): LayoutBox => box('c', { height: px(18) });
const a = (style: Partial<LayoutStyle>): LayoutBox => box('a', { height: STRETCH, ...style }, [content()]);
const margins = (top: number, bottom: number): Partial<LayoutStyle> => ({ marginTop: px(top), marginBottom: px(bottom) });
const bii = (id: string, children: LayoutBox[]): LayoutBox => ({ ...box(id, {}, children), boxType: 'block-in-inline' });

describe('SIZE-KW: a stretch block size', () => {
  it('fills the containing block\'s height less the margins on a side with a border or padding', () => {
    expect(at(box('p', { height: px(200), paddingTop: px(5), paddingBottom: px(5) }, [a({ ...margins(10, 20), borderTopWidth: px(3), borderBottomWidth: px(3), paddingTop: px(4), paddingBottom: px(4) })]))).toEqual({ y: 15, height: 170 });
    expect(at(box('p', { height: px(200), borderBottomWidth: px(4) }, [a(margins(10, 20))]))).toEqual({ y: 10, height: 180 });
    // A percentage margin is of the containing block's width.
    expect(at(box('p', { height: px(200), width: px(100), paddingTop: px(1) }, [a({ marginTop: pct(10) })]))).toEqual({ y: 11, height: 190 });
  });

  it('leaves out the margins on a side with no border or padding, unless the container is a formatting context root', () => {
    expect(at(box('p', { height: px(200) }, [box('s', { height: px(50) }), a(margins(10, 10))]))).toEqual({ y: 60, height: 200 });
    expect(at(box('p', { height: px(200) }, [a(margins(-10, -10))]))).toEqual({ y: -10, height: 200 });
    expect(at(box('p', { height: px(200), overflowX: 'hidden', overflowY: 'hidden' }, [a(margins(10, 20))]))).toEqual({ y: 10, height: 170 });
  });

  it('is a border-box size whatever box-sizing says, and never less than the border and padding', () => {
    expect(at(box('p', { height: px(200) }, [a({ paddingTop: px(10), paddingBottom: px(10) })]))).toEqual({ y: 0, height: 200 });
    expect(at(box('p', { height: px(20) }, [a({ ...margins(15, 15), paddingTop: px(10), paddingBottom: px(10) })]))).toEqual({ y: 15, height: 20 });
  });

  it('behaves as auto against an indefinite height, and resolves through percentages and other stretches', () => {
    expect(at(box('p', {}, [a(margins(10, 10))]))).toEqual({ y: 10, height: 18 });
    expect(at(box('p', { minHeight: px(200) }, [a({})]))).toEqual({ y: 0, height: 18 });
    expect(at(box('g', { height: px(300) }, [box('p', { height: pct(50) }, [a({})])]))).toEqual({ y: 0, height: 150 });
    expect(at(box('p', { height: px(200), paddingTop: px(1), paddingBottom: px(1) }, [box('q', { height: STRETCH, ...margins(10, 10) }, [a(margins(10, 10))])]))).toEqual({ y: 11, height: 180 });
  });

  it('fills the body inside a root with a definite height, the root\'s margins counting', () => {
    const r = layOut({ height: pct(100) }, { height: STRETCH, marginTop: px(8), marginBottom: px(8), marginLeft: px(8), marginRight: px(8) }, []).get('body');
    expect(r === undefined ? null : { y: r.y / 64, height: r.height / 64 }).toEqual({ y: 8, height: 284 });
  });

  it('as min-height and max-height clamps the same way, and against an indefinite height is auto and none', () => {
    expect(at(box('p', { height: px(200) }, [a({ height: px(20), minHeight: STRETCH, ...margins(5, 5) })]))).toEqual({ y: 5, height: 200 });
    expect(at(box('p', { height: px(200) }, [a({ height: px(500), maxHeight: STRETCH, ...margins(5, 5) })]))).toEqual({ y: 5, height: 200 });
    expect(at(box('p', {}, [a({ height: px(20), minHeight: STRETCH })]))).toEqual({ y: 0, height: 20 });
    expect(at(box('p', {}, [a({ height: px(20), maxHeight: STRETCH })]))).toEqual({ y: 0, height: 20 });
  });

  it('inside a block-in-inline box fills the inline box\'s block container, with no margins counting', () => {
    expect(at(box('p', { height: px(200), paddingTop: px(5), paddingBottom: px(5) }, [bii('i', [a(margins(10, 10))])]))).toEqual({ y: 15, height: 200 });
    expect(at(box('p', { height: px(200), paddingTop: px(5), paddingBottom: px(5) }, [bii('i', [box('a', { height: pct(50) })])]))).toEqual({ y: 5, height: 100 });
  });

  it('is refused outside a block-level box in block flow, and against a flexed size that is not definite', () => {
    expect(refusal(box('p', { height: px(200) }, [a({ float: 'left' })]))).toMatch(/^intrinsic-size-keyword: height: stretch/);
    expect(refusal(box('p', { height: px(200), position: 'relative' }, [a({ position: 'absolute' })]))).toMatch(/^intrinsic-size-keyword: height: stretch/);
    expect(refusal(box('p', { height: px(200), display: 'flex' }, [a({})]))).toMatch(/^intrinsic-size-keyword: height: stretch/);
    expect(refusal(box('p', { height: px(200), display: 'flex' }, [a({ height: px(10), minHeight: STRETCH })]))).toMatch(/^intrinsic-size-keyword: min-height: stretch/);
    expect(refusal(box('p', { display: 'flex' }, [box('f', {}, [a({})])]))).toMatch(/^percent-height-flex: height/);
  });
});
