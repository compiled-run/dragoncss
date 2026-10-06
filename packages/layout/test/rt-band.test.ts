// MQ-R1 (notes/T067-mq-r-spec.md R2, R3, R4): the band lookup. The comparison rules are Chrome 145's, pinned here by the
// measurements M1 to M5 (notes/T067 §0, /tmp/t067-probe), and the media size is Chrome's float of the root's whole device px.
import { describe, expect, it } from 'vitest';
import { rtBand } from '../src/index.ts';

const { atomHolds, bandAtPx, bandIndex, BandError, compareMedia, mediaSize, NO_BAND_FAULTS, truthVector } = rtBand;
type Atom = rtBand.BandAtom;
const EXCLUSIVE: rtBand.BandFaults = { bandBoundaryExclusive: true, primaryPointerFineFirst: false };
/** Headless Chrome's desktop page at DPR 1: a mouse, no motion preference (MQ-R2). */
const DESK: rtBand.BandEnvironment = { dpr: 1, pointer: 'fine', hover: true, anyCoarse: false, anyFine: true, anyHover: true, reducedMotion: false };

const px = (op: rtBand.BandOp, value: number, feature: 'width' | 'height' = 'width'): Atom => ({ feature, comparisons: [{ op, value, num: 0, den: 0 }], keyword: 'none' });
const ratio = (op: rtBand.BandOp, num: number, den: number): Atom => ({ feature: 'aspect-ratio', comparisons: [{ op, value: 0, num, den }], keyword: 'none' });
const orientation = (keyword: 'portrait' | 'landscape'): Atom => ({ feature: 'orientation', comparisons: [], keyword });

describe('the media size (R3)', () => {
  it('is fround(fround(px) * fround(1 / dpr)): 1080 device px at DPR 2.625 is 411.4285888671875 (M4)', () => {
    expect(mediaSize(1080, 2.625)).toBe(411.4285888671875);
    // Neither double division (411.428571...) nor float division (411.428558...) gives Chrome's value.
    expect(mediaSize(1080, 2.625)).not.toBe(1080 / 2.625);
    expect(mediaSize(1080, 2.625)).not.toBe(Math.fround(Math.fround(1080) / Math.fround(2.625)));
  });
  it('is exact on the 8 css px grid at every device DPR, so the lane sizes need no rounding', () => {
    for (const dpr of [1, 2, 2.625, 3]) for (let w = 8; w <= 400; w += 8) expect(mediaSize(w * dpr, dpr), `${w} at ${dpr}`).toBe(w);
  });
  it('takes whole device px and a finite positive DPR only', () => {
    for (const [p, d] of [[10.5, 2], [-1, 2], [Number.NaN, 2], [10, 0], [10, -2], [10, Number.POSITIVE_INFINITY], [10, Number.NaN]] as const) expect(() => mediaSize(p, d), `${p} at ${d}`).toThrow(BandError);
  });
});

describe('the comparisons (R2, CompareDoubleValue)', () => {
  it('give >=, <= and = 1/64 px of slack at a whole width of 640 (M2)', () => {
    const at = (a: Atom): boolean => atomHolds(a, 640, 300, DESK, NO_BAND_FAULTS);
    for (const a of [px('le', 639.99), px('le', 639.984375), px('ge', 640.01), px('ge', 640.015625), px('eq', 640.01), px('eq', 639.99), px('gt', 639.99), px('lt', 640.01)]) expect(at(a), JSON.stringify(a)).toBe(true);
    for (const a of [px('le', 639.98), px('ge', 640.02), px('gt', 640), px('lt', 640), px('eq', 640.02)]) expect(at(a), JSON.stringify(a)).toBe(false);
  });
  it('keep < and > exact, and a negative query holds only for > and >= (HandleNegativeMediaFeatureValue)', () => {
    expect(compareMedia(640, 640, 'gt', NO_BAND_FAULTS)).toBe(false);
    expect(compareMedia(640, 640, 'lt', NO_BAND_FAULTS)).toBe(false);
    expect([...(['lt', 'le', 'eq', 'gt', 'ge'] as const)].map((op) => compareMedia(0, -1, op, NO_BAND_FAULTS))).toEqual([false, false, false, true, true]);
  });
  it('read orientation and aspect-ratio from the truncated size; a square is portrait (M3)', () => {
    expect(atomHolds(orientation('portrait'), 400.75, 400.25, DESK, NO_BAND_FAULTS)).toBe(true);
    expect(atomHolds(orientation('portrait'), 400.25, 400.75, DESK, NO_BAND_FAULTS)).toBe(true);
    expect(atomHolds(ratio('eq', 1, 1), 400.75, 400.25, DESK, NO_BAND_FAULTS)).toBe(true);
    expect(atomHolds(orientation('landscape'), 401, 400.75, DESK, NO_BAND_FAULTS)).toBe(true);
    expect(atomHolds(ratio('ge', 2, 1), 640.25, 320.25, DESK, NO_BAND_FAULTS)).toBe(true);
    expect(atomHolds(ratio('gt', 2, 1), 640.25, 320.25, DESK, NO_BAND_FAULTS)).toBe(false);
  });
  it('give the boolean forms Chrome\'s answers: width and height when not 0, orientation and aspect-ratio always', () => {
    const bool = (feature: rtBand.BandFeature): Atom => ({ feature, comparisons: [], keyword: 'none' });
    expect([atomHolds(bool('width'), 0, 10, DESK, NO_BAND_FAULTS), atomHolds(bool('width'), 1, 10, DESK, NO_BAND_FAULTS), atomHolds(bool('height'), 10, 0, DESK, NO_BAND_FAULTS)]).toEqual([false, true, false]);
    expect([atomHolds(bool('orientation'), 0, 0, DESK, NO_BAND_FAULTS), atomHolds(bool('aspect-ratio'), 0, 0, DESK, NO_BAND_FAULTS)]).toEqual([true, true]);
  });
  it('need every comparison of a two-sided range to hold', () => {
    const range: Atom = { feature: 'width', comparisons: [{ op: 'gt', value: 320, num: 0, den: 0 }, { op: 'le', value: 384, num: 0, den: 0 }], keyword: 'none' };
    expect([320, 321, 384, 385].map((w) => atomHolds(range, w, 300, DESK, NO_BAND_FAULTS))).toEqual([false, true, true, false]);
  });
  it('the planted bandBoundaryExclusive flips each inclusive threshold, and nothing else', () => {
    expect(atomHolds(px('le', 320), 320, 300, DESK, EXCLUSIVE)).toBe(false);
    expect(atomHolds(px('ge', 352), 352, 300, DESK, EXCLUSIVE)).toBe(false);
    expect(atomHolds(px('le', 320), 319, 300, DESK, EXCLUSIVE)).toBe(true);
    expect(atomHolds(px('gt', 384), 384, 300, DESK, EXCLUSIVE)).toBe(false);
  });
});

describe('the band lookup (R4)', () => {
  // mqr-width-switch: max-width 320, min-width 352, width > 384, four bands.
  const table: rtBand.BandTable = { atoms: [px('le', 320), px('ge', 352), px('gt', 384)], bands: [[true, false, false], [false, false, false], [false, true, false], [false, true, true]] };
  it('looks the truth vector up, at each threshold and between them', () => {
    expect([304, 320, 336, 352, 384, 392, 400].map((w) => bandIndex(table, w, 304, DESK, NO_BAND_FAULTS))).toEqual([0, 0, 1, 2, 2, 3, 3]);
    expect(truthVector(table, 352, 304, DESK, NO_BAND_FAULTS)).toEqual([false, true, false]);
  });
  it('takes the root in device px at a DPR', () => {
    expect([1, 2, 2.625, 3].map((d) => bandAtPx(table, 352 * d, 304 * d, { ...DESK, dpr: d }, NO_BAND_FAULTS))).toEqual([2, 2, 2, 2]);
  });
  it('a vector no band has is an error naming it, never a guessed band', () => {
    const gap: rtBand.BandTable = { atoms: table.atoms, bands: table.bands.slice(0, 3) };
    expect(() => bandIndex(gap, 400, 304, DESK, NO_BAND_FAULTS)).toThrow(/no band has the truth vector 011 at 400 x 304 css px/);
    expect(() => bandIndex({ atoms: table.atoms, bands: [[true]] }, 300, 300, DESK, NO_BAND_FAULTS)).toThrow(/band 0 has 1 truth values for 3 atoms/);
  });
  it('a table without atoms is one band, whatever the size', () => {
    expect(bandIndex({ atoms: [], bands: [[]] }, 123, 45, DESK, NO_BAND_FAULTS)).toBe(0);
  });
});

describe('the device atoms (MQ-R2, R9)', () => {
  const res = (op: rtBand.BandOp, value: number, dpcm = false): Atom => ({ feature: 'resolution', comparisons: [{ op, value, num: dpcm ? 1 : 0, den: 0 }], keyword: 'none' });
  const at = (a: Atom, env: Partial<rtBand.BandEnvironment>): boolean => atomHolds(a, 400, 300, { ...DESK, ...env }, NO_BAND_FAULTS);
  it('compare the float scale exactly with the float query: 2.6250001dppx is 2.625, 2.624999dppx is not (measured)', () => {
    expect(at(res('eq', Math.fround(2.6250001)), { dpr: 2.625 })).toBe(true);
    expect(at(res('eq', Math.fround(2.624999)), { dpr: 2.625 })).toBe(false);
    expect(at(res('lt', 2.625), { dpr: 2.625 })).toBe(false);
    expect(at(res('le', 2.625), { dpr: 2.625 })).toBe(true);
  });
  it('round a dpcm comparison to two decimals on both sides: 99.22dpcm is 2.625dppx, 99.21dpcm is not (measured)', () => {
    const dpcm = (v: number): number => Math.fround(v * (1 / (96 / 2.54)));
    expect(at(res('eq', dpcm(99.22), true), { dpr: 2.625 })).toBe(true);
    expect(at(res('eq', dpcm(99.21), true), { dpr: 2.625 })).toBe(false);
    expect(rtBand.twoDecimals(2.625)).toBe(Math.fround(2.63));
  });
  it('answer the discrete features from the readings, with any for the boolean form', () => {
    const kw = (feature: rtBand.BandFeature, keyword: rtBand.BandKeyword): Atom => ({ feature, comparisons: [], keyword });
    const touch = { pointer: 'coarse', hover: false, anyCoarse: true, anyFine: false, anyHover: false };
    expect([at(kw('pointer', 'coarse'), touch), at(kw('pointer', 'fine'), touch), at(kw('pointer', 'any'), touch), at(kw('pointer', 'none'), { pointer: 'none' })]).toEqual([true, false, true, true]);
    expect([at(kw('hover', 'hover'), touch), at(kw('hover', 'none'), touch), at(kw('hover', 'any'), DESK)]).toEqual([false, true, true]);
    expect([at(kw('any-pointer', 'fine'), { anyCoarse: true, anyFine: true }), at(kw('any-pointer', 'none'), { anyCoarse: false, anyFine: false }), at(kw('any-pointer', 'any'), touch)]).toEqual([true, true, true]);
    expect([at(kw('any-hover', 'none'), touch), at(kw('prefers-reduced-motion', 'reduce'), { reducedMotion: true }), at(kw('prefers-reduced-motion', 'any'), DESK), at(kw('prefers-reduced-motion', 'no-preference'), DESK)]).toEqual([true, true, false, true]);
  });
  it('take the band\'s scale from the readings, so the same root px at another scale can take another band', () => {
    const table: rtBand.BandTable = { atoms: [res('ge', 2)], bands: [[true], [false]] };
    expect([1, 2, 3].map((d) => bandAtPx(table, 400 * d, 300 * d, { ...DESK, dpr: d }, NO_BAND_FAULTS))).toEqual([1, 0, 0]);
  });
});
