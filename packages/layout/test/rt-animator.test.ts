// T065 ANIM-b1 3b: the runtime animator's own rules on hand-built tables. Its equality with Chrome at every sample is the frame
// lanes' (packages/parity anim-frames.test.ts); its translation is the animator suite's (packages/translate).
import { describe, expect, it } from 'vitest';
import type { LayoutInput } from '../src/input.ts';
import { NO_RT_FAULTS } from '../src/rt-easing.ts';
import type { AnimTables, EasingCode, ListingCode, ValueCode } from '../src/rt-animator.ts';
import { animatorAdvance, animatorBusy, animatorEvent, animatorFrame, animatorStart, colorOf, frameColors, lengthBase, NO_ANIMATOR_FAULTS, patchInput } from '../src/rt-animator.ts';
import { legacyColor, serializeColor, serializeValue } from '../src/rt-interpolate.ts';
import { box, divStyle, neutralEnvironment, pct, px } from './helpers.ts';

const LINEAR: EasingCode = { kind: 'linear', x1: 0, y1: 0, x2: 0, y2: 0, steps: 1, position: 'end' };
const NONE: ValueCode = { kind: 'none', r: 0, g: 0, b: 0, alpha: 0, px: 0, percent: 0, calc: false };
const rgb = (r: number, g: number, b: number): ValueCode => ({ ...NONE, kind: 'color', r, g, b, alpha: 1 });
const listed = (duration: number): ListingCode => ({ present: true, mode: 'listed', delay: 0, duration, easing: LINEAR });
const viewport = { width: 400, height: 300 };
const input = (width: number, child = true): LayoutInput => ({
  viewport,
  devicePixelRatio: 1,
  ...neutralEnvironment(viewport),
  root: box('root', {}, child ? [box('a', { width: px(width), marginLeft: pct(10) })] : []),
});

// Assignment 0: a is 10px wide and black; 1: 110px and white; 2: a is absent.
const TABLES: AnimTables = {
  assignments: 3,
  slots: [
    { node: 'a', property: 'width', kind: 'length', range: 'non-negative', values: [NONE, NONE, NONE], listings: [listed(1), listed(1), { ...listed(0), present: false }] },
    { node: 'a', property: 'background-color', kind: 'color', range: 'all', values: [rgb(0, 0, 0), rgb(255, 255, 255), NONE], listings: [listed(1), listed(1), { ...listed(0), present: false }] },
  ],
  animations: [],
  keyframes: [],
  rendered: [{ node: 'root', values: [true, true, true] }, { node: 'a', values: [true, true, false] }],
  bases: [],
  closure: [{ source: { node: 'a', property: 'background-color' }, writes: [{ node: 'b', property: 'color' }] }],
};
const INPUTS = [input(10), input(110), input(0, false)];
const show = (v: Parameters<typeof serializeValue>[0]): string => serializeValue(v, 0, 0, { sin: Math.sin, cos: Math.cos });
const frameText = (t: AnimTables, s: ReturnType<typeof animatorStart>): string[] => animatorFrame(s, t, NO_RT_FAULTS).map((e) => `${e.node} ${e.property} ${show(e.value)}`);

describe('rt-animator', () => {
  it('runs a transition from the first event to its end, and the display driver only while one runs', () => {
    let s = animatorStart(TABLES, INPUTS, 0, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    expect(frameText(TABLES, s)).toEqual([]);
    expect(animatorBusy(s)).toBe(false);
    s = animatorEvent(s, TABLES, INPUTS, 0, 1, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    s = animatorAdvance(s, TABLES, INPUTS, 0, 500, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    expect(frameText(TABLES, s)).toEqual(['a width 60px', 'a background-color rgb(128, 128, 128)']);
    expect(animatorBusy(s)).toBe(true);
    s = animatorAdvance(s, TABLES, INPUTS, 0, 500, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    s = animatorAdvance(s, TABLES, INPUTS, 0, 1, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    expect(frameText(TABLES, s)).toEqual([]);
    expect(animatorBusy(s)).toBe(false);
  });

  // REPL-a follow-up: an img or iframe is a replaced leaf, not a box; the animator read and patched only boxes, so a length
  // animation on an img was dropped on native without a word.
  it('reads and patches the lengths of a replaced leaf (img, iframe) as of a box', () => {
    const leaf = (width: number) => ({ kind: 'replaced', id: 'i', style: { ...divStyle, width: px(width), marginLeft: pct(10) }, natural: { kind: 'image', width: 10, height: 8 }, defaultWidth: 300, defaultHeight: 150, objectFit: 'fill', objectPositionX: px(0), objectPositionY: px(0) }) as const;
    const withImg = (width: number): LayoutInput => ({ viewport, devicePixelRatio: 1, ...neutralEnvironment(viewport), root: box('root', {}, [box('p', {}, [leaf(width) as never])]) });
    expect(show(lengthBase(withImg(40), 'i', 'width') as never)).toBe('40px');
    expect(show(lengthBase(withImg(40), 'i', 'margin-left') as never)).toBe('10%');
    const v = { kind: 'length' as const, number: 0, length: { kind: 'px' as const, px: 25, percent: 0 }, color: { r: 0, g: 0, b: 0, alpha: 0 }, ops: [] };
    const tables: AnimTables = { ...TABLES, slots: [{ ...(TABLES.slots[0] as AnimTables['slots'][number]), node: 'i' }] };
    const patched = patchInput(withImg(40), [{ node: 'i', property: 'width', value: v }], tables);
    const img = (patched.root.children[0] as ReturnType<typeof box>).children[0] as ReturnType<typeof leaf>;
    expect(img.kind).toBe('replaced');
    expect(img.style.width).toEqual({ kind: 'px', value: 25 });
    expect(img.style.marginLeft).toEqual({ kind: 'percent', value: 10 });
  });

  it('cancels a transition when its node goes away, and refuses an assignment or a step it does not have', () => {
    let s = animatorStart(TABLES, INPUTS, 0, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    s = animatorEvent(s, TABLES, INPUTS, 0, 1, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    s = animatorEvent(s, TABLES, INPUTS, 0, 2, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    expect(frameText(TABLES, s)).toEqual([]);
    expect(() => animatorEvent(s, TABLES, INPUTS, 0, 3, NO_RT_FAULTS, NO_ANIMATOR_FAULTS)).toThrow(/no assignment 3/);
    for (const ms of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => animatorAdvance(s, TABLES, INPUTS, 0, ms, NO_RT_FAULTS, NO_ANIMATOR_FAULTS)).toThrow(/finite, non-negative/);
    expect(() => animatorStart(TABLES, INPUTS.slice(0, 2), 0, NO_RT_FAULTS, NO_ANIMATOR_FAULTS)).toThrow(/2 resolved engine inputs for 3 assignments/);
    expect(() => animatorStart({ ...TABLES, rendered: [] }, INPUTS, 0, NO_RT_FAULTS, NO_ANIMATOR_FAULTS)).not.toThrow();
    expect(() => animatorEvent(s, { ...TABLES, rendered: [] }, INPUTS, 0, 1, NO_RT_FAULTS, NO_ANIMATOR_FAULTS)).toThrow(/the rendered table has no node a/);
  });

  it('reads length endpoints from the resolved input (auto is not interpolable) and patches lengths back as px, % or a calc() sum', () => {
    expect(show(lengthBase(INPUTS[1] as LayoutInput, 'a', 'width') as never)).toBe('110px');
    expect(show(lengthBase(INPUTS[1] as LayoutInput, 'a', 'margin-left') as never)).toBe('10%');
    expect(lengthBase(INPUTS[1] as LayoutInput, 'a', 'height')).toBeNull();
    expect(lengthBase(INPUTS[2] as LayoutInput, 'a', 'width')).toBeNull();
    expect(() => lengthBase(INPUTS[1] as LayoutInput, 'a', 'flex-grow')).toThrow(/no length field for flex-grow/);
    const v = (length: { kind: 'px' | 'percent' | 'calc'; px: number; percent: number }) => ({ kind: 'length' as const, number: 0, length, color: { r: 0, g: 0, b: 0, alpha: 0 }, ops: [] });
    const patched = patchInput(INPUTS[0] as LayoutInput, [{ node: 'a', property: 'width', value: v({ kind: 'calc', px: 4, percent: 50 }) }, { node: 'a', property: 'margin-left', value: v({ kind: 'px', px: 7, percent: 0 }) }], { ...TABLES, bases: [{ node: 'a', property: 'margin-left', kind: 'length', range: 'all', values: [NONE, NONE, NONE] }] });
    const a = (patched.root.children[0] as ReturnType<typeof box>).style;
    expect(a.width).toEqual({ kind: 'calc', expr: { kind: 'sum', terms: [{ kind: 'percent', value: 50 }, { kind: 'px', value: 4 }] }, range: 'non-negative' });
    expect(a.marginLeft).toEqual({ kind: 'px', value: 7 });
    // A frame without lengths leaves the input as it is.
    expect(patchInput(INPUTS[0] as LayoutInput, [], TABLES)).toBe(INPUTS[0]);
  });

  it('draws colours with Chrome serialised channels and 8-bit alpha, and carries an animated colour to its closure', () => {
    for (const [r, g, b, alpha] of [[0.4999, 127.5, 254.6, 1], [12.25, 99.5, 200.75, 0.5], [1, 2, 3, 0.002], [300, -4, 255, 0.999]] as const) {
      const c = legacyColor(r, g, b, alpha);
      const o = colorOf(c);
      const text = serializeColor(c);
      const m = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(text);
      expect(m, text).not.toBeNull();
      expect([o.r, o.g, o.b], text).toEqual([Number(m?.[1]), Number(m?.[2]), Number(m?.[3])]);
      // The serialised alpha is the shortest decimal that rounds back to the same 8-bit alpha.
      expect(Math.round(Number(m?.[4] ?? 1) * 255), text).toBe(o.alpha);
    }
    let s = animatorStart(TABLES, INPUTS, 0, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    s = animatorEvent(s, TABLES, INPUTS, 0, 1, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    s = animatorAdvance(s, TABLES, INPUTS, 0, 250, NO_RT_FAULTS, NO_ANIMATOR_FAULTS);
    const frame = animatorFrame(s, TABLES, NO_RT_FAULTS);
    expect(frameColors(frame, TABLES, NO_ANIMATOR_FAULTS).map((c) => `${c.node} ${c.property} ${c.rgba.r},${c.rgba.g},${c.rgba.b},${c.rgba.alpha}`)).toEqual(['a background-color 64,64,64,255', 'b color 64,64,64,255']);
    expect(frameColors(frame, TABLES, { ...NO_ANIMATOR_FAULTS, inheritedNotPropagated: true }).map((c) => c.node)).toEqual(['a']);
  });
});
