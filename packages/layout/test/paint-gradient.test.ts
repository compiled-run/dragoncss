// BG2 gradient reference (paint-gradient.ts): the exact arithmetic it rests on, pinned against the capture host's libm (Apple
// arm64 tanf and atan2f, printed by a C program on the macOS capture host), JS's correctly rounded Math.sqrt and exact BigInt
// products; the SkMatrix port; and Blink's background tile geometry. Pixel equality with Chrome is bg2-reference.test.ts's.
import { describe, expect, it } from 'vitest';
import { atan2F32, fma64, fmodF32, hypotF32, IDENTITY, layerPlacement, matConcat, matInvert, matType, NO_GRADIENT_FAULTS, sqrtF32, sqrtF64, tanF32 } from '../src/paint-gradient.ts';
import type { BackgroundBox, LayerGeometry } from '../src/paint-gradient.ts';

/** tanf(x) on the capture host: [x, tanf(x)], the linear-gradient slopes of 35 angles and 9 other arguments. */
const TANF: readonly (readonly [number, number])[] = [
  [1.5533430576324463, 57.2900390625],
  [1.27409029006958, 3.2708518505096436],
  [1.0471975803375244, 1.732050895690918],
  [0.9948376417160034, 1.5398648977279663],
  [0.9197885394096375, 1.3126877546310425],
  [0.7853981852531433, 1],
  [0.008726646192371845, 0.008726867847144604],
  [-0.01745329238474369, -0.01745506562292576],
  [-0.3490658402442932, -0.36397022008895874],
  [-0.5838125944137573, -0.6606312394142151],
  [-0.7853981852531433, -1],
  [-1.5533430576324463, -57.2900390625],
  [-1.5882495641708374, 57.29014205932617],
  [-1.919862151145935, 2.7474777698516846],
  [-2.356194496154785, 1],
  [-2.862339973449707, 0.2867453694343567],
  [-2.879793167114258, 0.26794928312301636],
  [-2.96705961227417, 0.17632710933685303],
  [-3.1241393089294434, 0.017455117776989937],
  [-3.159045934677124, -0.017455052584409714],
  [-3.263765573501587, -0.12278443574905396],
  [-3.5081117153167725, -0.3838639259338379],
  [-3.647738218307495, -0.5543091893196106],
  [-3.665191411972046, -0.5773502588272095],
  [-3.769911050796509, -0.7265422940254211],
  [-3.9269907474517822, -0.9999998807907104],
  [-4.066617012023926, -1.3270444869995117],
  [-4.084070205688477, -1.376381278038025],
  [-4.363323211669922, -2.7474782466888428],
  [-4.572762489318848, -7.11536169052124],
  [-4.590215682983398, -8.144329071044922],
  [-4.607669353485107, -9.514375686645508],
  [-4.6949357986450195, -57.29032516479492],
  [1.5706217288970947, 5727.44580078125],
  [-4.712214469909668, -5730.31494140625],
  [0.000009999999747378752, 0.000009999999747378752],
  [-0.0003000000142492354, -0.0003000000142492354],
  [0.5, 0.5463024973869324],
  [-0.7850000262260437, -0.9992040395736694],
  [0.7853999733924866, 1.0000035762786865],
  [2.299999952316284, -1.1192137002944946],
  [-4.5, -4.637331962585449],
  [100, -0.587213933467865],
  [12345.677734375, -0.9920240044593811]
];

/** atan2f(y, x) on the capture host: [y, x, atan2f(y, x)], every octant and the special ratios. */
const ATAN2F: readonly (readonly [number, number, number])[] = [
  [90, 60, 0.9827937483787537],
  [-90, 60, -0.9827937483787537],
  [37.5, -81, 2.7080111503601074],
  [-37.5, -81, -2.7080111503601074],
  [120, 13, 1.4628838300704956],
  [-13, -120, -3.0336802005767822],
  [1, 9.99999993922529e-9, 1.5707963705062866],
  [64, 64, 0.7853981852531433],
  [64, -64, 2.356194496154785],
  [-64, -64, -2.356194496154785],
  [0.375, 300, 0.0012499993899837136]
];

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
  it('tanF32 is Apple libm tanf on every pinned argument', () => {
    for (const [x, want] of TANF) expect(tanF32(x, NO_GRADIENT_FAULTS), String(x)).toBe(want);
  });
  it('the tanCorrectlyRounded plant differs from tanf on a pinned slope', () => {
    const plant = { ...NO_GRADIENT_FAULTS, tanCorrectlyRounded: true };
    expect(TANF.filter(([x, want]) => tanF32(x, plant) !== want).length).toBeGreaterThan(0);
  });
  it('atan2F32 is Apple libm atan2f in every octant', () => {
    for (const [y, x, want] of ATAN2F) expect(atan2F32(y, x), `${y}, ${x}`).toBe(want);
  });
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
    const p = layerPlacement(box({ x: 20480, y: 1331, width: 12857, height: 5158 }), geometry({}), 2, true);
    expect([p.tileWidth, p.tileHeight, p.destX, p.destY, p.destWidth, p.destHeight, p.srcX, p.srcY, p.singleTile]).toEqual([12864, 5120, 20480, 1344, 12864, 5120, 0, 0, true]);
  });
  it('tiles a repeating layer whose clip box is larger than its origin box', () => {
    const b = box({ borders: [384, 384, 384, 384] });
    expect(layerPlacement(b, geometry({}), 2, true).singleTile).toBe(false);
    expect(layerPlacement(b, geometry({ clip: 'padding-box' }), 2, true).singleTile).toBe(true);
    expect(layerPlacement(b, geometry({ origin: 'border-box' }), 2, true).singleTile).toBe(true);
  });
  it('tiles a repeating layer smaller than its area or shifted by a position, and never a no-repeat layer', () => {
    const small = geometry({ sizeX: { unit: 'px', value: 40 } });
    expect(layerPlacement(box({}), small, 2, true).singleTile).toBe(false);
    expect(layerPlacement(box({}), { ...small, repeatX: 'no-repeat' }, 2, true).singleTile).toBe(true);
    expect(layerPlacement(box({ width: 12857 }), geometry({ positionX: { unit: 'percent', value: 50 } }), 2, true).singleTile).toBe(false);
    const p = layerPlacement(box({}), geometry({ repeatX: 'no-repeat', repeatY: 'no-repeat', positionX: { unit: 'px', value: 20 }, positionY: { unit: 'percent', value: 100 }, sizeX: { unit: 'percent', value: 60 }, sizeY: { unit: 'px', value: 25 } }), 2, true);
    expect([p.destX, p.destY, p.destWidth, p.destHeight, p.singleTile]).toEqual([2560, 0, 3840, 3200, true]);
  });
});
