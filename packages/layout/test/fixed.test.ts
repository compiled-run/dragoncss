// POSX-f: position: fixed (CSS2 §9.6.1, §10.1 item 3). The parity fixtures fixed-* compare these boxes with Chrome; these pin the
// engine's rules: the viewport is the containing block whatever is positioned between, the static position is the absolute one,
// and a fixed box is in no scrollable overflow.
import { describe, expect, it } from 'vitest';
import { absoluteRects, ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS, scrollRanges, validateLayoutInput } from '../src/index.ts';
import type { LayoutBox, LayoutInput } from '../src/index.ts';
import { hitRefusal } from '../src/rt-hit.ts';
import { box, neutralEnvironment, pct, px } from './helpers.ts';

const env = (root: LayoutBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root });
type R = { x: number; y: number; width: number; height: number };
function rects(root: LayoutBox): Map<string, R> {
  const r = layoutWithFaults(env(root), ahemMeasurer, NO_ENGINE_FAULTS);
  if (r.kind !== 'ok') throw new Error(`${r.unsupported.code}: ${r.unsupported.detail}`);
  const out = new Map<string, R>();
  for (const [id, b] of absoluteRects(r.boxes)) out.set(id, { x: b.x / 64, y: b.y / 64, width: b.width / 64, height: b.height / 64 });
  return out;
}

describe('POSX-f: position: fixed', () => {
  it('takes the viewport as its containing block inside a positioned box, with percentages of the viewport', () => {
    const m = rects(box('root', {}, [box('rel', { position: 'relative', marginTop: px(20), width: px(100), height: px(50) }, [
      box('f', { position: 'fixed', right: px(0), bottom: px(0), width: pct(30), height: pct(10) }),
      box('g', { position: 'fixed', top: px(5), left: px(7), width: px(10), height: px(10) }, [box('a', { position: 'absolute', right: px(0), top: px(0), width: px(2), height: px(2) })]),
    ])]));
    expect(m.get('f')).toEqual({ x: 280, y: 270, width: 120, height: 30 });
    expect(m.get('g')).toEqual({ x: 7, y: 5, width: 10, height: 10 });
    // A fixed box is the containing block of its absolutely positioned children.
    expect(m.get('a')).toEqual({ x: 15, y: 5, width: 2, height: 2 });
  });

  it('keeps its static position with no insets, and leaves the flow', () => {
    const m = rects(box('root', {}, [box('p', { marginTop: px(10) }, [box('k', { height: px(12) }), box('f', { position: 'fixed', width: px(10), height: px(10) }), box('n', { height: px(3) })])]));
    expect(m.get('f')).toEqual({ x: 0, y: 22, width: 10, height: 10 });
    expect(m.get('n')?.y).toBe(22);
  });

  it('is in no scroll container\'s scrollable overflow', () => {
    const root = box('root', {}, [box('s', { overflowX: 'auto', overflowY: 'auto', width: px(50), height: px(20) }, [box('f', { position: 'fixed', top: px(500), left: px(900), width: px(10), height: px(10) })])]);
    const r = scrollRanges(env(root), ahemMeasurer);
    if (r.kind !== 'ok') throw new Error(r.detail);
    expect(r.ranges.map((g) => [g.id, g.maxX, g.maxY])).toEqual([['s', 0, 0]]);
    expect(r.refused).toEqual([]);
  });

  it('validates as an out-of-flow box but never the root, and the hit table refuses it', () => {
    const errors = (root: LayoutBox): string[] => {
      const v = validateLayoutInput(JSON.parse(JSON.stringify(env(root))));
      return v.ok ? [] : [...new Set(v.errors.map((e) => e.code))];
    };
    expect(errors(box('root', {}, [box('f', { position: 'fixed' })]))).toEqual([]);
    expect(errors(box('root', { position: 'fixed' }))).toContain('bad-value');
    expect(hitRefusal(env(box('root', {}, [box('f', { position: 'fixed' })])))).toMatch(/^f is position: fixed/);
  });
});
