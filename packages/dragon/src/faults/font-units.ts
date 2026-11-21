// Font-metric units (ex, ch, cap) in layout lengths.

export type FontUnitsFaults = {
  /** The ios lowering reads ex, ch and cap as em of the element's font, so an ex or cap length over Ahem is 1.25 times too long. */
  readonly fontMetricAsEm: boolean;
};

export const FONT_UNITS_FAULTS: FontUnitsFaults = { fontMetricAsEm: false };
