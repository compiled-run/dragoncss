// The unit registry: every dimension unit the compiler gives its own meaning. A unit that is not registered still parses (the
// @webref/css grammar decides validity) and keeps its lowercased name, so its feature key is <length-<unit>> and the support
// profiles decide whether it is supported. A registered unit either converts to px at computed-value time (analysis/computed.ts)
// or is refused with its precise reason at parse time.

/**
 * How a registered length converts to px (css-values-4 §6):
 * - absolute: value * pxPer, the fixed ratio of §6.2 (Blink's kCssPixelsPer* constants, in double);
 * - font-relative: value * the element's computed font-size (em), or the root element's (rem), §6.1.1;
 * - refused: no build-time conversion exists; reason says why, fix what to write instead.
 */
export type UnitConversion =
  | { readonly kind: 'canonical' }
  | { readonly kind: 'absolute'; readonly pxPer: number }
  | { readonly kind: 'font-relative'; readonly base: 'em' | 'rem' }
  | { readonly kind: 'refused'; readonly reason: string; readonly fix: string };

/** One registered unit: its lowercased name, its dimension, the value-type part of its feature key, and its conversion. */
export type UnitEntry = { readonly unit: string; readonly dimension: 'length'; readonly featureType: string; readonly conversion: UnitConversion };

/** The canonical length unit: a unitless zero length (CSS2 §4.3.2) resolves to 0px. */
export const CANONICAL_LENGTH_UNIT = 'px';

// Blink css_primitive_value.h: the absolute-unit ratios, each derived in double exactly as Chrome derives it.
const PX_PER_IN = 96;
const PX_PER_CM = PX_PER_IN / 2.54;
const PX_PER_MM = PX_PER_CM / 10;
const PX_PER_Q = PX_PER_MM / 4;
const PX_PER_PT = PX_PER_IN / 72;
const PX_PER_PC = PX_PER_IN / 6;

const FONT_METRIC_REASON = 'it is measured from the primary font at its rendered size, which Chrome rounds to 0.01px after device zoom, so no single build-time px value is exact at every pixel ratio';
const FONT_METRIC_FIX = 'Use em, rem or px.';
const LINE_HEIGHT_REASON = 'it is the used line height, which the layout engine rounds to 1/64 px (and takes from font metrics for line-height: normal), so it needs the engine value-model package';
const VIEWPORT_REASON = 'viewport units resolve against the device viewport at run time, so they need the engine value-model package (docs/research/coverage-roadmap.md, wave 2)';
const VIEWPORT_FIX = 'Use %, px, em or rem until viewport units reach the engine.';
const CONTAINER_REASON = 'container query units need container queries, which are not supported';

const refused = (reason: string, fix: string): UnitConversion => ({ kind: 'refused', reason, fix });
const length = (unit: string, conversion: UnitConversion): UnitEntry => ({ unit, dimension: 'length', featureType: `<length-${unit}>`, conversion });

export const UNITS: readonly UnitEntry[] = [
  length('px', { kind: 'canonical' }),
  length('cm', { kind: 'absolute', pxPer: PX_PER_CM }),
  length('mm', { kind: 'absolute', pxPer: PX_PER_MM }),
  length('q', { kind: 'absolute', pxPer: PX_PER_Q }),
  length('in', { kind: 'absolute', pxPer: PX_PER_IN }),
  length('pt', { kind: 'absolute', pxPer: PX_PER_PT }),
  length('pc', { kind: 'absolute', pxPer: PX_PER_PC }),
  length('em', { kind: 'font-relative', base: 'em' }),
  length('rem', { kind: 'font-relative', base: 'rem' }),
  ...['ex', 'rex', 'ch', 'rch', 'cap', 'rcap', 'ic', 'ric'].map((u) => length(u, refused(FONT_METRIC_REASON, FONT_METRIC_FIX))),
  ...['lh', 'rlh'].map((u) => length(u, refused(LINE_HEIGHT_REASON, FONT_METRIC_FIX))),
  ...['vw', 'vh', 'vi', 'vb', 'vmin', 'vmax', 'svw', 'svh', 'svi', 'svb', 'svmin', 'svmax', 'lvw', 'lvh', 'lvi', 'lvb', 'lvmin', 'lvmax', 'dvw', 'dvh', 'dvi', 'dvb', 'dvmin', 'dvmax']
    .map((u) => length(u, refused(VIEWPORT_REASON, VIEWPORT_FIX))),
  ...['cqw', 'cqh', 'cqi', 'cqb', 'cqmin', 'cqmax'].map((u) => length(u, refused(CONTAINER_REASON, 'Use %, px, em or rem.'))),
];

const BY_NAME: ReadonlyMap<string, UnitEntry> = new Map(UNITS.map((u) => [u.unit, u]));

/** css-values-4 §6: unit names are ASCII case-insensitive; the compiler keeps them lowercased. */
export function normalizeUnit(raw: string): string {
  return raw.toLowerCase();
}

/** The registered entry of a lowercased unit, or null. */
export function unitEntry(unit: string): UnitEntry | null {
  return BY_NAME.get(unit) ?? null;
}

/** The value-type part of a length's feature key: the registered one, or <length-<unit>> for an unregistered unit. */
export function lengthFeatureType(unit: string): string {
  return unitEntry(unit)?.featureType ?? `<length-${unit}>`;
}

/** The refusal of a registered unit with no build-time conversion, or null. */
export function unitRefusal(unit: string): { readonly reason: string; readonly fix: string } | null {
  const c = unitEntry(unit)?.conversion;
  return c !== undefined && c.kind === 'refused' ? c : null;
}

/** The font sizes a font-relative length resolves against, in px: the element's computed font-size and the root's. */
export type FontBases = { readonly em: number; readonly rem: number };

/**
 * css-values-4 §6: a length in px, computed in double as Blink's CSSToLengthConversionData::ZoomedComputedPixels does at zoom 1
 * (Length then keeps it as float; the engine applies that). Null for a unit with no build-time conversion.
 */
export function lengthToPx(value: number, unit: string, fonts: FontBases): number | null {
  const c = unitEntry(unit)?.conversion;
  if (c === undefined) return null;
  switch (c.kind) {
    case 'canonical':
      return value;
    case 'absolute':
      return value * c.pxPer;
    case 'font-relative':
      return value * (c.base === 'em' ? fonts.em : fonts.rem);
    case 'refused':
      return null;
  }
}

const MATH_FUNCTIONS: ReadonlySet<string> = new Set(['calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem', 'abs', 'sign']);

/**
 * css-values-4 §10: math functions stay refused. A calculation with percentages or viewport units resolves at layout, so they
 * belong to the engine value-model package; a build-time fold of constant calculations is not proven against Chrome yet.
 */
export function mathFunctionRefusal(name: string): { readonly reason: string; readonly fix: string } | null {
  if (!MATH_FUNCTIONS.has(name.toLowerCase())) return null;
  return {
    reason: `${name.toLowerCase()}() is a css-values-4 math function, which needs the engine value-model package (docs/research/coverage-roadmap.md, wave 2)`,
    fix: 'Write the resolved length (px, em, rem, cm, mm, Q, in, pt or pc) or a percentage instead.',
  };
}
