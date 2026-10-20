// BII: a block-in-inline box (an inline box the compiler lays out as the block box of the blocks it alone holds) places its three
// line fragments as Chrome 145 reports the inline box's client rects: an empty line at its line start edge and top, its border box,
// and an empty line below the margin that collapses out of its bottom (block.ts withBlockInInlineLines). The parity fixtures
// block-in-inline-* compare them with Chrome.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import type { LayoutBox, LayoutInput, LayoutStyle } from '../src/index.ts';
import { box, neutralEnvironment, px } from './helpers.ts';

const env = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
const bii = (id: string, style: Partial<LayoutStyle>, children: LayoutBox[]): LayoutBox => ({ ...box(id, style, children), boxType: 'block-in-inline' });
function rects(root: LayoutBox): Record<string, number[]> {
  const r = layoutWithFaults(env(root), ahemMeasurer, NO_ENGINE_FAULTS);
  if (r.kind !== 'ok') throw new Error(r.unsupported.detail);
  const out: Record<string, number[]> = {};
  for (const [id, b] of absoluteRects(r.boxes)) out[id] = [b.x / 64, b.y / 64, b.width / 64, b.height / 64];
  return out;
}

describe('BII: the line fragments of a block-in-inline box', () => {
  it('puts the empty lines at the start edge, the top, and below the margin out of the bottom', () => {
    const m = rects(box('html', {}, [box('w', { marginTop: px(5), width: px(200) }, [bii('s', {}, [box('m1', { marginTop: px(10), height: px(10) }), box('m2', { marginTop: px(7), marginBottom: px(7), height: px(10), width: px(50) })])]), box('after', { marginTop: px(3), height: px(11) })]));
    expect(m['s']).toEqual([0, 10, 200, 27]);
    expect([m['s:line0'], m['s:line1'], m['s:line2']]).toEqual([[0, 10, 0, 0], [0, 10, 200, 27], [0, 44, 0, 0]]);
    expect(m['after']?.[1]).toBe(44);
  });

  it('starts its lines at the right edge in rtl, and takes no margin a fixed-height child keeps', () => {
    const m = rects(box('html', { direction: 'rtl' }, [box('w', { width: px(200), direction: 'rtl' }, [bii('s', { direction: 'rtl' }, [box('k', { height: px(10), direction: 'rtl' }, [box('i', { height: px(5), marginBottom: px(9), direction: 'rtl' })])])])]));
    expect([m['s:line0'], m['s:line1'], m['s:line2']]).toEqual([[400, 0, 0, 0], [200, 0, 200, 10], [400, 10, 0, 0]]);
  });

  it('validates only as a static block box of block-level boxes', () => {
    const codes = (root: LayoutBox): boolean => validateLayoutInput(JSON.parse(JSON.stringify(env(root)))).ok;
    expect(codes(box('html', {}, [bii('s', {}, [box('k', {})])]))).toBe(true);
    expect(codes(box('html', {}, [bii('s', { position: 'relative' }, [box('k', {})])]))).toBe(false);
    expect(codes(box('html', {}, [bii('s', { display: 'flex' }, [box('k', {})])]))).toBe(false);
  });
});
