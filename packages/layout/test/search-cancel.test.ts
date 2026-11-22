// FORM-search: a search field's cancel button takes clamp(lround(9 x computed pixel size / 13), 5, 21) device px at the inline end
// of its editor and placeholder, with 1px and 3px margins. The Chrome 145 numbers are the parity fixture controls-search; this pins
// the engine's rule at every measured font and DPR, its rtl side and its planted fault.
import { describe, expect, it } from 'vitest';
import type { ControlBox, LayoutInput } from '../src/index.ts';
import { ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS } from '../src/index.ts';
import { ahemFont, box, control, neutralEnvironment, px, text } from './helpers.ts';

const field = (search: boolean, size = 16, direction: 'ltr' | 'rtl' = 'ltr'): ControlBox =>
  control('s', { kind: 'text-field', size: 20, font: ahemFont(size), lineHeight: { kind: 'normal' }, cancelButton: search ? { marginStart: 1, marginEnd: 3 } : null }, { width: px(300), direction }, [
    control('s::placeholder', { kind: 'text-placeholder' }, { direction }, [text('s::placeholder:text0', 'PP')]),
    control('s::editor', { kind: 'text-editor' }, { direction }, [], { font: ahemFont(size), lineHeight: { kind: 'normal' } }),
  ]);
const input = (f: ControlBox, dpr: number): LayoutInput => ({ viewport: { width: 400, height: 300 }, ...neutralEnvironment({ width: 400, height: 300 }), devicePixelRatio: dpr, root: { ...box('html', { width: px(400) }), children: [f] } });
const rects = (f: ControlBox, dpr = 1, faults = NO_ENGINE_FAULTS): Map<string, { x: number; width: number }> => {
  const r = layoutWithFaults(input(f, dpr), ahemMeasurer, faults);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r));
  return new Map(r.boxes.map((b) => [b.id, { x: b.x / 64, width: b.width / 64 }]));
};

describe("a search field's cancel button (FORM-search)", () => {
  it('has the side Chrome 145 gives at every measured font size and DPR, in device px', () => {
    // [font CSS px, DPR, side in device px]: the fixture's and the spec's measurements.
    const measured: readonly (readonly [number, number, number])[] = [
      [5, 1, 5], [10, 1, 7], [12.4, 1, 8], [13.333, 1, 9], [16, 1, 11], [17.5, 1, 12], [20, 1, 14], [24, 1, 17], [40, 1, 21],
      [10, 2, 14], [13.333, 2, 19], [16, 2, 21], [10, 2.625, 18], [13.333, 2.625, 21], [16, 2.625, 21], [10, 3, 21], [16, 3, 21],
    ];
    for (const [font, dpr, side] of measured) {
      const taken = (rects(field(false, font), dpr).get('s::editor')?.width ?? NaN) - (rects(field(true, font), dpr).get('s::editor')?.width ?? NaN);
      expect(taken, `${font}px at DPR ${dpr}`).toBeCloseTo(side + 4 * dpr, 5);
    }
  });
  it('ends the editor and the placeholder 15px before the content box ends at 16px, and leaves a text field alone', () => {
    const search = rects(field(true));
    const plain = rects(field(false));
    expect(search.get('s::editor')?.width).toBe((plain.get('s::editor')?.width ?? NaN) - 15);
    expect(search.get('s::placeholder')?.width).toBe((plain.get('s::placeholder')?.width ?? NaN) - 15);
    expect(search.get('s')?.width).toBe(plain.get('s')?.width);
  });
  it('takes 21 device px plus 4 CSS px at DPR 2.625, fractional in CSS px', () => {
    const search = rects(field(true), 2.625);
    const plain = rects(field(false), 2.625);
    expect((plain.get('s::editor')?.width ?? NaN) - (search.get('s::editor')?.width ?? NaN)).toBe(21 + 4 * 2.625);
  });
  it('scales by CSS zoom as by the DPR (Chrome 145: 16px at zoom 1.5 gives 17 device px)', () => {
    const zoomed = (f: ControlBox): ControlBox => ({ ...f, style: { ...f.style, zoom: [1.5] }, children: f.children.map((k) => (k.kind === 'control' ? { ...k, style: { ...k.style, zoom: [1.5] } } : k)) });
    const search = rects(zoomed(field(true)));
    const plain = rects(zoomed(field(false)));
    expect((plain.get('s::editor')?.width ?? NaN) - (search.get('s::editor')?.width ?? NaN)).toBe(17 + 4 * 1.5);
  });
  it('catches the planted searchCancelIgnored, which keeps the editor at the full content width', () => {
    expect(rects(field(true), 1, { ...NO_ENGINE_FAULTS, searchCancelIgnored: true }).get('s::editor')?.width).toBe(rects(field(false)).get('s::editor')?.width);
  });
});
