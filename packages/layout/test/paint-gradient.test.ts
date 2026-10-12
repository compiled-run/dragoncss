// BG2 gradient reference (paint-gradient.ts): the exact arithmetic it rests on, pinned against JS's correctly rounded Math.sqrt
// and exact BigInt products; the SkMatrix port; Blink's linear end points from a given slope (no libm call: the slope is an
// input, notes/T074-bg2-spec.md R3) and the unmodelled corner direction; Blink's background tile geometry and its plants; and the
// composited layer origin (R4). Nothing here compares pixels with Chrome: the rows are TS-internal pins, and the TS = Swift = Kotlin
// check is paint-roots.test.ts on the backgroundRow vectors.
import { describe, expect, it } from 'vitest';
import { backgroundRow, fma64, fmodF32, gradientDesc, gradientFaults, hypotF32, IDENTITY, layerPlacement, matConcat, matInvert, matType, NO_GRADIENT_FAULTS, planBackground, sqrtF32, sqrtF64 } from '../src/paint-gradient.ts';
import type { BackgroundBox, BackgroundPaint, GradientImage, LayerGeometry } from '../src/paint-gradient.ts';

function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

/** a * b + c exactly, rounded once to a double, through BigInt on the binary expansions. */
function exactFma(a: number, b: number, c: number): number {
  const parts = (v: number): [bigint, number] => {
    if (v === 0) return [0n, 0];
    let e = 0;
    let m = v;
    while (!Number.isInteger(m)) {
      m *= 2;
      e -= 1;
    }
    return [BigInt(m), e];
  };
  const [ma, ea] = parts(a);
  const [mb, eb] = parts(b);
  const [mc, ec] = parts(c);
  const ep = ea + eb;
  const e = Math.min(ep, ec);
  const sum = ma * mb * 2n ** BigInt(ep - e) + mc * 2n ** BigInt(ec - e);
  // Round the exact sum sum * 2^e to the nearest double (ties to even) by scaling into 53 bits.
  if (sum === 0n) return 0;
  const neg = sum < 0n;
  let m = neg ? -sum : sum;
  let exp = e;
  const bits = m.toString(2).length;
  if (bits > 53) {
    const shift = BigInt(bits - 53);
    const q = m >> shift;
    const r = m - (q << shift);
    const half = 1n << (shift - 1n);
    m = r > half || (r === half && (q & 1n) === 1n) ? q + 1n : q;
    exp += bits - 53;
  }
  return (neg ? -1 : 1) * Number(m) * 2 ** exp;
}

describe('paint-gradient arithmetic', () => {
  it('fma64 rounds a * b + c once, like BigInt arithmetic', () => {
    const r = lcg(7);
    for (let i = 0; i < 20000; i++) {
      const a = (r() - 0.5) * 2 ** Math.floor(r() * 40 - 20);
      const b = (r() - 0.5) * 2 ** Math.floor(r() * 40 - 20);
      const c = (r() - 0.5) * 2 ** Math.floor(r() * 40 - 20);
      expect(fma64(a, b, c)).toBe(exactFma(a, b, c));
    }
  });
  it('sqrtF64 is IEEE sqrt, and sqrtF32 and hypotF32 round it to float', () => {
    const r = lcg(11);
    for (let i = 0; i < 50000; i++) {
      const v = r() * 2 ** Math.floor(r() * 60 - 30);
      expect(sqrtF64(v)).toBe(Math.sqrt(v));
      const f = Math.fround(v);
      expect(sqrtF32(f)).toBe(Math.fround(Math.sqrt(f)));
      const x = Math.fround((r() - 0.5) * 6000);
      const y = Math.fround((r() - 0.5) * 6000);
      expect(hypotF32(x, y)).toBe(Math.fround(Math.sqrt(x * x + y * y)));
    }
    expect([sqrtF64(0), sqrtF64(1), sqrtF64(4), sqrtF64(2)]).toEqual([0, 1, 2, Math.SQRT2]);
  });
  it('fmodF32 keeps the sign of the dividend and is exact', () => {
    expect([fmodF32(400, 360), fmodF32(-30, 360), fmodF32(720, 360), fmodF32(359.5, 360), fmodF32(-720.25, 360)]).toEqual([40, -30, 0, 359.5, -0.25]);
  });
});

describe('the SkMatrix port', () => {
  it('classifies, concatenates and inverts affine matrices as SkMatrix does', () => {
    const t = { sx: 1, kx: 0, tx: 3, ky: 0, sy: 1, ty: -2 };
    const s = { sx: 2, kx: 0, tx: 0, ky: 0, sy: 0.5, ty: 0 };
    const r = { sx: 0, kx: -1, tx: 0, ky: 1, sy: 0, ty: 0 };
    expect([matType(IDENTITY), matType(t), matType(s), matType(r), matType({ ...IDENTITY, kx: -0 })]).toEqual([0, 1, 2, 6, 0]);
    expect(matConcat(s, t)).toEqual({ sx: 2, kx: 0, tx: 6, ky: 0, sy: 0.5, ty: -1 });
    expect(matInvert(t)).toEqual({ sx: 1, kx: 0, tx: -3, ky: 0, sy: 1, ty: 2 });
    expect(matInvert(s)).toEqual({ sx: 0.5, kx: 0, tx: -0, ky: 0, sy: 2, ty: -0 });
    expect(matInvert(matConcat(r, t))).toEqual({ sx: 0, kx: 1, tx: -3, ky: -1, sy: 0, ty: 2 });
    expect(matInvert({ sx: 0, kx: 0, tx: 0, ky: 0, sy: 0, ty: 0 })).toBe(null);
  });
});

const box = (o: Partial<BackgroundBox>): BackgroundBox => ({ x: 0, y: 0, width: 6400, height: 3200, borders: [0, 0, 0, 0], padding: [0, 0, 0, 0], obscures: [false, false, false, false], ...o });
const geometry = (o: Partial<LayerGeometry>): LayerGeometry => ({ sizeKind: 'length', sizeX: { unit: 'auto', value: 0 }, sizeY: { unit: 'auto', value: 0 }, positionX: { unit: 'percent', value: 0 }, positionY: { unit: 'percent', value: 0 }, repeatX: 'repeat', repeatY: 'repeat', origin: 'padding-box', clip: 'border-box', ...o });

describe('background tile geometry (background_image_geometry.cc)', () => {
  it('draws an auto-sized layer as one tile the size of the snapped positioning area', () => {
    const p = layerPlacement(box({ x: 20480, y: 1331, width: 12857, height: 5158 }), geometry({}), 2, true, NO_GRADIENT_FAULTS);
    expect([p.tileWidth, p.tileHeight, p.destX, p.destY, p.destWidth, p.destHeight, p.srcX, p.srcY, p.singleTile]).toEqual([12864, 5120, 20480, 1344, 12864, 5120, 0, 0, true]);
  });
  it('tiles a repeating layer whose clip box is larger than its origin box', () => {
    const b = box({ borders: [384, 384, 384, 384] });
    expect(layerPlacement(b, geometry({}), 2, true, NO_GRADIENT_FAULTS).singleTile).toBe(false);
    expect(layerPlacement(b, geometry({ clip: 'padding-box' }), 2, true, NO_GRADIENT_FAULTS).singleTile).toBe(true);
    expect(layerPlacement(b, geometry({ origin: 'border-box' }), 2, true, NO_GRADIENT_FAULTS).singleTile).toBe(true);
  });
  it('tiles a repeating layer smaller than its area or shifted by a position, and never a no-repeat layer', () => {
    const small = geometry({ sizeX: { unit: 'px', value: 40 } });
    expect(layerPlacement(box({}), small, 2, true, NO_GRADIENT_FAULTS).singleTile).toBe(false);
    expect(layerPlacement(box({}), { ...small, repeatX: 'no-repeat' }, 2, true, NO_GRADIENT_FAULTS).singleTile).toBe(true);
    expect(layerPlacement(box({ width: 12857 }), geometry({ positionX: { unit: 'percent', value: 50 } }), 2, true, NO_GRADIENT_FAULTS).singleTile).toBe(false);
    const p = layerPlacement(box({}), geometry({ repeatX: 'no-repeat', repeatY: 'no-repeat', positionX: { unit: 'px', value: 20 }, positionY: { unit: 'percent', value: 100 }, sizeX: { unit: 'percent', value: 60 }, sizeY: { unit: 'px', value: 25 } }), 2, true, NO_GRADIENT_FAULTS);
    expect([p.destX, p.destY, p.destWidth, p.destHeight, p.singleTile]).toEqual([2560, 0, 3840, 3200, true]);
  });
});

const linear = (o: Partial<GradientImage>): GradientImage => ({ radial: false, repeating: false, direction: 'angle', angleDeg: 110, slope: Math.fround(Math.tan(Math.fround(Math.fround(90 - 110) * Math.fround(Math.fround(Math.PI) / 180)))), sideX: 'none', sideY: 'none', circle: false, extent: 'farthest-corner', radiusX: { unit: 'px', value: 0 }, radiusY: { unit: 'px', value: 0 }, centerX: { unit: 'percent', value: 50 }, centerY: { unit: 'percent', value: 50 }, stops: [{ color: { r: 255, g: 0, b: 0, alpha: 255 }, unit: 'auto', value: 0 }, { color: { r: 0, g: 0, b: 255, alpha: 255 }, unit: 'auto', value: 0 }], ...o });

describe('linear end points (EndPointsFromAngle with the slope as an input)', () => {
  it('takes the slope it is given: the end points follow it, and the right angles ignore it', () => {
    const a = gradientDesc(linear({}), 200, 100, 2);
    const b = gradientDesc(linear({ slope: Math.fround(linear({}).slope * 1.0000001) }), 200, 100, 2);
    expect(a.modelled).toBe(true);
    expect([a.p0x, a.p0y, a.p1x, a.p1y]).not.toEqual([b.p0x, b.p0y, b.p1x, b.p1y]);
    for (const [deg, pts] of [[0, [0, 100, 0, 0]], [90, [0, 0, 200, 0]], [180, [0, 0, 0, 100]], [270, [200, 0, 0, 0]], [-90, [200, 0, 0, 0]], [450, [0, 0, 200, 0]]] as const) {
      const d = gradientDesc(linear({ angleDeg: deg, slope: Number.NaN }), 200, 100, 2);
      expect([d.p0x, d.p0y, d.p1x, d.p1y], String(deg)).toEqual(pts);
    }
  });
  it('leaves a corner direction unmodelled: its slope needs atan2 and tan of the box size at paint time', () => {
    const d = gradientDesc(linear({ direction: 'side', sideX: 'right', sideY: 'bottom' }), 200, 100, 2);
    expect(d.modelled).toBe(false);
    expect(gradientDesc(linear({ direction: 'side', sideX: 'right', sideY: 'none' }), 200, 100, 2).modelled).toBe(true);
  });
});

describe('the layer origin and the reference plants', () => {
  const paint = (o: Partial<BackgroundPaint>): BackgroundPaint => ({ box: box({ x: 26 * 64 + 16, y: 1102 * 64 + 32, width: 49040, height: 7560 }), color: { r: 0, g: 0, b: 0, alpha: 0 }, colorClip: 'border-box', layers: [{ geometry: geometry({}), image: linear({}) }], lastIsBottom: true, zoom: 2.625, tileSize: 512, layerX: 0, layerY: 0, ...o });
  const rows = (p: BackgroundPaint, faults = NO_GRADIENT_FAULTS): number[][] => {
    const plan = planBackground(p, faults);
    const out: number[][] = [];
    for (let y = plan.top; y < plan.bottom; y += 7) out.push([...backgroundRow(plan, y, faults)]);
    return out;
  };
  it('rasters in the layer\'s own space: a whole-pixel layer origin moves the dither and the tiles, not the box', () => {
    const page = planBackground(paint({}), NO_GRADIENT_FAULTS);
    const own = planBackground(paint({ layerX: 26, layerY: 1102 }), NO_GRADIENT_FAULTS);
    expect([own.left, own.top, own.right, own.bottom]).toEqual([page.left, page.top, page.right, page.bottom]);
    expect([own.originX, own.originY]).toEqual([26, 1102]);
    expect(rows(paint({ layerX: 26, layerY: 1102 }))).not.toEqual(rows(paint({})));
    // In the layer's space the box sits at its page position less the origin: the same rows as that box on the page.
    const moved = paint({ box: box({ x: 16, y: 32, width: 49040, height: 7560 }) });
    expect(rows(paint({ layerX: 26, layerY: 1102 }))).toEqual(rows(moved));
  });
  it('layerOriginIgnored rasters a composited box from the page origin', () => {
    const own = paint({ layerX: 26, layerY: 1102 });
    expect(rows(own, gradientFaults('layerOriginIgnored'))).toEqual(rows(paint({})));
  });
  it('refuses a fractional layer origin by leaving the plan unmodelled', () => {
    expect(planBackground(paint({ layerX: 0.5 }), NO_GRADIENT_FAULTS).modelled).toBe(false);
  });
  it('singleTileModelSwapped and obscuredBorderIgnored change the placement the reference draws', () => {
    const p = layerPlacement(box({ x: 20480, y: 1331, width: 12857, height: 5158 }), geometry({}), 2, true, NO_GRADIENT_FAULTS);
    expect(layerPlacement(box({ x: 20480, y: 1331, width: 12857, height: 5158 }), geometry({}), 2, true, gradientFaults('singleTileModelSwapped')).direct).toBe(!p.direct);
    const bordered = box({ borders: [384, 384, 384, 384], obscures: [true, true, true, true] });
    const clipped = layerPlacement(bordered, geometry({ origin: 'border-box' }), 2, true, NO_GRADIENT_FAULTS);
    const ignored = layerPlacement(bordered, geometry({ origin: 'border-box' }), 2, true, gradientFaults('obscuredBorderIgnored'));
    expect([clipped.destX, clipped.destWidth]).toEqual([384, 6400 - 768]);
    expect([ignored.destX, ignored.destWidth]).toEqual([0, 6400]);
  });
  it('names every plant gradientFaults knows, and throws on an unknown name', () => {
    for (const k of ['offsetOne', 'unpremultiplied', 'ditherOff', 'layerOriginIgnored', 'singleTileModelSwapped', 'obscuredBorderIgnored'] as const) expect(gradientFaults(k)[k], k).toBe(true);
    expect(gradientFaults('none')).toEqual(NO_GRADIENT_FAULTS);
    expect(() => gradientFaults('tanCorrectlyRounded')).toThrow('unknown gradient plant tanCorrectlyRounded');
  });
});

describe('edge offsets (notes/T074-bg2-spec.md R7)', () => {
  it('places a gradient centre from the right or bottom edge as PositionFromValue does: the edge distance less the offset', () => {
    const at = (centerX: GradientImage['centerX'], centerY: GradientImage['centerY']) => gradientDesc(linear({ radial: true, centerX, centerY }), 200, 100, 2);
    const d = at({ unit: 'end-px', value: 10 }, { unit: 'end-percent', value: 25 });
    expect([d.p0x, d.p0y]).toEqual([180, 75]);
    const e = at({ unit: 'px', value: 10 }, { unit: 'percent', value: 25 });
    expect([e.p0x, e.p0y]).toEqual([20, 25]);
  });
  it('places a layer from the right or bottom edge as ResolveXPosition does: available - the offset, subtracted in LayoutUnit', () => {
    const g = (positionX: LayerGeometry['positionX'], positionY: LayerGeometry['positionY']) => layerPlacement(box({}), geometry({ repeatX: 'no-repeat', repeatY: 'no-repeat', sizeX: { unit: 'px', value: 20 }, sizeY: { unit: 'px', value: 10 }, positionX, positionY }), 2, true, NO_GRADIENT_FAULTS);
    const end = g({ unit: 'end-px', value: 5 }, { unit: 'end-percent', value: 25 });
    const start = g({ unit: 'percent', value: 100 }, { unit: 'percent', value: 75 });
    // 100% less 5 css px (10 device px, 640 LU) on the x axis; 75% on the y axis, which 100% - 25% matches when no LU is fractional.
    expect(end.destX).toBe(start.destX - 640);
    expect(end.destY).toBe(start.destY);
  });
  // Blink's arithmetic, written out: MinimumValueForLength truncates the offset to a LayoutUnit, then ResolveXPosition subtracts it
  // from the available size (MapFillPositionX keeps the right or bottom origin; calc(100% - x) is only getComputedStyle's string).
  const edgeOffsetLu = (v: LayerGeometry['positionX'], available: number, zoom: number): number =>
    v.unit === 'end-percent' ? Math.trunc(Math.fround(Math.fround(Math.fround(Math.fround(available / 64) * Math.fround(v.value)) / 100) * 64)) : Math.trunc(Math.fround(Math.fround(v.value * zoom) * 64));
  const snappedDest = (available: number, v: LayerGeometry['positionX'], zoom: number): number => Math.floor((available - edgeOffsetLu(v, available, zoom) + 32) / 64) * 64;
  it('rounds right 10% where trunc(A - x) and A - trunc(x) part: a 20px layer in 6435 LU lands at 4672 LU, not 4608', () => {
    const at = (width: number, positionX: LayerGeometry['positionX']) => layerPlacement(box({ width }), geometry({ repeatX: 'no-repeat', repeatY: 'no-repeat', sizeX: { unit: 'px', value: 20 }, sizeY: { unit: 'px', value: 10 }, positionX }), 1, true, NO_GRADIENT_FAULTS).destX;
    // available 6435 - 1280 = 5155 LU; 10% is 515.5 LU, truncated to 515; 5155 - 515 = 4640, which rounds to 73 px.
    expect(at(6435, { unit: 'end-percent', value: 10 })).toBe(4672);
    expect([6506, 6577, 6648, 7004].map((w) => at(w, { unit: 'end-percent', value: 10 }))).toEqual([4736, 4800, 4864, 5184]);
    expect([6442, 6527].map((w) => at(w, { unit: 'end-percent', value: 25 }))).toEqual([3904, 3968]);
    for (let w = 6400; w <= 8960; w++) {
      for (const v of [{ unit: 'end-percent', value: 10 }, { unit: 'end-percent', value: 33 }, { unit: 'end-px', value: 0.3 }] as const) expect(at(w, v), `${v.unit} ${v.value} at ${w}`).toBe(snappedDest(w - 1280, v, 1));
    }
  });
  it('places a layer from the bottom edge the same way: bottom 0.3px and bottom 10% at zoom 1 and 2', () => {
    const at = (height: number, positionY: LayerGeometry['positionY'], zoom: number) => layerPlacement(box({ height }), geometry({ repeatX: 'no-repeat', repeatY: 'no-repeat', sizeX: { unit: 'px', value: 20 }, sizeY: { unit: 'px', value: 10 }, positionY }), zoom, true, NO_GRADIENT_FAULTS).destY;
    // zoom 1, height 3251: available 3251 - 640 = 2611 LU; 0.3px is 19.2 LU, truncated to 19; 2611 - 19 = 2592 = 40.5 px, rounding to 41.
    expect(at(3251, { unit: 'end-px', value: 0.3 }, 1)).toBe(2624);
    // zoom 2, height 3206: available 3206 - 1280 = 1926 LU; 0.6 device px is 38.4 LU, truncated to 38; 1888 = 29.5 px, rounding to 30.
    expect(at(3206, { unit: 'end-px', value: 0.3 }, 2)).toBe(1920);
    for (let h = 3200; h <= 6400; h += 7) {
      for (const zoom of [1, 2]) {
        for (const v of [{ unit: 'end-px', value: 0.3 }, { unit: 'end-px', value: 10.3 }, { unit: 'end-percent', value: 10 }] as const) {
          expect(at(h, v, zoom), `${v.unit} ${v.value} at ${h} zoom ${zoom}`).toBe(snappedDest(h - Math.trunc(Math.fround(Math.fround(10 * zoom) * 64)), v, zoom));
        }
      }
    }
  });
});
