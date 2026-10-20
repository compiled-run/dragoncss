// The @media band lookup a native root runs when its size changes (notes/T067-mq-r-spec.md R2, R3, R4). The compiler writes each
// media feature of the stylesheet as a typed atom and each band as the truth vector of all atoms; the device evaluates every atom
// on the root's media size and looks the vector up, and never sees CSS. The comparisons are Chrome 145's media query evaluator's
// (CompareDoubleValue, HandleNegativeMediaFeatureValue, OrientationMediaFeatureEval, AspectRatioMediaFeatureEval), implemented
// from the measurements M2 and M3 rather than from its code: >= and <= take 1/64 px of slack, = is within 1/64, < and > are exact,
// and orientation and aspect-ratio read the truncated size. The media size is the float Chrome derives from the root's whole
// device px (measured, M1, M4, M5). MQ-R2 (R9) adds the device atoms: resolution and -webkit-device-pixel-ratio compare the float
// device scale exactly with the float dppx value (dpcm rounded to two decimals on both sides, measured), and pointer, any-pointer,
// hover, any-hover and prefers-reduced-motion compare the platform's readings with their keywords.
import { floorOf, froundOf, truncOf } from './rt-easing.ts';

/** LayoutUnit::Epsilon(): the slack of >=, <= and = in CompareDoubleValue. */
export const MEDIA_EPSILON = 1 / 64;

export type BandOp = 'lt' | 'le' | 'gt' | 'ge' | 'eq';

/**
 * One comparison of an atom: the size (or the size ratio) against value px (or num/den), the size on the left. For resolution,
 * value is the query in float dppx, num is 1 when both sides round to two decimals (a dpcm query) and 0 otherwise, and den is 0.
 */
export type BandComparison = { readonly op: BandOp; readonly value: number; readonly num: number; readonly den: number };

export type BandFeature = 'width' | 'height' | 'orientation' | 'aspect-ratio' | 'resolution' | 'pointer' | 'any-pointer' | 'hover' | 'any-hover' | 'prefers-reduced-motion';

export type BandKeyword = 'portrait' | 'landscape' | 'none' | 'any' | 'coarse' | 'fine' | 'hover' | 'no-preference' | 'reduce';

/**
 * One media feature as the compiler wrote it. comparisons: every comparison must hold (a two-sided range has two); none is the
 * boolean form. keyword: orientation's value ('none' for its boolean form), a discrete device feature's value ('any' for its
 * boolean form, which holds unless the reading is none or no-preference), and 'none' for width, height, aspect-ratio and
 * resolution (-webkit-device-pixel-ratio is written as resolution).
 */
export type BandAtom = { readonly feature: BandFeature; readonly comparisons: readonly BandComparison[]; readonly keyword: BandKeyword };

/**
 * The device's readings (T067 R9): its scale, the primary pointer ('none', 'coarse' or 'fine') and whether it hovers, which pointers
 * any of its pointing devices is (anyCoarse, anyFine) and whether any hovers, and the user's reduced-motion setting.
 */
export type BandEnvironment = {
  readonly dpr: number;
  readonly pointer: string;
  readonly hover: boolean;
  readonly anyCoarse: boolean;
  readonly anyFine: boolean;
  readonly anyHover: boolean;
  readonly reducedMotion: boolean;
};

/** The band table of a stylesheet: its atoms and, per band in band order, the truth value of every atom. */
export type BandTable = { readonly atoms: readonly BandAtom[]; readonly bands: readonly (readonly boolean[])[] };

/** Planted faults of the band lookup; a device or host lane must catch each one. */
export type BandFaults = {
  /** >= and <= compare strictly and = exactly, so a root exactly at a threshold takes the wrong band. */
  readonly bandBoundaryExclusive: boolean;
  /** MQ-R2: the Android primary pointer is fine before coarse (pointer_device.cc's desktop rule, not pointer_device_android.cc's). */
  readonly primaryPointerFineFirst: boolean;
};

export const NO_BAND_FAULTS: BandFaults = { bandBoundaryExclusive: false, primaryPointerFineFirst: false };

export class BandError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super(`band lookup: ${detail}`);
    this.detail = detail;
  }
}

/** The media width or height of a root px whole device px wide at a device pixel ratio: fround(fround(px) * fround(1 / fround(dpr))). */
export function mediaSize(px: number, dpr: number): number {
  if (!(px >= 0) || px !== truncOf(px)) throw new BandError(`a root size must be whole device px, got ${px}`);
  if (!(dpr > 0) || dpr === 1 / 0) throw new BandError(`a device pixel ratio must be finite and positive, got ${dpr}`);
  return froundOf(froundOf(px) * froundOf(1 / froundOf(dpr)));
}

/** CompareDoubleValue: actual against a non-negative query with 1/64 slack on >=, <= and =; a negative query only holds for > and >=. */
export function compareMedia(actual: number, query: number, op: BandOp, faults: BandFaults): boolean {
  if (query < 0) return op === 'gt' || op === 'ge';
  const precision = faults.bandBoundaryExclusive ? 0 : MEDIA_EPSILON;
  if (op === 'ge') return faults.bandBoundaryExclusive ? actual > query : actual >= query - precision;
  if (op === 'le') return faults.bandBoundaryExclusive ? actual < query : actual <= query + precision;
  if (op === 'eq') {
    const d = actual - query;
    return (d < 0 ? -d : d) <= precision;
  }
  if (op === 'lt') return actual < query;
  return actual > query;
}

/** Two decimals of a float scale, as Chrome compares a dpcm query: floorf(0.5 + 100 x) / 100 in float. */
export function twoDecimals(x: number): number {
  return froundOf(floorOf(froundOf(0.5 + froundOf(100 * x))) / 100);
}

/** An exact comparison of two float scales (CompareValue). */
function compareScale(actual: number, query: number, op: BandOp): boolean {
  if (op === 'ge') return actual >= query;
  if (op === 'le') return actual <= query;
  if (op === 'eq') return actual === query;
  if (op === 'lt') return actual < query;
  return actual > query;
}

/** Whether a discrete device feature's atom holds for the readings. */
function readingHolds(atom: BandAtom, env: BandEnvironment): boolean {
  const k = atom.keyword;
  if (atom.feature === 'prefers-reduced-motion') return k === 'reduce' || k === 'any' ? env.reducedMotion : !env.reducedMotion;
  if (atom.feature === 'pointer') return k === 'any' ? env.pointer !== 'none' : env.pointer === k;
  if (atom.feature === 'hover') return k === 'any' || k === 'hover' ? env.hover : !env.hover;
  if (atom.feature === 'any-hover') return k === 'any' || k === 'hover' ? env.anyHover : !env.anyHover;
  // any-pointer: none matches only with no pointing device; the boolean form with any.
  if (k === 'coarse') return env.anyCoarse;
  if (k === 'fine') return env.anyFine;
  const some = env.anyCoarse || env.anyFine;
  return k === 'any' ? some : !some;
}

/** Whether one atom holds at a media size (CSS px, as mediaSize gives it) on a device. */
export function atomHolds(atom: BandAtom, width: number, height: number, env: BandEnvironment, faults: BandFaults): boolean {
  if (atom.feature === 'resolution') {
    // EvalResolution compares ClampTo<float>(the device scale) exactly with the query's float dppx.
    const actual = froundOf(env.dpr);
    if (atom.comparisons.length === 0) return actual !== 0;
    for (const c of atom.comparisons) {
      const holds = c.num === 1 ? compareScale(twoDecimals(actual), twoDecimals(c.value), c.op) : compareScale(actual, c.value, c.op);
      if (!holds) return false;
    }
    return true;
  }
  if (atom.feature !== 'width' && atom.feature !== 'height' && atom.feature !== 'orientation' && atom.feature !== 'aspect-ratio') return readingHolds(atom, env);
  if (atom.feature === 'width' || atom.feature === 'height') {
    const actual = atom.feature === 'width' ? width : height;
    if (atom.comparisons.length === 0) return actual !== 0;
    for (const c of atom.comparisons) if (!compareMedia(actual, c.value, c.op, faults)) return false;
    return true;
  }
  // OrientationMediaFeatureEval and AspectRatioMediaFeatureEval take int width = *media_values.Width().
  const w = truncOf(width);
  const h = truncOf(height);
  if (atom.feature === 'orientation') {
    if (atom.keyword === 'none') return h >= 0 && w >= 0;
    // A square viewport is portrait.
    return w > h ? atom.keyword === 'landscape' : atom.keyword === 'portrait';
  }
  if (atom.comparisons.length === 0) return true;
  for (const c of atom.comparisons) if (!compareMedia(w * c.den, h * c.num, c.op, faults)) return false;
  return true;
}

/** The truth value of every atom at a media size on a device, in atom order. */
export function truthVector(table: BandTable, width: number, height: number, env: BandEnvironment, faults: BandFaults): boolean[] {
  const out: boolean[] = [];
  for (const a of table.atoms) out.push(atomHolds(a, width, height, env, faults));
  return out;
}

/** The band whose truth vector equals the atoms' values at a media size on a device; a vector no band has is an error, never a guess. */
export function bandIndex(table: BandTable, width: number, height: number, env: BandEnvironment, faults: BandFaults): number {
  const v = truthVector(table, width, height, env, faults);
  for (let k = 0; k < table.bands.length; k++) {
    const b = table.bands[k] as readonly boolean[];
    if (b.length !== v.length) throw new BandError(`band ${k} has ${b.length} truth values for ${v.length} atoms`);
    let same = true;
    for (let i = 0; i < v.length; i++) if ((b[i] as boolean) !== (v[i] as boolean)) same = false;
    if (same) return k;
  }
  let bits = '';
  for (const x of v) bits += x ? '1' : '0';
  throw new BandError(`no band has the truth vector ${bits} at ${width} x ${height} css px`);
}

/** The band of a root of whole device px on a device (its scale is env.dpr). */
export function bandAtPx(table: BandTable, widthPx: number, heightPx: number, env: BandEnvironment, faults: BandFaults): number {
  return bandIndex(table, mediaSize(widthPx, env.dpr), mediaSize(heightPx, env.dpr), env, faults);
}

// ---------------------------------------------------------------- the Android pointer and hover readings (MQ-R2, T067 R9)
//
// A port of Chromium's TouchDevice.availablePointerAndHoverTypes (ui/android/java/src/org/chromium/ui/base/TouchDevice.java,
// lines 59-104) and of the primary pointer and hover rule of ui/base/pointer/pointer_device_android.cc (lines 35-55), at tag
// 145.0.7632.6: a pointing device with a mouse, stylus, touchpad or trackball source is fine, a touch screen is coarse, and a
// mouse, touchpad or trackball hovers; the primary pointer is coarse when any device is, else fine, else none, and the primary
// hover is hover exactly when any device hovers. The input is each input device's getSources().
// Copyright 2014 The Chromium Authors (TouchDevice.java); Copyright 2013 The Chromium Authors (pointer_device_android.cc).
// Use of this source code is governed by a BSD-style license that can be found in the LICENSE file (THIRD_PARTY_NOTICES.md,
// chromium-bsd).

/** InputDevice source constants (android.view.InputDevice, API 31). */
export const SOURCE_TOUCHSCREEN = 4098;
export const SOURCE_MOUSE = 8194;
export const SOURCE_STYLUS = 16386;
export const SOURCE_TRACKBALL = 65540;
export const SOURCE_TOUCHPAD = 1048584;

/** The pointer and hover readings of a set of pointing devices. */
export type PointerReadings = { readonly pointer: string; readonly hover: boolean; readonly anyCoarse: boolean; readonly anyFine: boolean; readonly anyHover: boolean };

/** TouchDevice.hasSource: every bit of the source constant is set in sources ((sources & source) == source, without bit operators). */
export function hasSource(sources: number, source: number): boolean {
  if (!(sources >= 0) || sources !== truncOf(sources) || !(source > 0) || source !== truncOf(source)) throw new BandError(`input sources must be whole and non-negative, got ${sources} and ${source}`);
  let s = sources;
  let m = source;
  while (m > 0) {
    if (m - 2 * floorOf(m / 2) === 1 && s - 2 * floorOf(s / 2) !== 1) return false;
    m = floorOf(m / 2);
    s = floorOf(s / 2);
  }
  return true;
}

/** The readings Chrome on Android reports for input devices with these sources (each one InputDevice.getSources()). */
export function androidPointerReadings(sources: readonly number[], faults: BandFaults): PointerReadings {
  let anyFine = false;
  let anyCoarse = false;
  let anyHover = false;
  for (const s of sources) {
    if (hasSource(s, SOURCE_MOUSE) || hasSource(s, SOURCE_STYLUS) || hasSource(s, SOURCE_TOUCHPAD) || hasSource(s, SOURCE_TRACKBALL)) anyFine = true;
    if (hasSource(s, SOURCE_TOUCHSCREEN)) anyCoarse = true;
    if (hasSource(s, SOURCE_MOUSE) || hasSource(s, SOURCE_TOUCHPAD) || hasSource(s, SOURCE_TRACKBALL)) anyHover = true;
  }
  // GetPrimaryPointerType: coarse first, then fine. GetPrimaryHoverType: hover only when no device leaves the set at none.
  const pointer = faults.primaryPointerFineFirst ? (anyFine ? 'fine' : anyCoarse ? 'coarse' : 'none') : anyCoarse ? 'coarse' : anyFine ? 'fine' : 'none';
  return { pointer, hover: anyHover, anyCoarse, anyFine, anyHover };
}
