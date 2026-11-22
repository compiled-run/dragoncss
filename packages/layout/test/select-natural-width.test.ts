// FORM-b S4: a select's min- and max-content inline size is its widest option label, measured in the inner element's text style and
// rounded up to a whole px, plus the inner element's inline margins; a block select's auto width fits it. Chrome's own numbers are
// the parity fixture controls-select-natural-width; this pins the engine's rule, its planted fault and its validation.
import { describe, expect, it } from 'vitest';
import type { ControlBox, LayoutInput } from '../src/index.ts';
import { ahemMeasurer, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '../src/index.ts';
import { ahemFont, box, control, neutralEnvironment, px, text } from './helpers.ts';

const strut = { font: ahemFont(10), lineHeight: { kind: 'normal' } } as const;
const select = (labels: readonly string[], shown: string, margins = 0, over: Partial<ControlBox['style']> = {}): ControlBox =>
  control('s', { kind: 'select-menulist', font: ahemFont(10), lineHeight: { kind: 'normal' }, arrowWidth: 0, options: labels.map((l, k) => text(`s::option${k}:text0`, l)) }, { display: 'flex', ...over }, [
    control('s::inner', { kind: 'select-inner' }, { marginLeft: px(margins), marginRight: px(margins) }, shown === '' ? [] : [text('s::inner:text0', shown)], strut),
  ]);
const input = (s: ControlBox): LayoutInput => ({ viewport: { width: 400, height: 300 }, devicePixelRatio: 1, ...neutralEnvironment({ width: 400, height: 300 }), root: { ...box('html', { width: px(400) }), children: [s] } });
const widthOf = (s: ControlBox, faults = NO_ENGINE_FAULTS): number => {
  const r = layoutWithFaults(input(s), ahemMeasurer, faults);
  if (r.kind !== 'ok') throw new Error(JSON.stringify(r));
  return (r.boxes.find((b) => b.id === 's')?.width ?? NaN) / 64;
};

describe('a select\'s natural width (FORM-b S4)', () => {
  it('fits a block select to its widest option, whichever option shows, plus the inner element\'s margins', () => {
    expect(widthOf(select(['XX', 'XXXXXXX', 'XXX'], 'XX'))).toBe(70);
    expect(widthOf(select(['XX', 'XXXXXXX', 'XXX'], 'XXX'))).toBe(70);
    expect(widthOf(select(['XX', 'XXXXXXX'], 'XX', 4))).toBe(78);
    expect(widthOf(select([], '', 4))).toBe(8);
  });
  it('measures each option in its own text style, letter-spacing included', () => {
    const spaced = select(['XX', 'XXXX'], 'XX');
    const c = spaced.control as Extract<ControlBox['control'], { kind: 'select-menulist' }>;
    const wide = { ...spaced, control: { ...c, options: c.options.map((o) => ({ ...o, letterSpacing: px(2) })) } };
    expect(widthOf(wide)).toBe(48);
  });
  it('catches the planted menuListShownLabelOnly, which measures the shown label alone', () => {
    expect(widthOf(select(['XX', 'XXXXXXX'], 'XX'), { ...NO_ENGINE_FAULTS, menuListShownLabelOnly: true })).toBe(20);
  });
  it('validates the option leaves as text leaves', () => {
    expect(validateLayoutInput(JSON.parse(JSON.stringify(input(select(['XX'], 'XX'))))).ok).toBe(true);
    const bad = JSON.parse(JSON.stringify(input(select(['XX'], 'XX')))) as { root: { children: { control: { options: unknown[] } }[] } };
    (bad.root.children[0] as { control: { options: unknown[] } }).control.options = [{ kind: 'box' }];
    expect(validateLayoutInput(bad).ok).toBe(false);
  });
});
