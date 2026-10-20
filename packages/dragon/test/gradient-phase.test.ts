// BG2-t phase (analysis/paint-values/gradient-phase.ts): a no-repeat gradient layer away from the start edge compiles natively only
// where the compiler proves its tile starts inside the box; elsewhere planBackground leaves the plan unmodelled and the device
// throws. The accepted cases are swept through planBackground, the predicate the device and the pixel reference use.
import type { BackgroundPaint, LayerGeometry } from '@dragon/layout';
import { NO_GRADIENT_FAULTS, planBackground, referenceTileSize } from '@dragon/layout';
import { describe, expect, it } from 'vitest';
import { NATIVE_DEVICE_DPRS } from '../src/analysis/paint-values/gradient-phase.ts';
import type { GradientWrite } from '../src/lower/paint/gradient.ts';
import { createProjectWith, nativePrograms, NO_FAULTS } from '../src/internal.ts';
import type { CompilerFaults } from '../src/internal.ts';
import type { TreeNode } from '../src/types.ts';
import { div, inputFor } from './helpers.ts';

const TARGETS = { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } as const;
const BOX = '.box { width: 70px; margin: 4px; padding: 3px; background-color: #eee; border: 2px solid #1a1a2e; }';
const TWO = (position: string): string => `.two { background-image: linear-gradient(#fa0, #05a), radial-gradient(#0a5, #50a); background-size: 30px 20px; background-repeat: no-repeat; background-position: ${position}; }`;

type Body = Parameters<typeof inputFor>[1];
const compileWith = (css: string, body: Body, faults: CompilerFaults = NO_FAULTS) => createProjectWith({ projectId: 'test', targets: TARGETS }, { faults, profiles: 'derive', direction: 'ltr' }).compile(inputFor(`body { margin: 0; } ${css}`, body));
const one: Body = (r) => [div(r, 'a', ['box', 'two'])];
/** The phase refusals of a page: target and message. */
const phase = (css: string, body: Body = one): string[] =>
  compileWith(css, body).diagnostics.filter((d) => d.message.includes('at a phase that is not a whole device px')).map((d) => `${d.target} ${d.message}`).sort();
const targetsOf = (out: readonly string[]): string[] => out.map((m) => m.split(' ')[0] as string);

/** The background write of node id in a compiled page's android program. */
function writeOf(css: string, id: string, body: Body = one, faults: CompilerFaults = NO_FAULTS): GradientWrite {
  const c = compileWith(css, body, faults);
  const p = nativePrograms(c, []);
  if (p.kind !== 'ready') throw new Error(`no native programs: ${p.reason}`);
  const node = p.programs['android-views'].nodes.find((n) => n.id === id);
  const w = node?.writes.find((x) => x.kind === 'background-layers') as unknown as GradientWrite | undefined;
  if (w === undefined) throw new Error(`${id}: no background-layers write`);
  return w;
}

/**
 * The plan of a write for a border box at (x, y), w x h CSS px, borders and padding in CSS px, at a device scale: the box as the
 * engine hands it to the device (LU of the zoomed layout; borders snapped as layout units.ts snapBorderWidth does, floored to whole
 * device px with 1 device px for a thinner non-zero one, or given in device px for an initial medium).
 */
function plan(w: GradientWrite, dpr: number, box: { x: number; y: number; w: number; h: number; border: number; padding: number; borderDevice?: number }, shift = { x: 0, y: 0 }): boolean {
  const lu = (v: number): number => Math.round(v * dpr * 64);
  const device = box.border * dpr;
  const b = (box.borderDevice ?? (device >= 1 ? Math.floor(device) : device > 0 ? 1 : 0)) * 64;
  const paint: BackgroundPaint = {
    box: { x: lu(box.x) + shift.x, y: lu(box.y) + shift.y, width: lu(box.w), height: lu(box.h), borders: [b, b, b, b], padding: [box.padding, box.padding, box.padding, box.padding].map(lu), obscures: w.obscures.map((o) => o === 'always' || (o === 'double' && b < 3 * 64)) },
    color: w.color,
    colorClip: w.colorClip,
    layers: w.layers.map((l) => ({ geometry: l.geometry as LayerGeometry, image: { ...l.gradient, stops: l.gradient.stops.map((s) => ({ color: s.color, unit: s.unit, value: s.value })) } })),
    lastIsBottom: w.lastIsBottom,
    zoom: dpr,
    tileSize: referenceTileSize(dpr),
    layerX: 0,
    layerY: 0,
  };
  return planBackground(paint, NO_GRADIENT_FAULTS).modelled;
}

const ALL_DPRS = [...new Set([...NATIVE_DEVICE_DPRS.ios, ...NATIVE_DEVICE_DPRS.android])];

describe('BG2-t: a no-repeat layer away from the start edge (background-blend-initial .two)', () => {
  it('refuses the radial layer at left bottom on a box of auto height on ios and android, naming the layer, the position and the DPR', () => {
    const out = phase(`${BOX} ${TWO('right top, left bottom')}`, (r) => [div(r, 'a', ['box', 'two'], [])]);
    expect(targetsOf(out)).toEqual(['android', 'ios']);
    const [android, ios] = out as [string, string];
    expect(android).toContain('background-position-y on a: layer 2 (a radial gradient) sits at 100% with no-repeat');
    expect(android).toContain('at DPR 2.625');
    expect(android).toContain('BG2-t');
    // A box at whole CSS px is whole device px at 2 and 3; a fractional box edge is not.
    expect(ios).toContain('at a box edge that is not a whole device px');
    expect(compileWith(`${BOX} ${TWO('right top, left bottom')}`, one).diagnostics.filter((d) => d.target === 'web' && d.severity === 'error')).toEqual([]);
  });
  it('accepts the fixture as committed: the radial layer at left top, the linear one at right top of a 70px-wide box', () => {
    expect(phase(`${BOX} ${TWO('right top, left top')}`)).toEqual([]);
  });
  it('the refused case is unmodelled where the message says: the plant compiles it, and planBackground fails at 2.625 only', () => {
    expect(compileWith(`${BOX} ${TWO('right top, left bottom')}`, one, { ...NO_FAULTS, gradientPhaseUnchecked: true }).diagnostics.filter((d) => d.message.includes('at a phase that is not a whole device px'))).toEqual([]);
    const w = writeOf(`${BOX} .box { height: 10px; } ${TWO('right top, left bottom')}`, 'a', one, { ...NO_FAULTS, gradientPhaseUnchecked: true });
    // The box at whole CSS px from the page top, as a block after others lays it out.
    const at = (y: number) => ({ x: 4, y, w: 80, h: 20, border: 2, padding: 3 });
    const ys = Array.from({ length: 16 }, (_v, k) => k);
    expect(ys.filter((y) => !plan(w, 2.625, at(y))).length).toBeGreaterThan(0);
    expect(ys.filter((y) => !plan(w, 2, at(y)) || !plan(w, 3, at(y)))).toEqual([]);
    // At 2 and 3 a box height off the device px grid (a fractional layout) leaves it unmodelled too, which is why ios refuses it.
    const box = at(4);
    expect(Array.from({ length: 64 }, (_v, k) => k).filter((k) => !plan(w, 2, { ...box, h: box.h + k / 128 })).length).toBeGreaterThan(0);
  });
});

describe('BG2-t: what the proof accepts and refuses', () => {
  const page = (rule: string): string => `.a { ${rule} background-color: #eee; background-image: linear-gradient(#fa0, #05a); background-repeat: no-repeat; }`;
  const axes = (rule: string): string[] => phase(page(rule), (r) => [div(r, 'a', ['a'])]).map((m) => `${m.split(' ')[0]} ${m.split(' ')[1]}`);
  it('right, bottom and percentage positions: accepted on a px box larger than the tile, refused on an auto one', () => {
    expect(axes('width: 70px; height: 40px; background-size: 30px 20px; background-position: right bottom;')).toEqual([]);
    expect(axes('width: 70px; height: 40px; background-size: 30px 20px; background-position: 70% 30%;')).toEqual([]);
    expect(axes('width: 70px; background-size: 30px 20px; background-position: right bottom;')).toEqual(['android background-position-y', 'ios background-position-y']);
    expect(axes('height: 40px; background-size: 30px 20px; background-position: 70% 0;')).toEqual(['android background-position-x', 'ios background-position-x']);
    // A box no larger than the tile: the tile starts at or before the box's start edge.
    expect(axes('width: 30px; height: 40px; background-size: 30px 20px; background-position: right top;')).toEqual(['android background-position-x', 'ios background-position-x']);
  });
  it('offsets from the far edge, px offsets from the start edge, and negative offsets', () => {
    expect(axes('width: 60px; height: 36px; background-size: 20px 10px; background-position: right 6px bottom 25%;')).toEqual([]);
    expect(axes('width: 60px; height: 36px; background-size: 20px 10px; background-position: right 45px top;')).toEqual(['android background-position-x', 'ios background-position-x']);
    // A px offset from the start edge needs no box size; a negative one starts the tile outside the box.
    expect(axes('background-size: 20px 10px; background-position: 10px 5px;')).toEqual([]);
    expect(axes('background-size: 20px 10px; background-position: -5px 5px;')).toEqual(['android background-position-x', 'ios background-position-x']);
    expect(axes('height: 40px; background-size: 20px 10px; background-position: 0 -10%;')).toEqual(['android background-position-y', 'ios background-position-y']);
  });
  it('a tile sized as a share of the area: below 100% on a px box is accepted; auto and 100% are refused', () => {
    expect(axes('width: 70px; height: 40px; background-size: 40% 60%; background-position: 25% 75%;')).toEqual([]);
    expect(axes('width: 70px; height: 40px; background-size: 100% 20px; background-position: 50% 0;')).toEqual(['android background-position-x', 'ios background-position-x']);
    expect(axes('width: 70px; height: 40px; background-position: right bottom;')).toEqual(['android background-position-x', 'ios background-position-x']);
  });
  it('a border-box origin with obscuring borders starts before the clip; a large enough box still proves the offset', () => {
    expect(axes('width: 70px; height: 40px; border: 3px solid #123; background-origin: border-box; background-size: 40px 25px; background-position: bottom right;')).toEqual([]);
    expect(axes('width: 30px; height: 40px; border: 6px solid #123; background-origin: border-box; background-size: 30px 25px; background-position: 50% 0;')).toEqual(['android background-position-x', 'ios background-position-x']);
  });
  it('a max-width below the width counts; a percentage max-width or padding is unknown', () => {
    expect(axes('width: 70px; max-width: 25px; height: 40px; background-size: 30px 20px; background-position: right top;')).toEqual(['android background-position-x', 'ios background-position-x']);
    expect(axes('width: 70px; max-width: 90%; height: 40px; background-size: 30px 20px; background-position: right top;')).toEqual(['android background-position-x', 'ios background-position-x']);
    expect(axes('width: 70px; height: 40px; padding: 5%; background-size: 30px 20px; background-position: right top;')).toEqual(['android background-position-x', 'ios background-position-x']);
  });
  it('viewport units and a size another @media band changes are unknown at compile time', () => {
    expect(axes('width: 50vw; height: 40px; background-size: 30px 20px; background-position: right top;')).toEqual(['android background-position-x', 'ios background-position-x']);
    const banded = phase(`${page('width: 70px; height: 40px; background-size: 30px 20px; background-position: right top;')} @media (min-width: 600px) { .a { width: auto; } }`, (r) => [div(r, 'a', ['a'])]);
    expect(targetsOf(banded)).toEqual(['android', 'ios']);
  });
  it('calc() positions are refused before the phase check (CALC-p), so it never reads one', () => {
    const c = compileWith(page('width: 70px; height: 40px; background-size: 30px 20px; background-position: calc(100% - 4px) 0;'), (r) => [div(r, 'a', ['a'])]);
    expect(c.diagnostics.filter((d) => d.severity === 'error').length).toBeGreaterThan(0);
    expect(c.diagnostics.filter((d) => d.message.includes('at a phase that is not a whole device px'))).toEqual([]);
  });
  it('the web target and a layer at the start edge are never refused', () => {
    const c = compileWith(page('background-size: 30px 20px; background-position: right bottom;'), (r) => [div(r, 'a', ['a'])]);
    expect(c.diagnostics.filter((d) => d.target === 'web' && d.severity === 'error')).toEqual([]);
    expect(axes('background-size: 30px 20px; background-position: left top;')).toEqual([]);
    expect(axes('background-size: 30px 20px; background-position: 0 0;')).toEqual([]);
  });
});

describe('BG2-t: a layer at the start edge, whose origin and clip boxes may snap differently', () => {
  const page = (rule: string): string => `.a { width: 70px; height: 40px; ${rule} background-color: #eee; background-image: linear-gradient(#fa0, #05a); background-size: 30px 20px; background-repeat: no-repeat; background-position: left top; }`;
  const refused = (rule: string): string[] => phase(page(rule), (r) => [div(r, 'a', ['a'])]).map((m) => `${m.split(' ')[0]} ${m.split(' ')[1]}`);
  const both = ['android background-position-x', 'ios background-position-x'];
  it('refuses a padding-box origin over a zero border that does not obscure: the origin snaps, the border-box clip does not', () => {
    expect(refused('border: 0 dashed #123;')).toEqual(both);
    expect(refused('border: 0 solid transparent;')).toEqual(both);
    expect(phase(page('border: 0 dashed #123;'), (r) => [div(r, 'a', ['a'])])[0]).toContain('its background-origin (padding-box) and clip box (border-box) snap to device px differently and the origin box can start at or before the clip box');
  });
  it('refuses a border-box origin under an obscuring border, which the clip box starts inside', () => {
    expect(refused('border: 2px solid #123; background-origin: border-box;')).toEqual(both);
    // A double side obscures below 3 device px only: 1px does at DPR 2, 2px never does at the device scales.
    expect(refused('border: 1px double #123; background-origin: border-box;')).toEqual(both);
    expect(refused('border: 2px double #123; background-origin: border-box;')).toEqual([]);
  });
  it('accepts origins that snap like the clip, or start a whole border or padding inside it', () => {
    expect(refused('')).toEqual([]);
    expect(refused('border: 2px solid #123;')).toEqual([]);
    expect(refused('border: 1px dashed #123;')).toEqual([]);
    expect(refused('border: 2px dashed #123; background-origin: border-box;')).toEqual([]);
    expect(refused('border: 2px solid #123; padding: 3px; background-origin: content-box;')).toEqual([]);
    expect(refused('padding: 3px; background-origin: content-box; background-clip: content-box;')).toEqual([]);
  });
  it('the refused cases are unmodelled under the plant, at 2.625 for a whole-px box and at 2 for a fractional one', () => {
    const planted = { ...NO_FAULTS, gradientPhaseUnchecked: true };
    for (const [rule, border] of [['border: 0 dashed #123;', 0], ['border: 2px solid #123; background-origin: border-box;', 2]] as const) {
      const w = writeOf(page(rule), 'a', (r) => [div(r, 'a', ['a'])], planted);
      const at = (x: number) => ({ x, y: 4, w: 70 + 2 * border, h: 40 + 2 * border, border, padding: 0 });
      const xs = Array.from({ length: 16 }, (_v, k) => k);
      expect(xs.filter((x) => !plan(w, 2.625, at(x))).length, rule).toBeGreaterThan(0);
      expect(Array.from({ length: 64 }, (_v, k) => k).filter((k) => !plan(w, 2, at(4), { x: k, y: 0 })).length, rule).toBeGreaterThan(0);
    }
  });
});

describe('BG2-t: flex items, which a container may shrink on its main axis', () => {
  const item = '.i { width: 70px; height: 40px; background-color: #eee; background-image: linear-gradient(#fa0, #05a); background-size: 30px 20px; background-repeat: no-repeat; background-position: right bottom; }';
  /** The refusals of the first item. */
  const row = (container: string, n: number, extra = ''): string[] =>
    phase(`.row { display: flex; ${container} } ${item} ${extra}`, (r) => [div(r, 'row', ['row'], Array.from({ length: n }, (_v, k): TreeNode => div(r, `i${k}`, ['i'])))]).filter((m) => m.includes(' on i0:')).map((m) => `${m.split(' ')[0]} ${m.split(' ')[1]} ${m.split(' ')[3]}`);
  it('a wrapping row: accepted when one item fits the line', () => {
    expect(row('flex-wrap: wrap; width: 400px; column-gap: 6px;', 6)).toEqual([]);
    expect(row('flex-wrap: wrap; width: 50px;', 1)).toEqual(['android background-position-x i0:', 'ios background-position-x i0:']);
  });
  it('a single-line row: accepted when every item fits together, gaps included; refused when they may shrink', () => {
    expect(row('width: 240px;', 3)).toEqual([]);
    expect(row('width: 240px; column-gap: 15px;', 3)).toEqual([]);
    expect(row('width: 240px; column-gap: 16px;', 3)).toEqual(['android background-position-x i0:', 'ios background-position-x i0:']);
    expect(row('width: 200px;', 3)).toEqual(['android background-position-x i0:', 'ios background-position-x i0:']);
    expect(row('', 1)).toEqual(['android background-position-x i0:', 'ios background-position-x i0:']);
    // flex-shrink: 0 keeps the width; the cross axis never shrinks a px height.
    expect(row('width: 200px;', 3, '.i { flex-shrink: 0; }')).toEqual([]);
  });
  it('a percentage width resolves against the container: accepted when it fits the line', () => {
    expect(row('flex-wrap: wrap; width: 390px;', 2, '.i { width: 23.3%; }')).toEqual([]);
    expect(row('flex-wrap: wrap;', 2, '.i { width: 23.3%; }')).toEqual(['android background-position-x i0:', 'ios background-position-x i0:']);
  });
});

describe('BG2-t: every accepted case is modelled by planBackground for any box offset and any larger box', () => {
  // Box offsets in 1/64 CSS px steps of a device px, and sizes from the declared one up, at every device scale of both targets.
  const cases: readonly { readonly rule: string; readonly box: { w: number; h: number; border: number; padding: number } }[] = [
    { rule: 'width: 70px; height: 40px; border: 2px solid #123; padding: 3px; background-size: 30px 20px; background-position: right bottom;', box: { w: 80, h: 50, border: 2, padding: 3 } },
    { rule: 'width: 60px; height: 36px; background-size: 20px 10px; background-position: right 6px bottom 25%;', box: { w: 60, h: 36, border: 0, padding: 0 } },
    { rule: 'width: 70px; height: 40px; background-size: 40% 60%; background-position: 25% 75%;', box: { w: 70, h: 40, border: 0, padding: 0 } },
    { rule: 'width: 70px; height: 40px; border: 3px solid #123; padding: 4px; background-origin: border-box; background-size: 40px 25px; background-position: bottom right;', box: { w: 84, h: 54, border: 3, padding: 4 } },
    { rule: 'width: 76px; height: 16px; border: 2px solid #123; background-size: 30px 15px; background-position: 100% 100%;', box: { w: 80, h: 20, border: 2, padding: 0 } },
    { rule: 'width: 70px; height: 40px; background-size: 30px 20px; background-position: left top;', box: { w: 70, h: 40, border: 0, padding: 0 } },
    { rule: 'width: 70px; height: 40px; border: 1px dashed #123; background-size: 30px 20px; background-position: 0 0;', box: { w: 72, h: 42, border: 1, padding: 0 } },
    { rule: 'width: 70px; height: 40px; border: 2px dashed #123; background-origin: border-box; background-size: 30px 20px; background-position: left top;', box: { w: 74, h: 44, border: 2, padding: 0 } },
    { rule: 'width: 70px; height: 40px; border: 2px solid #123; padding: 3px; background-origin: content-box; background-size: 30px 20px; background-position: left top;', box: { w: 80, h: 50, border: 2, padding: 3 } },
  ];
  for (const c of cases) {
    it(c.rule, () => {
      const css = `.a { ${c.rule} background-color: #eee; background-image: linear-gradient(#fa0, #05a), radial-gradient(#0a5, #50a); background-repeat: no-repeat; }`;
      expect(phase(css, (r) => [div(r, 'a', ['a'])])).toEqual([]);
      const w = writeOf(css, 'a', (r) => [div(r, 'a', ['a'])]);
      const failures: string[] = [];
      for (const dpr of ALL_DPRS) {
        for (let grow = 0; grow <= 3; grow += 0.37) {
          for (let s = 0; s < 64; s += 5) {
            const box = { x: 4, y: 4, ...c.box, w: c.box.w + grow, h: c.box.h + grow };
            if (!plan(w, dpr, box, { x: s, y: 63 - s })) failures.push(`${dpr} +${grow} shift ${s}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('BG2-t start edge: border width keywords and unknown widths count only where they decide the answer', () => {
  // The reported rule has no background colour (BG2c refuses that stack natively); the swept one adds one so it lowers.
  const rule = (extra: string, color = ''): string => `.a { width: 70px; height: 40px; background: linear-gradient(#fa0, #05a) no-repeat; background-size: 30px 20px; ${color} ${extra} }`;
  const at = (border: number, padding: number, borderDevice?: number) => ({ x: 4, y: 4, w: 70 + 2 * padding + 2 * border, h: 40 + 2 * padding + 2 * border, border, padding, ...(borderDevice === undefined ? {} : { borderDevice }) });
  const swept = (w: GradientWrite, box: ReturnType<typeof at>): string[] => {
    const out: string[] = [];
    for (const dpr of ALL_DPRS) for (let s = 0; s < 64; s += 3) if (!plan(w, dpr, box, { x: s, y: 63 - s })) out.push(`${dpr} ${s}`);
    return out;
  };
  for (const [extra, box] of [
    ['border: solid #000;', at(1, 0, 3)],
    ['border: thin solid #000;', at(1, 0)],
    ['border: 2px solid #000; padding: 5%;', at(2, 5)],
  ] as const) {
    it(`accepts ${extra} with the initial padding-box origin under a border-box clip, which both snap alike`, () => {
      const css = `.p { width: 100px; } ${rule(extra)}`;
      const body: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])];
      expect(phase(css, body)).toEqual([]);
      expect(swept(writeOf(`.p { width: 100px; } ${rule(extra, 'background-color: #eee;')}`, 'a', body), box)).toEqual([]);
    });
  }
  it('gives an unknown width its own message', () => {
    const out = phase(`.p { width: 100px; } ${rule('padding: 5%; background-origin: content-box;')}`, (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])]);
    expect(targetsOf(out)).toEqual(['android', 'ios']);
    expect(out[0]).toContain('a border or padding width that decides it is not known at compile time');
  });
});

describe('BG2-t start edge: generated border, padding and box combinations against planBackground', () => {
  // Every border style and width form, padding form and origin/clip pair, at the start edge. A refusal for snapping must be one
  // planBackground can leave unmodelled; an accepted case must be modelled at every sampled layout; a refusal for an unknown
  // width is fail-closed and only a percentage padding over a content box reaches it here.
  const styles = ['none', 'solid #000', 'dashed #000', 'solid transparent', 'double #000'];
  const widths: readonly (readonly [string, number, number | undefined])[] = [['0', 0, undefined], ['0.3px', 0.3, undefined], ['1px', 1, undefined], ['2px', 2, undefined], ['thin', 1, undefined], ['medium', 3, undefined], ['thick', 5, undefined], ['', 1, 3]];
  const paddings: readonly (readonly [string, number])[] = [['0', 0], ['3px', 3], ['5%', 5]];
  const boxes = ['border-box', 'padding-box', 'content-box'];
  it('refuses exactly the start-edge combinations planBackground leaves unmodelled, and accepts no unmodelled far-edge one', () => {
    const wrong: string[] = [];
    const unknown: string[] = [];
    let accepted = 0;
    let snaps = 0;
    let farAccepted = 0;
    for (const position of ['left top', 'right bottom']) for (const style of styles) for (const [width, css, device] of widths) for (const [pad, padPx] of paddings) for (const origin of boxes) for (const clip of boxes) {
      const extra = `border-style: ${style.split(' ')[0]}; border-color: ${style.split(' ')[1] ?? '#000'}; ${width === '' ? '' : `border-width: ${width};`} padding: ${pad}; background-origin: ${origin}; background-clip: ${clip}; background-position: ${position};`;
      const css2 = `.p { width: 100px; } .a { width: 70px; height: 40px; ${extra} background-color: #eee; background-image: linear-gradient(#fa0, #05a); background-repeat: no-repeat; background-size: 30px 20px; }`;
      const body: Body = (r) => [div(r, 'p', ['p'], [div(r, 'a', ['a'])])];
      const c = compileWith(css2, body);
      const refusal = c.diagnostics.find((d) => d.target === 'android' && d.message.includes('at a phase that is not a whole device px'));
      // Other refusals (a colour clipped inside a border that shows the backdrop) leave no program to sweep.
      if (c.diagnostics.some((d) => d.severity === 'error' && !d.message.includes('at a phase that is not a whole device px'))) continue;
      const w = writeOf(css2, 'a', body, { ...NO_FAULTS, gradientPhaseUnchecked: true });
      const border = style.startsWith('none') ? 0 : css;
      const box = { x: 4, y: 4, w: 70 + 2 * padPx + 2 * border, h: 40 + 2 * padPx + 2 * border, border, padding: padPx, ...(style.startsWith('none') || device === undefined ? {} : { borderDevice: device }) };
      let unmodelled = false;
      for (const dpr of ALL_DPRS) for (let s = 0; s < 64 && !unmodelled; s += 3) if (!plan(w, dpr, box, { x: s, y: 63 - s })) unmodelled = true;
      const name = `${extra}`;
      if (position !== 'left top') {
        // The far edge: a fail-closed proof over the box size; every case it accepts must be modelled.
        if (refusal === undefined) farAccepted++;
        if (refusal === undefined && unmodelled) wrong.push(`accepted but unmodelled: ${name}`);
        continue;
      }
      if (refusal === undefined) {
        accepted++;
        if (unmodelled) wrong.push(`accepted but unmodelled: ${name}`);
      } else if (refusal.message.includes('not known at compile time')) unknown.push(`${pad} ${origin} ${clip}`);
      else {
        snaps++;
        if (!unmodelled) wrong.push(`refused but modelled: ${name}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(accepted).toBeGreaterThan(0);
    expect(snaps).toBeGreaterThan(0);
    expect(farAccepted).toBeGreaterThan(0);
    expect(unknown.every((u) => u.startsWith('5% ') && u.includes('content-box'))).toBe(true);
  }, 240_000);
});
