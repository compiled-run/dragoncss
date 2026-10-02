// font-weight and font-style computed values and the synthesis predicate, ported from Chromium 145.0.7632.6:
// style_builder_converter.cc ConvertFontWeight and ConvertFontStyle (1107-1185), font_description.cc BolderWeight and LighterWeight
// (158-187), and css_segmented_font_face.cc (115-122) for synthesis. Values are FontSelectionValue quarter units (selection.ts).
import type { CssValue } from '../css/values.ts';
import { ANGLE_DEGREES, OBLIQUE_ANGLE_TYPE } from '../css/values.ts';
import { NO_FONT_FAULTS } from './faults.ts';
import type { FontFaults } from './faults.ts';
import type { FontSelectionCapabilities, FontSelectionRequest } from './selection.ts';
import { fsv, kBoldThreshold, kItalicThreshold, selectionRequest } from './selection.ts';

/** A computed font-style: normal, italic (slope 14, which bare oblique and oblique 14deg also compute to), or oblique <degrees>. */
export type ComputedFontStyle = { readonly kind: 'normal' } | { readonly kind: 'italic' } | { readonly kind: 'oblique'; readonly degrees: number };

/** The initial computed weight and style (css-fonts-4 §2.2, §2.3: normal). */
export const NORMAL_WEIGHT = 400;
export const NORMAL_STYLE: ComputedFontStyle = { kind: 'normal' };

/** A value in FontSelectionValue quarter units: truncated toward zero (fsv), or rounded under the quarterUnitRounding plant. */
export function quarterUnits(x: number, faults: FontFaults = NO_FONT_FAULTS): number {
  if (faults.quarterUnitRounding) return Math.round(Math.fround(x) * 4) / 4;
  return fsv(Math.fround(x)).raw / 4;
}

/** font_description.cc BolderWeight. */
export function bolderWeight(parent: number, faults: FontFaults = NO_FONT_FAULTS): number {
  if (parent < 350 || (faults.bolderBandEdge && parent === 350)) return 400;
  if (parent < 550) return 700;
  if (parent < 900) return 900;
  return parent;
}

/** font_description.cc LighterWeight. */
export function lighterWeight(parent: number, faults: FontFaults = NO_FONT_FAULTS): number {
  if (parent < 100) return parent;
  if (parent < 550 || (faults.lighterBandEdge && parent === 550)) return 100;
  if (parent < 750) return 400;
  return 700;
}

/**
 * ConvertFontWeight: normal 400, bold 700, bolder and lighter from the parent's computed weight, and a number (a literal in [1,1000],
 * or a folded calculation) clamped to [1,1000] in quarter units. Null for a value that is none of these.
 */
export function computeFontWeight(value: CssValue, parent: number, faults: FontFaults = NO_FONT_FAULTS): number | null {
  if (value.kind === 'number') return quarterUnits(Math.min(1000, Math.max(1, value.value)), faults);
  if (value.kind !== 'keyword') return null;
  switch (value.value) {
    case 'normal':
      return NORMAL_WEIGHT;
    case 'bold':
      return 700;
    case 'bolder':
      return bolderWeight(parent, faults);
    case 'lighter':
      return lighterWeight(parent, faults);
    default:
      return null;
  }
}

/** The weight an element with no font-weight of its own computes to: its parent's (400 under the weightNotInherited plant). */
export function inheritedFontWeight(parent: number, faults: FontFaults = NO_FONT_FAULTS): number {
  return faults.weightNotInherited ? NORMAL_WEIGHT : parent;
}

/**
 * ConvertFontStyle: italic and bare oblique are slope 14; oblique <angle> is its degrees in quarter units, and an angle of 0 computes
 * to normal and of 14 to italic, as the FontSelectionValue compares. Null for a value that is none of these.
 */
export function computeFontStyle(value: CssValue, faults: FontFaults = NO_FONT_FAULTS): ComputedFontStyle | null {
  if (value.kind === 'keyword') {
    if (value.value === 'normal') return NORMAL_STYLE;
    if (value.value === 'italic' || value.value === 'oblique') return { kind: 'italic' };
    return null;
  }
  if (value.kind !== 'other' || value.type !== OBLIQUE_ANGLE_TYPE) return null;
  if (faults.obliqueAngleDropped) return { kind: 'italic' };
  const m = /^oblique (-?[0-9.e+-]+)([a-z]+)$/.exec(value.text);
  const perUnit = m === null ? undefined : ANGLE_DEGREES[m[2] as string];
  if (m === null || perUnit === undefined) return null;
  const degrees = quarterUnits(Number(m[1]) * perUnit, faults);
  if (degrees === 0) return NORMAL_STYLE;
  if (degrees === 14) return { kind: 'italic' };
  return { kind: 'oblique', degrees };
}

/** A computed text font: font-weight in quarter units and font-style. */
export type TextFontValue = { readonly weight: number; readonly style: ComputedFontStyle };

/** The root's parent text font: the initial values. */
export const INITIAL_TEXT_FONT: TextFontValue = { weight: NORMAL_WEIGHT, style: NORMAL_STYLE };

/**
 * An element's computed font-weight and font-style from its specified values, where null is inherited (no declaration, or
 * inherit), and its parent's computed ones. Null when a specified value is neither property's.
 */
export function computeTextFont(specified: { readonly weight: CssValue | null; readonly style: CssValue | null }, parent: TextFontValue, faults: FontFaults = NO_FONT_FAULTS): TextFontValue | null {
  const weight = specified.weight === null ? inheritedFontWeight(parent.weight, faults) : computeFontWeight(specified.weight, parent.weight, faults);
  const style = specified.style === null ? parent.style : computeFontStyle(specified.style, faults);
  return weight === null || style === null ? null : { weight, style };
}

/** getComputedStyle's font-weight: the number, as Chrome serializes a float (100.25, 400). */
export const serializeFontWeight = (weight: number): string => String(weight);

/** getComputedStyle's font-style: normal, italic, or oblique <n>deg. */
export function serializeFontStyle(style: ComputedFontStyle): string {
  return style.kind === 'oblique' ? `oblique ${style.degrees}deg` : style.kind;
}

/** The computed value a resolved element holds for font-style. */
export function fontStyleCssValue(style: ComputedFontStyle): CssValue {
  return style.kind === 'oblique' ? { kind: 'other', type: OBLIQUE_ANGLE_TYPE, text: serializeFontStyle(style) } : { kind: 'keyword', value: style.kind };
}

/** The selection request of a computed weight and style, at normal stretch. */
export function requestOf(weight: number, style: ComputedFontStyle): FontSelectionRequest {
  return selectionRequest(weight, 100, style);
}

/**
 * css_segmented_font_face.cc: bold is synthesized when the request is 600 or more and the matched face's maximum weight is below 600,
 * and italic when the request slope is 14 or more and the face's maximum slope is below 14. Null when Chrome draws the face as it is.
 */
export function synthesisOf(capabilities: FontSelectionCapabilities, request: FontSelectionRequest, faults: FontFaults = NO_FONT_FAULTS): 'synthetic bold' | 'synthetic oblique' | null {
  const boldAt = faults.syntheticBoldThreshold700 ? fsv(700) : kBoldThreshold;
  if (request.weight.raw >= boldAt.raw && capabilities.weight.maximum.raw < kBoldThreshold.raw) return 'synthetic bold';
  if (request.slope.raw >= kItalicThreshold.raw && capabilities.slope.maximum.raw < kItalicThreshold.raw) return 'synthetic oblique';
  return null;
}
