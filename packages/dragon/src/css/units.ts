// The unit registry: every dimension unit the compiler gives its own meaning. A unit that is not registered still parses (the
// @webref/css grammar decides validity) and keeps its lowercased name, so its feature key is <length-<unit>> and the support
// profiles decide whether it is supported. Today only px is registered: every other unit reaches the profiles unconverted.

/** One registered unit: its lowercased name, its dimension, and the value-type part of its support-profile feature key. */
export type UnitEntry = { readonly unit: string; readonly dimension: 'length'; readonly featureType: string };

/** The canonical length unit: a unitless zero length (CSS2 §4.3.2) resolves to 0px. */
export const CANONICAL_LENGTH_UNIT = 'px';

export const UNITS: readonly UnitEntry[] = [
  { unit: 'px', dimension: 'length', featureType: '<length-px>' },
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
