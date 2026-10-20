// CONTAIN: layout, paint and size containment in the engine (LayoutStyle containLayout, containPaint, containSize; box.ts isContained
// and containsAbsolute, block.ts layoutContents). Chrome agreement is proven by the containment-layout fixture (packages/parity);
// these cases pin the decisions in 10px Ahem, in LayoutUnits.
import { describe, expect, it } from 'vitest';
import type { LayoutBox, LayoutRect, LayoutResult, LayoutStyle } from '../src/index.ts';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import { box, neutralEnvironment, px, text } from './helpers.ts';

const L = 64;
const layoutC: Partial<LayoutStyle> = { containLayout: true };
const paintC: Partial<LayoutStyle> = { containPaint: true };

function run(body: LayoutBox[]): LayoutResult {
  const root = box('html', {}, [box('body', {}, body)]);
  return layoutWithFaults({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, ahemMeasurer, NO_ENGINE_FAULTS);
}
function rects(body: LayoutBox[]): Map<string, LayoutRect> {
  const r = run(body);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r.unsupported));
  return absoluteRects(r.boxes);
}
const at = (m: Map<string, LayoutRect>, id: string): number[] => {
  const r = m.get(id);
  if (r === undefined) throw new Error(`${id} was not laid out`);
  return [r.x, r.y, r.width, r.height].map((v) => v / L);
};

describe('layout and paint containment', () => {
  const kid = () => box('k', { marginTop: px(10), height: px(5) });
  it('make the box a formatting context root, so a child margin does not collapse through it', () => {
    expect(at(rects([box('a', {}, [kid()])]), 'a').slice(1)).toEqual([10, 400, 5]);
    for (const c of [layoutC, paintC]) expect(at(rects([box('a', c, [kid()])]), 'a').slice(1)).toEqual([0, 400, 15]);
  });

  it('make the box the containing block of its absolutely positioned descendants, at its padding box', () => {
    const tree = (c: Partial<LayoutStyle>) => [box('o', { position: 'relative', paddingTop: px(20) }, [box('a', { ...c, paddingLeft: px(4), height: px(10), marginLeft: px(30) }, [box('p', { position: 'absolute', top: px(3), left: px(5), width: px(2), height: px(2) })])])];
    expect(at(rects(tree({})), 'p').slice(0, 2)).toEqual([5, 3]);
    for (const c of [layoutC, paintC]) expect(at(rects(tree(c)), 'p').slice(0, 2)).toEqual([35, 23]);
  });

  it('hide the baseline under layout containment alone: an inline-block then sits on its bottom margin edge', () => {
    const line = (c: Partial<LayoutStyle>) => [box('l', {}, [text('t1', 'X'), box('ib', { display: 'inline-block', width: px(30), height: px(24), ...c }, [text('t2', 'XX')]), text('t3', 'X')])];
    const own = rects(line({}));
    const contained = rects(line(layoutC));
    const painted = rects(line(paintC));
    // Its text's baseline, 8px down, sits on the line's: the 24px box hangs 16px below it and the line is 24px tall. Paint containment
    // keeps that baseline.
    expect([at(own, 'ib')[1], at(own, 'l')[3], at(painted, 'l')[3]]).toEqual([0, 24, 24]);
    // Layout containment hides it: the box's bottom margin edge sits on the baseline, 24px above it, and the strut's 2px descent
    // below makes the line 26px.
    expect([at(contained, 'ib')[1], at(contained, 'l')[3]]).toEqual([0, 26]);
  });
});

describe('size containment', () => {
  it('sizes a block as if it were empty', () => {
    expect(at(rects([box('a', { ...layoutC, containSize: 'size', paddingTop: px(2) }, [text('t', 'XX XX')])]), 'a').slice(2)).toEqual([400, 2]);
    expect(at(rects([box('a', { ...layoutC, containSize: 'inline-size' }, [text('t', 'XX XX')])]), 'a').slice(2)).toEqual([400, 10]);
  });

  it('gives an inline-block no content width', () => {
    const m = rects([box('l', {}, [text('t1', 'X'), box('ib', { display: 'inline-block', ...layoutC, containSize: 'inline-size' }, [text('t', 'XX')]), text('t3', 'X')])]);
    expect(at(m, 'ib')[2]).toBe(0);
  });

  it('is unsupported without layout containment, or on anything but a block', () => {
    const code = (s: Partial<LayoutStyle>): string[] => {
      const r = run([box('a', s, [text('t', 'XX')])]);
      return r.kind === 'ok' ? [] : [r.unsupported.code];
    };
    expect(code({ containSize: 'size' })).toEqual(['size-containment']);
    expect(code({ ...layoutC, containSize: 'size', display: 'flex' })).toEqual(['size-containment']);
  });
});
