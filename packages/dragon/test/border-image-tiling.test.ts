// MISC-PAINT part 2: a tiled gradient border image (repeat, round, space) is drawn natively only on a box whose border box and border
// widths the compiler proves exactly and whose tiles planBorderImage models at every device scale and sub-pixel position
// (analysis/paint-values/border-image-tiling.ts). Web keeps every repeat as written. The Chrome case is border-image-repeat
// (packages/parity/fixtures), judged by border-image-reference.test.ts.
import { describe, expect, it } from 'vitest';
import type { BorderImagePaint, GradientImage } from '@dragon/layout';
import { fromCssPx, NO_GRADIENT_FAULTS, planBorderImage, referenceTileSize } from '@dragon/layout';
import type { ElementNode, Origin, SourceRef, TreeNode } from '../src/index.ts';
import { createProjectWith, NO_FAULTS, nativePrograms } from '../src/internal.ts';
import type { CompilerFaults } from '../src/faults.ts';
import type { ExactBox, TilingInputs } from '../src/analysis/paint-values/border-image-tiling.ts';
import { tilingProblem } from '../src/analysis/paint-values/border-image-tiling.ts';
import { DOC, inputFor, staticClass, text } from './helpers.ts';

const project = (faults: CompilerFaults) =>
  createProjectWith({ projectId: 'test', targets: { ios: { minimum: '15.0' }, android: { minSdk: 31 }, web: {} } }, { faults, profiles: 'derive', direction: 'ltr' });

function el(ref: SourceRef, id: string, tag: string, classes: string[] = [], children: TreeNode[] = []): ElementNode {
  const origin: Origin = { kind: 'authored', span: { source: ref, start: 0, end: 0 } };
  return { kind: 'element', id, tag, classes: classes.map((name) => staticClass({ owner: DOC, sheet: 's', name }, origin)), attributes: [], children, origin };
}

/** Each error as `<target> <message start>` for box .s (inside .p) with the declarations. */
function compile(decl: string, parent = '', faults: CompilerFaults = NO_FAULTS) {
  const css = `body { font-family: Ahem; font-size: 10px; margin: 0; } .p { ${parent} } .s { ${decl} }`;
  return project(faults).compile(inputFor(css, (r) => [el(r, 'p', 'div', ['p'], [el(r, 'a', 'div', ['s'], [text(r, 't', 'X')])])]));
}
const errors = (decl: string, parent = '', faults: CompilerFaults = NO_FAULTS): string[] => compile(decl, parent, faults).diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.message}`).sort();

/** The box's border box in raw LU at a device scale and its border widths in device px (snapBorderWidth), as layout gives them. */
function deviceBox(b: ExactBox, dpr: number): readonly number[] {
  const bd = b.borders.map((v) => (v * dpr >= 1 ? Math.floor(v * dpr) : v > 0 ? 1 : 0));
  const pad = b.padding.map((v) => fromCssPx(v * dpr));
  const extraX = (pad[1] as number) + (pad[3] as number) + ((bd[1] as number) + (bd[3] as number)) * 64;
  const extraY = (pad[0] as number) + (pad[2] as number) + ((bd[0] as number) + (bd[2] as number)) * 64;
  const w = fromCssPx(b.width * dpr);
  const h = fromCssPx(b.height * dpr);
  return [b.borderBox ? Math.max(w, extraX) : w + extraX, b.borderBox ? Math.max(h, extraY) : h + extraY, ...bd];
}
/** The BorderImagePaint of a red-to-blue border image on the box at a device scale and a position in LU. */
function paintOf(box: ExactBox, t: TilingInputs, dpr: number, x: number, y: number): BorderImagePaint {
  const b = deviceBox(box, dpr);
  return { box: { x, y, width: b[0] as number, height: b[1] as number, borders: b.slice(2).map((v) => v * 64), padding: [0, 0, 0, 0], obscures: [false, false, false, false] }, image: RED_BLUE, slices: t.slices, fill: t.fill, widths: t.widths, zoom: dpr, tileSize: referenceTileSize(dpr), layerX: 0, layerY: 0, repeatX: t.repeat[0] as string, repeatY: t.repeat[1] as string };
}

const BOX = 'width: 48px; height: 32px; border: 8px solid #102030;';
const RED_BLUE: GradientImage = { radial: false, repeating: false, direction: 'side', angleDeg: 0, slope: 0, sideX: 'right', sideY: 'none', circle: false, extent: 'farthest-corner', radiusX: { unit: 'percent', value: 50 }, radiusY: { unit: 'percent', value: 50 }, centerX: { unit: 'percent', value: 50 }, centerY: { unit: 'percent', value: 50 }, stops: [{ color: { r: 255, g: 0, b: 0, alpha: 255 }, unit: 'percent', value: 0 }, { color: { r: 0, g: 0, b: 255, alpha: 255 }, unit: 'percent', value: 100 }] };

describe('tiled gradient border images (MISC-PAINT part 2)', () => {
  it('draws repeat, round and space natively on a proven box whose tiles are whole device px, with the repeat in the write', () => {
    for (const d of ['8 repeat', '8 round', '8 space', '8 fill / 1 repeat space', '16 / 8px round', '8 round stretch', '8 / 1 stretch repeat']) {
      const c = compile(`${BOX} border-image: linear-gradient(to right, red, blue) ${d};`);
      expect(c.diagnostics.filter((x) => x.severity === 'error').map((x) => `${String(x.target)} ${x.message}`), d).toEqual([]);
      const p = nativePrograms(c, []);
      expect(p.kind, d).toBe('ready');
      if (p.kind !== 'ready') continue;
      const w = p.programs['android-views'].nodes.flatMap((n) => n.writes).find((x) => x.kind === 'border-image') as unknown as { repeat: readonly string[] };
      const [x, y = x] = d.split(' / ').pop()?.split(' ').filter((t) => ['repeat', 'round', 'space', 'stretch'].includes(t)) ?? [];
      expect(w.repeat, d).toEqual([x, y]);
    }
    // A flex item that cannot grow or shrink, and a border-box box, are proven too.
    expect(errors(`${BOX} flex-shrink: 0; border-image: linear-gradient(red, blue) 8 round;`, 'display: flex; width: 20px;')).toEqual([]);
    expect(errors('box-sizing: border-box; width: 64px; height: 48px; border: 8px solid; border-image: linear-gradient(red, blue) 8 repeat;')).toEqual([]);
  });

  it('refuses natively, and draws on web, a box the compiler cannot prove exactly', () => {
    const cases: readonly (readonly [string, string, RegExp])[] = [
      ['height: 32px; border: 8px solid; border-image: linear-gradient(red, blue) 8 round;', '', /its width or height \(with min and max sizes\) is not a px length/],
      ['width: 50%; height: 32px; border: 8px solid; border-image: linear-gradient(red, blue) 8 round;', '', /is not a px length/],
      [`${BOX} max-width: 10%; border-image: linear-gradient(red, blue) 8 round;`, '', /is not a px length/],
      [`${BOX} padding: 5%; border-image: linear-gradient(red, blue) 8 repeat;`, '', /a padding is not a px length/],
      ['width: 48px; height: 32px; border: thin solid; border-image: linear-gradient(red, blue) 8 space;', '', /the top border width is not a px length/],
      [`${BOX} flex-grow: 1; border-image: linear-gradient(red, blue) 8 round;`, 'display: flex;', /a flex item that may grow/],
      [`${BOX} border-image: linear-gradient(red, blue) 8 round;`, 'display: flex; width: 20px;', /a flex item that Dragon cannot prove does not shrink/],
      [`${BOX} border-image: linear-gradient(red, blue) 8 round;`, 'display: contents;', /display: contents/],
    ];
    for (const [d, parent, why] of cases) {
      const c = compile(d, parent);
      const e = c.diagnostics.filter((x) => x.severity === 'error');
      expect(e.map((x) => String(x.target)).sort(), d).toEqual(['android', 'ios']);
      for (const x of e) expect(x.message, d).toMatch(/^border-image-repeat: (round|repeat|space) on <div> a is unsupported: Dragon cannot prove its border box exactly: /);
      for (const x of e) expect(x.message, d).toMatch(why);
      expect(c.outputs.web.kind, d).toBe('ready');
    }
  });

  it('refuses a tiled box only on the target whose device scale leaves it off the device px grid', () => {
    // 44px is 115.5 device px at 2.625, so the border box is fractional there; at 2 and 3 it is whole.
    const e = errors('width: 44px; height: 32px; border: 8px solid; border-image: linear-gradient(red, blue) 8 repeat;');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/^android border-image-repeat: repeat on <div> a is unsupported: at DPR 2\.625 the border box is not a whole device px/);
    // round fits 3 tiles of 16 device px into 48 at DPR 2 but leaves a scale of 1.2 at another width.
    expect(errors(`${BOX} border-image: linear-gradient(red, blue) 16 / 8px round;`)).toEqual([]);
    const round = errors('width: 40px; height: 32px; border: 8px solid; border-image: linear-gradient(red, blue) 16 / 8px round;');
    expect(round.map((x) => x.split(' ')[0])).toEqual(['android', 'ios']);
    for (const x of round) expect(x).toMatch(/at DPR \S+ a tile, its spacing or its phase is not a whole device px/);
    // A width or slice whose scale is not a power of two is refused everywhere natively.
    expect(errors(`${BOX} border-image: linear-gradient(red, blue) 24 / 8px repeat;`).map((x) => x.split(' ')[0])).toEqual(['android', 'ios']);
    // An auto width is the slice over a float zoom ratio: proven only at DPR 2.
    const auto = errors(`${BOX} border-image: linear-gradient(red, blue) 8 / auto repeat;`);
    expect(auto.map((x) => x.split(' ')[0])).toEqual(['android', 'ios']);
    for (const x of auto) expect(x).toMatch(/at DPR 3 a border-image-width is not a whole device px \(an auto width is one only at a power-of-two scale\)/);
    // A fractional slice number is rounded by Chrome before the zoom, which the proof does not follow.
    expect(errors(`${BOX} border-image: linear-gradient(red, blue) 8.5 / 8px repeat;`)).toHaveLength(2);
  });

  it('plant borderImageTilingUnchecked: the refused box compiles, and its plan is unmodelled at DPR 2.625 (the device would throw)', () => {
    const d = 'width: 44px; height: 32px; border: 8px solid; border-image: linear-gradient(red, blue) 8 repeat;';
    expect(errors(d, '', { ...NO_FAULTS, borderImageTilingUnchecked: true })).toEqual([]);
    const box: ExactBox = { width: 44, height: 32, borderBox: false, padding: [0, 0, 0, 0], borders: [8, 8, 8, 8] };
    const t: TilingInputs = { slices: [0, 1, 2, 3].map(() => ({ unit: 'number' as const, value: 8 })), fill: false, widths: [0, 1, 2, 3].map(() => ({ unit: 'number' as const, value: 1 })), repeat: ['repeat', 'repeat'] };
    expect([2, 3].map((dpr) => tilingProblem(box, t, dpr))).toEqual([null, null]);
    expect(tilingProblem(box, t, 2.625)).toMatch(/border box is not a whole device px/);
    expect(planBorderImage(paintOf(box, t, 2.625, 0, 0), NO_GRADIENT_FAULTS).modelled).toBe(false);
  });

  it('is sound: every box the proof accepts is modelled by planBorderImage at every 2D sub-pixel position, and it accepts many', () => {
    let accepted = 0;
    let tried = 0;
    const slices = [[4, 'number'], [8, 'number'], [16, 'number'], [12, 'number'], [25, 'percent'], [50, 'percent']] as const;
    const widths = [[8, 'px'], [1, 'number'], [2, 'number'], [0, 'auto'], [4, 'px']] as const;
    const rules = ['repeat', 'round', 'space', 'stretch'] as const;
    for (const w of [40, 44, 48, 56, 64, 72]) {
      for (const [sv, su] of slices) {
        for (const [wv, wu] of widths) {
          for (const rx of rules) {
            for (const ry of rules) {
              if (rx === 'stretch' && ry === 'stretch') continue;
              for (const fill of [false, true]) {
                const box: ExactBox = { width: w, height: 32, borderBox: false, padding: [0, 4, 0, 4], borders: [8, 8, 8, 8] };
                const t: TilingInputs = { slices: [0, 1, 2, 3].map(() => ({ unit: su, value: sv })), fill, widths: [0, 1, 2, 3].map(() => ({ unit: wu, value: wv })), repeat: [rx, ry] };
                for (const dpr of [2, 3, 2.625]) {
                  tried++;
                  if (tilingProblem(box, t, dpr) !== null) continue;
                  accepted++;
                  for (let x = 0; x < 64; x += 9) for (let y = 0; y < 64; y += 13) expect(planBorderImage(paintOf(box, t, dpr, x + 640, y + 320), NO_GRADIENT_FAULTS).modelled, `${w} ${sv}${su} ${wv}${wu} ${rx} ${ry} ${fill} ${dpr} ${x} ${y}`).toBe(true);
                }
              }
            }
          }
        }
      }
    }
    expect(accepted).toBeGreaterThan(tried / 10);
  });
});
