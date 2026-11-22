// SELD-R1b: the hit test on synthetic tables (the Chrome proof over every layout case is packages/parity/test/hit-report.test.ts).
// Point semantics: the point floored to 1/64 px is a 1x1 px box with exclusive intersection; text against its pixel-snapped rect;
// a line against its rect and, inclusively, the block's snapped border box at the line's offset (T063J); paint order; plants.
import { describe, expect, it } from 'vitest';
import type { HitNode } from '../src/rt-hit.ts';
import { activationTarget, HitError, hitTest, NO_HIT_FAULTS, NO_HIT_TABLE_FAULTS } from '../src/rt-hit.ts';

const PX = 64;
const base = { clips: false, borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0, layer: false, absolute: false, atomic: false, order: 0, layerOrder: 0, line: -1, inkLeft: 0, inkTop: 0, inkRight: 0, inkBottom: 0, pointerEvents: 'auto', radii: [] } as const;
const box = (parent: number, target: number, x: number, y: number, w: number, h: number, more: Partial<HitNode> = {}): HitNode => ({ ...base, kind: 'box', parent, target, x: x * PX, y: y * PX, width: w * PX, height: h * PX, ...more });
const at = (nodes: readonly HitNode[], x: number, y: number, faults = NO_HIT_FAULTS): number => hitTest(nodes, Math.floor(x * PX), Math.floor(y * PX), faults);

describe('point semantics', () => {
  const nodes = [box(-1, 0, 0, 0, 400, 300), box(0, 1, 10, 10, 10.5, 10.25)];
  it('hits a box when the 1x1 px box at the floored point overlaps it, exclusively', () => {
    expect(at(nodes, 9.015625, 15)).toBe(1);
    expect(at(nodes, 9, 15)).toBe(0);
    expect(at(nodes, 20.484375, 15)).toBe(1);
    expect(at(nodes, 20.5, 15)).toBe(0);
    expect(at(nodes, 15, 20.234375)).toBe(1);
    expect(at(nodes, 15, 20.25)).toBe(0);
  });
  it('never hits an empty box and names the root when nothing else is hit', () => {
    expect(at([box(-1, 0, 0, 0, 400, 300), box(0, 1, 10, 10, 0, 10)], 10, 12)).toBe(0);
  });
});

describe('inline content', () => {
  // A 30x10 block at (0,20); line-height 50: line 1 at y 70, its text 20 px wide at y 90.
  const block = box(0, 1, 0, 20, 30, 10);
  const line = (k: number, y: number, more: Partial<HitNode> = {}): HitNode => ({ ...box(1, 1, 0, y, 20, 50), kind: 'line', line: k, ...more });
  const text = (k: number, y: number): HitNode => ({ ...box(1, 1, 0, y, 20, 10), kind: 'text', line: k, inkLeft: 0, inkTop: y * PX, inkRight: 20 * PX, inkBottom: (y + 10) * PX });
  const nodes = [box(-1, 0, 0, 0, 400, 300), block, line(0, 20), text(0, 40), line(1, 70), text(1, 90)];
  it('hits the line within the block\'s border box placed at the line top, inclusively, then the text', () => {
    expect(at(nodes, 5, 69)).toBe(0);
    expect(at(nodes, 5, 69.015625)).toBe(1);
    expect(at(nodes, 5, 80)).toBe(1);
    expect(at(nodes, 5, 80.015625)).toBe(0);
    expect(at(nodes, 5, 89.015625)).toBe(1);
    expect(at(nodes, 5, 99.984375)).toBe(1);
    expect(at(nodes, 5, 100)).toBe(0);
    expect(at(nodes, 19.984375, 75)).toBe(1);
    expect(at(nodes, 20, 75)).toBe(0);
  });
  it('tests text against its pixel-snapped rect', () => {
    const t = { ...box(1, 1, 0, 40.25, 20, 10), kind: 'text' as const, line: 0, inkTop: 40 * PX, inkBottom: 51 * PX, inkRight: 20 * PX };
    const n = [box(-1, 0, 0, 0, 400, 300), box(0, 1, 0, 0, 30, 0), { ...box(1, 1, 0, 40, 20, 0), kind: 'line' as const, line: 0 }, t];
    expect(at(n, 5, 49.984375)).toBe(1);
    expect(at(n, 5, 50)).toBe(0);
  });
});

describe('paint order', () => {
  it('hits the later sibling, a positioned box before normal flow, and text before a later background', () => {
    const root = box(-1, 0, 0, 0, 400, 300);
    expect(at([root, box(0, 1, 0, 0, 100, 20), box(0, 2, 0, 10, 100, 20)], 5, 15)).toBe(2);
    expect(at([root, box(0, 1, 0, 0, 100, 20, { layer: true }), box(0, 2, 0, 10, 100, 20)], 5, 15)).toBe(1);
    const t = [root, box(0, 1, 0, 0, 40, 10), { ...box(1, 1, 0, 0, 30, 10), kind: 'line' as const, line: 0 }, { ...box(1, 1, 0, 0, 30, 10), kind: 'text' as const, line: 0, inkRight: 30 * PX, inkBottom: 10 * PX }, box(0, 4, 0, 0, 100, 40)];
    expect(at(t, 5, 5)).toBe(1);
  });
  it('tests flex items whole, in order-modified order', () => {
    const root = box(-1, 0, 0, 0, 400, 300);
    const flex = box(0, 1, 0, 0, 200, 30);
    const a = box(1, 2, 0, 0, 60, 30, { atomic: true, order: 1 });
    const b = box(1, 3, 30, 0, 60, 30, { atomic: true, order: 0 });
    expect(at([root, flex, a, b], 40, 10)).toBe(2);
  });
  it('clips in-flow descendants to the padding box, and a layer only along its containing-block chain', () => {
    const root = box(-1, 0, 0, 0, 400, 300);
    const clip = box(0, 1, 0, 0, 50, 20, { clips: true, borderTop: 2 * PX, borderRight: 2 * PX, borderBottom: 2 * PX, borderLeft: 2 * PX });
    const child = box(1, 2, 0, 0, 100, 40);
    expect(at([root, clip, child], 10, 10)).toBe(2);
    expect(at([root, clip, child], 10, 30)).toBe(0);
    expect(at([root, clip, child], 10, 18.5)).toBe(1);
    const escaped = box(1, 2, 0, 0, 100, 100, { layer: true, absolute: true });
    expect(at([root, clip, escaped], 10, 50)).toBe(2);
    const held = box(1, 2, 0, 0, 100, 100, { layer: true });
    expect(at([root, clip, held], 10, 50)).toBe(0);
  });
});

describe('pointer-events and plants', () => {
  const root = box(-1, 0, 0, 0, 400, 300);
  const under = box(0, 1, 0, 0, 100, 30);
  const over = box(0, 2, 0, 0, 100, 20, { pointerEvents: 'none' });
  const child = box(2, 3, 0, 0, 20, 10);
  it('skips a none box and keeps its auto descendants hittable', () => {
    expect(at([root, under, over, child], 50, 10)).toBe(1);
    expect(at([root, under, over, child], 5, 5)).toBe(3);
  });
  it('plants hitIgnoresPointerEventsNone and hitReversedOrder change the answer', () => {
    expect(at([root, under, over, child], 50, 10, { ignorePointerEventsNone: true, reversedOrder: false })).toBe(2);
    expect(at([root, box(0, 1, 0, 0, 100, 20), box(0, 2, 0, 10, 100, 20)], 5, 15, { ignorePointerEventsNone: false, reversedOrder: true })).toBe(1);
  });
  it('dispatches a tap to the nearest inclusive ancestor with an activation handler', () => {
    const nodes = [root, under, over, child];
    expect(activationTarget(nodes, [false, false, true, false], 3)).toBe(2);
    expect(activationTarget(nodes, [false, false, false, false], 3)).toBe(-1);
    expect(() => activationTarget(nodes, [false], 3)).toThrow(HitError);
  });
  it('refuses a malformed table', () => {
    expect(() => hitTest([], 0, 0, NO_HIT_FAULTS)).toThrow(HitError);
    expect(() => hitTest([root, box(2, 1, 0, 0, 1, 1)], 0, 0, NO_HIT_FAULTS)).toThrow(/not an earlier node/);
  });
});

// REPL-a: a replaced leaf (img, iframe) is a hit target on its border box, with no descendants. Blink hit-tests a block-level
// replaced box like any block child and a flex item atomically; the outer document's elementFromPoint returns the iframe itself.
describe('hitTableOf hit-tests a replaced element as a childless box', () => {
  const setup = async (display: 'block' | 'flex', pe: 'auto' | 'none' = 'auto') => {
    const { hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    const { box, divStyle, neutralEnvironment, px } = await import('./helpers.ts');
    const leaf = (id: string, w: number) => ({ kind: 'replaced', id, style: { ...divStyle, display: 'block', width: px(w), height: px(10), borderTopWidth: px(2), borderTopStyle: 'solid' }, natural: { kind: 'image', width: 20, height: 10 }, defaultWidth: 300, defaultHeight: 150, objectFit: 'fill', objectPositionX: px(0), objectPositionY: px(0) }) as const;
    const parent = { ...box('p', { display, width: px(100) }), children: [leaf('a', 40), box('d', { width: px(30), height: px(10) }), leaf('b', 20)] };
    const root = { ...box('html', { width: px(100) }), children: [parent] } as unknown as Parameters<typeof hitTableOf>[0]['root'];
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root };
    const fact = (p: 'auto' | 'none', inherited: boolean) => ({ pointerEvents: p, inherited, activation: false, radii: [] });
    const facts = new Map([['html', fact('auto', true)], ['p', fact('auto', true)], ['a', fact(pe, false)], ['d', fact('auto', true)], ['b', fact('auto', true)]]) as unknown as Parameters<typeof hitTableOf>[2];
    return hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
  };

  it('lists each replaced leaf in tree order as its own target, with its border, and answers points inside it', async () => {
    const { hitTest } = await import('../src/rt-hit.ts');
    for (const display of ['block', 'flex'] as const) {
      const t = await setup(display);
      expect(t.ids, display).toEqual(['html', 'p', 'a', 'd', 'b']);
      const a = t.nodes[2] as HitNode;
      expect([a.kind, a.target, a.parent, a.borderTop / PX, a.width / PX, a.height / PX], display).toEqual(['box', 2, 1, 2, 40, 12]);
      // A flex item is painted atomically, in its order; a block child is not.
      expect(t.nodes.slice(2).map((n) => [n.atomic, n.order]), display).toEqual(display === 'flex' ? [[true, 0], [true, 1], [true, 2]] : [[false, 0], [false, 0], [false, 0]]);
      const b = t.nodes[4] as HitNode;
      expect(t.ids[hitTest(t.nodes, a.x + 5 * PX, a.y + 5 * PX, NO_HIT_FAULTS)], display).toBe('a');
      expect(t.ids[hitTest(t.nodes, b.x + 5 * PX, b.y + 5 * PX, NO_HIT_FAULTS)], display).toBe('b');
    }
  });

  it('honours pointer-events: none on a replaced element, so the point falls through to its parent', async () => {
    const { hitTest } = await import('../src/rt-hit.ts');
    const t = await setup('block', 'none');
    const a = t.nodes[2] as HitNode;
    expect(a.pointerEvents).toBe('none');
    expect(t.ids[hitTest(t.nodes, a.x + 5 * PX, a.y + 5 * PX, NO_HIT_FAULTS)]).toBe('p');
  });
});

// SELD-R2b: the facts' px radii are CSS px and the table is in device px, and a line is rounded on its own rect with its block's radii.
describe('hitTableOf rounds boxes and lines as Blink does', () => {
  const table = async (dpr: number, p: Record<string, unknown>, children: unknown[], radius: number | readonly number[]) => {
    const { hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    const { box, neutralEnvironment } = await import('./helpers.ts');
    const root = { ...box('html', {}), children: [box('p', p, children as Parameters<typeof box>[2])] } as unknown as Parameters<typeof hitTableOf>[0]['root'];
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: dpr, ...neutralEnvironment({ width: 400, height: 300 }), root };
    const r = Array.from({ length: 8 }, (_, i) => ({ percent: false, value: typeof radius === 'number' ? radius : radius[i] }));
    const facts = new Map([['html', { pointerEvents: 'auto', inherited: false, activation: false, radii: [] }], ['p', { pointerEvents: 'auto', inherited: true, activation: false, radii: r }]]) as unknown as Parameters<typeof hitTableOf>[2];
    return hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
  };
  const idAt = (t: { nodes: readonly HitNode[]; ids: readonly string[] }, x: number, y: number) => t.ids[hitTest(t.nodes, Math.floor(x * PX), Math.floor(y * PX), NO_HIT_FAULTS)];

  it('scales a px radius to device px at DPR 3, so a 12px corner is 36 device px', async () => {
    const { px } = await import('./helpers.ts');
    const t = await table(3, { width: px(60), height: px(60) }, [], 12);
    const p = t.nodes[1] as HitNode;
    expect([t.ids[1], p.width / PX, p.radii.slice(0, 8)]).toEqual(['p', 180, [36, 36, 36, 36, 36, 36, 36, 36]]);
    // (3, 3) device px is inside a 12 device px corner but outside Chrome's 36.
    expect(idAt(t, 3, 3)).toBe('html');
    expect(idAt(t, 12, 12)).toBe('p');
  });

  // Where a corner's curve decides a row's or column's first or last pixel hitting p (inset from the box's straight edge), that pixel
  // and the one just outside it are grid points; straight edges are sampled per box, not per pixel.
  const arcCovered = async (t: Awaited<ReturnType<typeof table>>, dpr: number, w: number, h: number): Promise<number> => {
    const { hitGrid } = await import('../src/rt-hit.ts');
    const grid = hitGrid(t, 400 * dpr * PX, 300 * dpr * PX);
    const has = new Set(grid.map((g) => `${g.x},${g.y}`));
    const on = (x: number, y: number) => has.has(`${x * PX},${y * PX}`);
    const hits = (xs: number[], ys: number[]) => xs.flatMap((x) => ys.filter((y) => idAt(t, x, y) === 'p').map((y) => [x, y] as const));
    const all = hits(Array.from({ length: w }, (_, x) => x), Array.from({ length: h }, (_, y) => y));
    const [top, bottom] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
    const [left, right] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
    let checked = 0;
    for (let x = left; x <= right; x++) {
      const ys = all.filter((p) => p[0] === x).map((p) => p[1]);
      const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
      if (y0 > top) { expect(on(x, y0) && on(x, y0 - 1), `column ${x}: first hit ${y0}`).toBe(true); checked++; }
      if (y1 < bottom) { expect(on(x, y1) && on(x, y1 + 1), `column ${x}: last hit ${y1}`).toBe(true); checked++; }
    }
    for (let y = top; y <= bottom; y++) {
      const xs = all.filter((p) => p[1] === y).map((p) => p[0]);
      const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
      if (x0 > left) { expect(on(x0, y) && on(x0 - 1, y), `row ${y}: first hit ${x0}`).toBe(true); checked++; }
      if (x1 < right) { expect(on(x1, y) && on(x1 + 1, y), `row ${y}: last hit ${x1}`).toBe(true); checked++; }
    }
    return checked;
  };

  it('samples a rounded corner along its arc: each row\'s and column\'s edge pixels, in few points', async () => {
    const { px } = await import('./helpers.ts');
    const { hitGrid } = await import('../src/rt-hit.ts');
    const t = await table(3, { width: px(60), height: px(60) }, [], 12);
    expect(await arcCovered(t, 3, 190, 190)).toBeGreaterThan(200);
    expect(hitGrid(t, 1200 * PX, 900 * PX).filter((g) => g.x < 36 * PX && g.y < 36 * PX).length).toBeLessThan(1000);
  });

  it('samples elliptical, fractional corners of a bordered box at DPR 2.625 along their arcs', async () => {
    const { px } = await import('./helpers.ts');
    const bordered = { width: px(57), height: px(41), borderTopWidth: px(3), borderTopStyle: 'solid', borderRightWidth: px(1), borderRightStyle: 'solid', borderBottomWidth: px(2), borderBottomStyle: 'solid', borderLeftWidth: px(4), borderLeftStyle: 'solid' };
    const t = await table(2.625, bordered, [], [9.5, 3.25, 14, 0.5, 4.75, 11, 6.5, 0.75]);
    expect(await arcCovered(t, 2.625, 190, 140)).toBeGreaterThan(50);
  });

  it('hits a line that overflows its rounded block by less than the block\'s top padding, inside the rounded line rect', async () => {
    const { px, text } = await import('./helpers.ts');
    // p's border box is 0 to 18; its line box 8 to 28, the block's border box moved to the line 8 to 26, and the text 13 to 23.
    const t = await table(1, { width: px(100), height: px(10), paddingTop: px(8) }, [text('t', 'XXXXXXXXXX', { lineHeight: px(20) })], 10);
    const line = t.nodes[t.ids.indexOf('p:hitline0')] as HitNode;
    expect([line.y / PX, line.height / PX, line.radii.slice(0, 8)]).toEqual([8, 20, [10, 10, 10, 10, 10, 10, 10, 10]]);
    expect(idAt(t, 50, 24)).toBe('p');
    expect(idAt(t, 50, 26.5)).toBe('html');
  });
});

// FORM-a: a form control is refused by name, never hit as its parts: Chrome retargets a hit on a control's UA shadow parts to the
// control element, which the hit table does not model, and no Chrome hit capture covers a control. Inputs without one are unaffected.
describe('hitTableOf and hitRefusal refuse a form control by name', () => {
  const setup = async (display: 'block' | 'flex', withControl: boolean, kind: 'button' | 'range') => {
    const { box, control, neutralEnvironment, px, text } = await import('./helpers.ts');
    const { SLIDER_DEFAULT_TRACK_LENGTH } = await import('../src/index.ts');
    const inner = [box('label', {}, [text('t', 'XX')]), box('icon', { width: px(10), height: px(10) })];
    const thumb = control('thumb', { kind: 'slider-thumb', ratio: 0.5 }, { width: px(10), height: px(10) });
    const track = box('track', { width: px(60) }, [thumb]);
    const ctl = kind === 'button'
      ? control('btn', { kind: 'button-block' }, { width: px(60), paddingTop: px(4), paddingBottom: px(4) }, inner)
      : control('btn', { kind: 'range', defaultInlineSize: SLIDER_DEFAULT_TRACK_LENGTH }, { display: 'flex' }, [box('container', { display: 'flex' }, [track])]);
    const first = withControl ? ctl : box('btn', { width: px(60), paddingTop: px(4), paddingBottom: px(4) }, inner);
    // The control sits one box deep, so the refusal must walk past the plain boxes above it.
    const parent = { ...box('p', { display, width: px(100) }), children: [box('wrap', {}, [first]), box('after', { width: px(20), height: px(10) })] };
    const root = { ...box('html', { width: px(100) }), children: [parent] };
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root };
    const fact = (activation: boolean) => ({ pointerEvents: 'auto', inherited: true, activation, radii: [] }) as const;
    const ids = ['html', 'p', 'wrap', 'btn', 'label', 'icon', 'after', 'container', 'track', 'thumb'];
    return { input, facts: new Map(ids.map((id) => [id, fact(id === 'btn')] as const)) };
  };
  const REASON = 'btn is a form control, which the hit table does not model yet (FORM-a; Chrome retargets its parts to the control, no Chrome hit capture)';

  it('throws the named HitError for a range, in block and flex parents', async () => {
    const { hitRefusal, hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer, validateLayoutInput } = await import('../src/index.ts');
    for (const display of ['block', 'flex'] as const) {
      const { input, facts } = await setup(display, true, 'range');
      expect(validateLayoutInput(JSON.parse(JSON.stringify(input))).ok, display).toBe(true);
      expect(hitRefusal(input), display).toBe(REASON);
      expect(() => hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS), display).toThrow(new HitError(REASON));
    }
  });

  it('hits a block button as the box it lays out as, with its own children, in block and flex parents', async () => {
    const { hitRefusal, hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    for (const display of ['block', 'flex'] as const) {
      const { input, facts } = await setup(display, true, 'button');
      expect(hitRefusal(input), display).toBeNull();
      const t = hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
      expect(t.ids.filter((id) => !id.includes(':')), display).toEqual(['html', 'p', 'wrap', 'btn', 'label', 'icon', 'after']);
      expect(t.activation[t.ids.indexOf('btn')], display).toBe(true);
    }
  });

  it('hits a select, a text field and a textarea as one box, retargeting their UA shadow parts to the control', async () => {
    const { box, control, neutralEnvironment, px, text, ahemFont } = await import('./helpers.ts');
    const { hitRefusal, hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    const strut = { font: ahemFont(10), lineHeight: { kind: 'normal' } } as const;
    const select = control('s', { kind: 'select-menulist', font: ahemFont(10), lineHeight: { kind: 'normal' }, arrowWidth: 0, options: [] }, { display: 'flex', width: px(60) }, [control('s::inner', { kind: 'select-inner' }, {}, [text('s::inner:text0', 'XX')], strut)]);
    const field = control('f', { kind: 'text-field', size: 4, font: ahemFont(10), lineHeight: { kind: 'normal' }, searchCancel: false }, { display: 'block', width: px(60) }, [control('f::editor', { kind: 'text-editor' }, {}, [text('f::editor:text0', 'XX')], strut)], null);
    const area = control('a', { kind: 'text-area', cols: 4, rows: 2, font: ahemFont(10), lineHeight: { kind: 'normal' } }, { display: 'block' }, [control('a::editor', { kind: 'text-editor' }, {}, [text('a::editor:text0', 'XX XX')], strut)], null);
    const root = { ...box('html', { width: px(100) }), children: [select, field, area] };
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root };
    expect(hitRefusal(input)).toBeNull();
    const facts = new Map(['html', 's', 'f', 'a'].map((id) => [id, { pointerEvents: 'auto', inherited: true, activation: false, radii: [] }] as const));
    const t = hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
    expect(t.ids).toEqual(['html', 's', 'f', 'a']);
  });

  it('leaves the same tree with a plain box in the control\'s place unaffected', async () => {
    const { hitRefusal, hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    for (const display of ['block', 'flex'] as const) {
      const { input, facts } = await setup(display, false, 'button');
      expect(hitRefusal(input), display).toBeNull();
      const t = hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
      expect(t.ids.filter((id) => !id.includes(':')), display).toEqual(['html', 'p', 'wrap', 'btn', 'label', 'icon', 'after']);
    }
  });
});

// PR #75 round 1 (Macroscope 4170551537, 4170551540, 4170551550): flex line grouping under wrap-reverse, and the work per point and
// per table, counted by reads so the bound is exact rather than a timing.
describe('hitTableOf and prepareHit scale with the table', () => {
  const flexInput = async (n: number, wrap: 'wrap' | 'wrap-reverse', itemHeight: number, itemWidth = 30) => {
    const { box, neutralEnvironment, px } = await import('./helpers.ts');
    const items = Array.from({ length: n }, (_, k) => box(`i${k}`, { width: px(itemWidth), height: px(itemHeight) }));
    const container = box('f', { display: 'flex', flexWrap: wrap, width: px(100) }, items);
    const root = box('html', {}, [container]);
    const facts = new Map(['html', 'f', ...items.map((b) => b.id)].map((id) => [id, { pointerEvents: 'auto', inherited: true, activation: false, radii: [] }] as const));
    return { input: { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, facts, container };
  };

  it('groups zero-height wrap-reverse items into lines by their main position, and refuses one neither axis places (4170551537)', async () => {
    const { hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    // Three 30px items per 100px line: lines [i0 i1 i2] [i3], reversed under wrap-reverse, whether the items have a height or not.
    for (const h of [10, 0]) {
      const { input, facts } = await flexInput(4, 'wrap-reverse', h);
      expect(hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS).nodes.slice(2).map((x) => x.order)).toEqual([1, 2, 3, 0]);
    }
    // rtl: the main axis runs right to left.
    const rtl = await flexInput(4, 'wrap-reverse', 0);
    const rtlRoot = { ...rtl.input.root, children: [{ ...rtl.container, style: { ...rtl.container.style, direction: 'rtl' as const } }] };
    expect(hitTableOf({ ...rtl.input, root: rtlRoot }, ahemMeasurer, rtl.facts, NO_HIT_TABLE_FAULTS).nodes.slice(2).map((x) => x.order)).toEqual([1, 2, 3, 0]);
    // Zero-size items sit at one point: neither axis tells the lines apart, so wrap-reverse is refused and wrap keeps engine order.
    const dot = await flexInput(3, 'wrap-reverse', 0, 0);
    expect(() => hitTableOf(dot.input, ahemMeasurer, dot.facts, NO_HIT_TABLE_FAULTS)).toThrow(new HitError('i1: a wrap-reverse flex item whose line neither its cross nor its main position tells'));
    const dotWrap = await flexInput(3, 'wrap', 0, 0);
    expect(hitTableOf(dotWrap.input, ahemMeasurer, dotWrap.facts, NO_HIT_TABLE_FAULTS).nodes.slice(2).map((x) => x.order)).toEqual([0, 1, 2]);
  });

  it('orders a flex container\'s items with one pass over its children, not one per item (4170551550)', async () => {
    const { hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer, layout } = await import('../src/index.ts');
    const reads = async (n: number, table: boolean): Promise<number> => {
      const { input, facts, container } = await flexInput(n, 'wrap', 10);
      let count = 0;
      const counted = new Proxy(container.children, { get: (t, k, r) => { if (typeof k === 'string' && /^\d+$/.test(k)) count++; return Reflect.get(t, k, r); } });
      const root = { ...input.root, children: [{ ...container, children: counted }] };
      if (table) hitTableOf({ ...input, root }, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
      else layout({ ...input, root }, ahemMeasurer);
      return count;
    };
    // The table's own reads beyond the engine's layout of the input are linear in the items (the old fragmentOrder read n^3).
    for (const n of [20, 40]) expect((await reads(n, true)) - (await reads(n, false)) * 2).toBeLessThanOrEqual(4 * n);
  });

  it('tests a line against its own text pieces only, grouped once by prepareHit (4170551540)', async () => {
    const { hitAt, prepareHit } = await import('../src/rt-hit.ts');
    const n = 200;
    const nodes: HitNode[] = [box(-1, 0, 0, 0, 400, 3000), box(0, 1, 0, 0, 30, 10 * n)];
    for (let k = 0; k < n; k++) {
      nodes.push({ ...box(1, 1, 0, 10 * k, 20, 10), kind: 'line', line: k });
      nodes.push({ ...box(1, 1, 0, 10 * k, 20, 10), kind: 'text', line: k, inkLeft: 0, inkTop: 10 * k * PX, inkRight: 20 * PX, inkBottom: (10 * k + 10) * PX });
    }
    const prepared = prepareHit(nodes, NO_HIT_FAULTS);
    expect(prepared.lineTexts[2]).toEqual([3]);
    expect(prepared.lineTexts[2 + 2 * (n - 1)]).toEqual([3 + 2 * (n - 1)]);
    expect(prepared.lineTexts[3]).toEqual([]);
    let count = 0;
    const counted = new Proxy(nodes, { get: (t, k, r) => { if (typeof k === 'string' && /^\d+$/.test(k)) count++; return Reflect.get(t, k, r); } });
    const p = { ...prepared, nodes: counted };
    expect(hitAt(p, 5 * PX, 5 * PX)).toBe(1);
    // Every line is visited once with its one piece: linear in the nodes (the old scan read every piece for every line, n^2).
    expect(count).toBeLessThanOrEqual(8 * nodes.length);
  });

  it('refuses a text or line node whose line is not a small whole number', () => {
    const root = box(-1, 0, 0, 0, 400, 300);
    for (const line of [-1, 0.5, 99]) {
      expect(() => hitTest([root, box(0, 1, 0, 0, 30, 10), { ...box(1, 1, 0, 0, 20, 10), kind: 'line', line }], 0, 0, NO_HIT_FAULTS)).toThrow(/has line/);
    }
  });
});

// Chrome 145 elementFromPoint (measured 2026-10-03, PR #75 pre-landing review): positioned flex items stack in order-modified
// document order with an absolute child at order 0, never reversed by a reverse direction; static items keep fragment order.
describe('hitTableOf stacks positioned flex children in order-modified document order', () => {
  const answer = async (dir: 'row' | 'row-reverse' | 'column-reverse', items: readonly [string, Record<string, unknown>][], x: number, y: number, extra: Record<string, unknown> = {}): Promise<string | undefined> => {
    const { hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    const { box, neutralEnvironment, px } = await import('./helpers.ts');
    const row = dir.startsWith('row');
    const { divStyle } = await import('./helpers.ts');
    // An id starting with img is a replaced leaf (REPL-a) with the same style, laid out at the same size.
    const kids = items.map(([id, s]) => (id.startsWith('img')
      ? { kind: 'replaced', id, style: { ...divStyle, display: 'block', width: px(60), height: px(40), ...s }, natural: { kind: 'image', width: 4, height: 4 }, defaultWidth: 300, defaultHeight: 150, objectFit: 'fill', objectPositionX: px(0), objectPositionY: px(0) }
      : box(id, { width: px(60), height: px(40), ...s }))) as unknown as ReturnType<typeof box>[];
    const flex = box('f', { display: 'flex', flexDirection: dir, position: 'relative', width: px(row ? 200 : 60), height: px(row ? 40 : 200), ...extra }, kids);
    const root = box('html', { width: px(400) }, [flex]) as unknown as Parameters<typeof hitTableOf>[0]['root'];
    const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root };
    const fact = { pointerEvents: 'auto', inherited: true, activation: false, radii: [] };
    const facts = new Map(['html', 'f', ...items.map(([id]) => id)].map((id) => [id, fact])) as unknown as Parameters<typeof hitTableOf>[2];
    const t = hitTableOf(input as Parameters<typeof hitTableOf>[0], ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
    return t.ids[hitTest(t.nodes, x * PX, y * PX, NO_HIT_FAULTS)];
  };
  const rel = { position: 'relative' };
  const len = (value: number) => ({ kind: 'px', value });
  const overlay = { position: 'absolute', left: len(0), top: len(0), width: len(200), height: len(40) };
  it('an absolute child keeps its document slot among relative items (Chrome: ov at 90,20)', async () => {
    expect(await answer('row', [['i1', rel], ['i2', rel], ['ov', overlay]], 90, 20)).toBe('ov');
    expect(await answer('row', [['ov', overlay], ['i1', rel], ['i2', rel]], 90, 20)).toBe('i2');
  });
  it('an absolute child counts as order 0 (Chrome: an order 1 item over a later ov, a later order -1 item under ov)', async () => {
    expect(await answer('row', [['i1', { ...rel, order: 1 }], ['ov', overlay]], 30, 20)).toBe('i1');
    expect(await answer('row', [['ov', overlay], ['i1', { ...rel, order: -1 }]], 30, 20)).toBe('ov');
  });
  it('a positioned replaced item stacks by its order like a box (REPL-a; Chrome: mi over ms in hit-order)', async () => {
    // img with order 1 is laid out after s (0..60, margin-right -30) at 30..90 and paints over it; at order 0 it would lose by tree order.
    expect(await answer('row', [['img', { ...rel, order: 1 }], ['s', { ...rel, marginRight: len(-30) }]], 45, 20)).toBe('img');
    expect(await answer('row', [['img', { ...rel, order: -1 }], ['s', { ...rel, marginLeft: len(-30) }]], 45, 20)).toBe('s');
  });
  it('a reverse direction does not reverse positioned items (Chrome: i2 at 155,20 and j2 at 30,170), but does static ones', async () => {
    expect(await answer('row-reverse', [['i1', rel], ['i2', { ...rel, marginRight: len(-30) }]], 155, 20)).toBe('i2');
    expect(await answer('column-reverse', [['j1', { ...rel, marginTop: len(-20) }], ['j2', rel]], 30, 170)).toBe('j2');
    expect(await answer('row-reverse', [['s1', { marginLeft: len(-30) }], ['s2', {}]], 155, 20)).toBe('s1');
  });
});

// OVFL: a scroll container (hidden, auto or scroll, at rest) and clip on both axes clip hits to the padding box; visible does not.
describe('hitTableOf clips every clipping overflow', () => {
  it('marks hidden, auto, scroll and clip boxes as clipping, and visible ones not; a point past an auto box falls outside it', async () => {
    const { hitTableOf, hitTest } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    const { box, neutralEnvironment, px } = await import('./helpers.ts');
    const at = (o: 'visible' | 'hidden' | 'auto' | 'scroll' | 'clip') => {
      const c = box('c', { overflowX: o, overflowY: o, width: px(20), height: px(20) }, [box('k', { width: px(60), height: px(10) })]);
      const root = box('html', { width: px(100) }, [c]);
      const input = { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root };
      const fact = { pointerEvents: 'auto', inherited: true, activation: false, radii: [] } as const;
      return hitTableOf(input, ahemMeasurer, new Map([['html', fact], ['c', fact], ['k', fact]]), NO_HIT_TABLE_FAULTS);
    };
    for (const o of ['hidden', 'auto', 'scroll', 'clip'] as const) {
      const t = at(o);
      expect(t.nodes[1]?.clips, o).toBe(true);
      expect(t.ids[hitTest(t.nodes, 40 * PX, 5 * PX, NO_HIT_FAULTS)], o).toBe('html');
    }
    const v = at('visible');
    expect(v.nodes[1]?.clips).toBe(false);
    expect(v.ids[hitTest(v.nodes, 40 * PX, 5 * PX, NO_HIT_FAULTS)]).toBe('k');
  });
});

// GRID G-HIT: Blink paints grid items atomically in order-modified document order (css-grid-2 §9), so of two items in one cell
// the one later in that order is hit, whatever their document order (G1a review #212 refused grids until this was modelled).
describe('grid containers', () => {
  const gridInput = async (inGrid: boolean) => {
    const { box, neutralEnvironment, px } = await import('./helpers.ts');
    const AUTO = { kind: 'breadth' as const, breadth: { kind: 'auto' as const } };
    const grid = { templateColumns: [], templateRows: [], autoColumns: [AUTO], autoRows: [AUTO], explicitColumnCount: 0, explicitRowCount: 0, autoRepeatColumns: null, autoRepeatRows: null, autoFlow: 'row' as const, dense: false, justifyItems: 'normal' as const };
    const cell = { column: { kind: 'definite' as const, start: 1, end: 2 }, row: { kind: 'definite' as const, start: 1, end: 2 }, justifySelf: 'auto' as const };
    const items = ['a', 'b'].map((id, k) => box(id, { height: px(20), order: 1 - k, ...(inGrid ? { gridItem: cell } : {}) }));
    const container = inGrid ? box('g', { display: 'grid', width: px(100), grid }, items) : box('g', { width: px(100) }, items);
    const root = box('html', {}, [box('body', {}, [container])]);
    const facts = new Map(['html', 'body', 'g', 'a', 'b'].map((id) => [id, { pointerEvents: 'auto', inherited: true, activation: false, radii: [] }] as const));
    return { input: { viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root }, facts };
  };

  it('hit-tests grid items atomically in order-modified document order: a (order 1) paints over b (order 0) in their shared cell', async () => {
    const { hitRefusal, hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer, layout } = await import('../src/index.ts');
    const { input, facts } = await gridInput(true);
    expect(layout(input, ahemMeasurer).kind).toBe('ok');
    expect(hitRefusal(input)).toBeNull();
    const v = hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS);
    expect(v.nodes.filter((n) => n.atomic).map((n) => [v.ids[n.target], n.order])).toEqual([['a', 1], ['b', 0]]);
    const a = v.nodes.find((n) => v.ids[n.target] === 'a');
    expect(v.ids[hitTest(v.nodes, (a?.x ?? 0) + 5 * PX, (a?.y ?? 0) + 5 * PX, NO_HIT_FAULTS)]).toBe('a');
  });

  it('leaves the same tree as block flow unaffected', async () => {
    const { hitRefusal, hitTableOf } = await import('../src/rt-hit.ts');
    const { ahemMeasurer } = await import('../src/index.ts');
    const { input, facts } = await gridInput(false);
    expect(hitRefusal(input)).toBeNull();
    expect(hitTableOf(input, ahemMeasurer, facts, NO_HIT_TABLE_FAULTS).ids).toEqual(['html', 'body', 'g', 'a', 'b']);
  });
});

describe('hitTest through rounded corners (SELD-R2b, FloatRoundedRect::IntersectsQuad)', () => {
  // A 100 px circle: radii 50 px on every corner, outer then inner (no border).
  const circle = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
  it('misses a rounded box where the hit box lies outside its corner ellipse, and hits where it touches the ellipse', () => {
    const nodes = [box(-1, 0, 0, 0, 200, 200), box(0, 1, 0, 0, 100, 100, { radii: circle })];
    // The hit box [14, 15] px reaches (15, 15), 49.5 px from the centre; [13, 14] reaches only (14, 14), 50.9 px away.
    expect(at(nodes, 14, 14)).toBe(1);
    expect(at(nodes, 13, 13)).toBe(0);
    expect(at(nodes, 1, 50)).toBe(1);
    expect(at(nodes, 50, 50)).toBe(1);
    expect(at(nodes, 99, 99)).toBe(0);
  });
  it('clips a rounded clipping box\'s in-flow content to its rounded padding edge', () => {
    const nodes = [box(-1, 0, 0, 0, 200, 200), box(0, 1, 0, 0, 100, 100, { radii: circle, clips: true }), box(1, 2, 0, 0, 100, 100)];
    expect(at(nodes, 50, 50)).toBe(2);
    expect(at(nodes, 5, 5)).toBe(0);
  });
  it('tests a square box as its rectangle', () => {
    const nodes = [box(-1, 0, 0, 0, 200, 200), box(0, 1, 0, 0, 100, 100)];
    expect(at(nodes, 0, 0)).toBe(1);
  });
});
