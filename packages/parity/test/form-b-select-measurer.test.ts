// FORM-b select: a select in a face other than Ahem resolves its normal line height and its drop-down arrow with the layout's own
// measurer (layout.ts resolvedInput), as Chrome's MenuListInnerElement reads the select's primary font.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ControlBox, LayoutBox, LayoutInput, LayoutStyle, LineStrut } from '@dragon/layout';
import { borderDevicePx } from 'dragon';
import { deviceShapedMeasurer, layout, LU_PER_PX, menuListArrows, NO_ENGINE_FAULTS, resolvedInput } from '@dragon/layout';
import { vendorFontBytes } from '../src/font-reference.ts';
import { repoPath } from '../src/paths.ts';
import { expectedEngine } from '../src/native-host.ts';
import { fontDataOf, hostShaper, registerFace } from '../src/text-shaper-host.ts';

const lato = registerFace(new Uint8Array(vendorFontBytes('Lato/Lato-Regular.ttf')));
const measurer = deviceShapedMeasurer(new Map([[lato, fontDataOf(lato)]]), hostShaper);

/** The controls-select-button vector with every Ahem font in Lato. */
function latoInput(dpr: number): LayoutInput {
  const v = JSON.parse(readFileSync(repoPath('packages/layout/vectors/controls-select-button.json'), 'utf8')) as { input: LayoutInput };
  const swap = (x: unknown): unknown => (Array.isArray(x) ? x.map(swap) : x !== null && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, y]) => [k, k === 'family' && y === 'Ahem' ? lato : swap(y)])) : x);
  return { ...(swap(v.input) as LayoutInput), devicePixelRatio: dpr };
}

type Inner = { readonly select: ControlBox; readonly inner: ControlBox };
function inners(b: LayoutBox | ControlBox, out: Inner[]): Inner[] {
  for (const k of b.children) {
    if (k.kind !== 'box' && k.kind !== 'control') continue;
    if (b.kind === 'control' && b.control.kind === 'select-menulist' && k.kind === 'control' && k.control.kind === 'select-inner') out.push({ select: b, inner: k });
    inners(k, out);
  }
  return out;
}

/** The input with each menulist-button select's top padding 1ex and its start padding 2ch of its own (Lato) font. */
function withFontLengths(input: LayoutInput): LayoutInput {
  const walk = (b: LayoutBox | ControlBox): LayoutBox | ControlBox => {
    const children = b.children.map((k) => (k.kind === 'box' || k.kind === 'control' ? walk(k) : k));
    if (b.kind !== 'control' || b.control.kind !== 'select-menulist' || b.control.arrowWidth === 0) return { ...b, children } as LayoutBox | ControlBox;
    const font = b.control.font;
    const of = (metric: 'ex' | 'ch', value: number): LayoutStyle['paddingTop'] => ({ kind: 'calc', expr: { kind: 'font-metric', value, metric, font }, range: 'non-negative' }) as LayoutStyle['paddingTop'];
    return { ...b, style: { ...b.style, paddingTop: of('ex', 1), paddingLeft: of('ch', 2) }, children } as ControlBox;
  };
  return { ...input, root: walk(input.root) as LayoutBox };
}

describe('FORM-b select in a face other than Ahem', () => {
  it('resolves a padding in ex and ch with the layout\'s measurer for the device borders and the arrows', () => {
    for (const dpr of [1, 2.625, 3]) {
      const input = withFontLengths(latoInput(dpr));
      const r = layout(input, measurer);
      if (r.kind !== 'ok') throw new Error(`refused: ${r.unsupported.code} at ${r.unsupported.nodeId}`);
      const engine = expectedEngine();
      const borders = borderDevicePx(engine, input, measurer);
      const selects = inners(resolvedInput(input, measurer, NO_ENGINE_FAULTS).root, []).filter((s) => s.select.control.kind === 'select-menulist' && s.select.control.arrowWidth > 0);
      expect(selects.length).toBeGreaterThan(5);
      for (const { select } of selects) {
        if (select.control.kind !== 'select-menulist') continue;
        expect(borders.has(select.id), `${select.id}@${dpr}`).toBe(true);
        const font = select.control.font;
        const ex = measurer.lengths({ family: font.family, size: font.size, letterSpacing: 0, wordSpacing: 0, smallCaps: false }).xHeight;
        const pad = select.style.paddingTop;
        expect(pad.kind === 'px' ? Math.abs(pad.value - ex) : Infinity, `${select.id}@${dpr}: 1ex is Lato's x-height`).toBeLessThan(0.01);
        expect(pad.kind === 'px' ? pad.value : 0, `${select.id}@${dpr}: Lato's ex is not Ahem's 0.8em`).not.toBeCloseTo(0.8 * font.size, 2);
      }
      expect(menuListArrows(input, r.boxes, measurer).length).toBe(selects.length);
    }
  });

  for (const dpr of [1, 3]) {
    it(`gives one arrow per menulist-button select instead of refusing the face, at ${dpr}x`, () => {
      const input = latoInput(dpr);
      expect(JSON.stringify(input)).not.toContain('"Ahem"');
      const r = layout(input, measurer);
      if (r.kind !== 'ok') throw new Error(`refused: ${r.unsupported.code} at ${r.unsupported.nodeId}`);
      const arrows = menuListArrows(input, r.boxes, measurer);
      const selects = inners(resolvedInput(input, measurer, NO_ENGINE_FAULTS).root, []).filter((s) => s.select.control.kind === 'select-menulist' && s.select.control.arrowWidth > 0);
      expect(selects.length).toBeGreaterThan(5);
      expect(arrows.map((a) => a.id)).toEqual(selects.map((s) => s.select.id));
    });

    it(`gives a select of line-height normal an inner line height of Lato's ascent + descent, at ${dpr}x`, () => {
      const given = inners(latoInput(dpr).root, []);
      const resolved = new Map(inners(resolvedInput(latoInput(dpr), measurer, NO_ENGINE_FAULTS).root, []).map((s) => [s.select.id, s]));
      let normal = 0;
      for (const g of given) {
        if (g.select.control.kind !== 'select-menulist' || g.select.control.lineHeight.kind !== 'normal') continue;
        const s = resolved.get(g.select.id);
        if (s === undefined || s.select.control.kind !== 'select-menulist') throw new Error(`${g.select.id} is not resolved`);
        const font = s.select.control.font;
        const m = measurer.metrics({ family: font.family, size: font.size, letterSpacing: 0, wordSpacing: 0, smallCaps: false });
        const strut = s.inner.strut as LineStrut;
        expect(strut.lineHeight, g.select.id).toEqual({ kind: 'px', value: (m.ascent + m.descent) / LU_PER_PX });
        expect((m.ascent + m.descent) / LU_PER_PX, `${g.select.id}: Lato's line is not its em, as Ahem's is`).not.toBe(font.size);
        normal++;
      }
      expect(normal).toBeGreaterThan(0);
    });
  }
});
