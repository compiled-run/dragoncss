// Planted faults of the fonts module. Each one breaks a single rule so the tests can prove a Chrome capture (or, marked unit, a
// unit check) catches it. They are reachable only through the fonts functions' faults argument.

export type FontFaults = {
  /** A weight request in the 400 to 500 band searches upward without the 500 limit. */
  readonly weightBandUpwardFirst: boolean;
  /** Every oblique request is matched as the italic slope. */
  readonly obliqueAsItalic: boolean;
  /** The algorithm compares weight first and stretch last. */
  readonly weightBeforeStretch: boolean;
  /** Within a capability group the first declared face is tried first. */
  readonly firstDeclaredWins: boolean;
  /** unicode-range does not filter the faces of a group. */
  readonly unicodeRangeIgnored: boolean;
  /** Ascent and descent round x.5 down instead of up (Skia SkScalarRoundToScalar is floorf(x + 0.5f)). */
  readonly metricsRoundHalfDown: boolean;
  /** x-height is taken from OS/2 sxHeight instead of the bounds of glyph x. */
  readonly xHeightFromOs2: boolean;
  /** ch goes through the 16.16 advance step. */
  readonly chWith16_16: boolean;
  /** Cap height comes from the bounds of glyph H instead of OS/2 sCapHeight. */
  readonly capHeightFromBounds: boolean;
  /** ascent-, descent- and line-gap-override and size-adjust are ignored. */
  readonly overridesIgnored: boolean;
  /** (unit) A remote src URL is accepted instead of refused. */
  readonly remoteUrlAccepted: boolean;
  /** (unit) The manifest keeps faces in declaration order, so reordering rules changes the digest. */
  readonly manifestOrderSensitive: boolean;
  /** (unit) An unreadable first src is skipped and a later one used. */
  readonly skipUnreadableSrc: boolean;
  /** (unit) The variable-font fence lets every variable face and instance through. */
  readonly fenceDisabled: boolean;
  /** bolder of a parent weight of exactly 350 stays in the band below (400 instead of 700). */
  readonly bolderBandEdge: boolean;
  /** lighter of a parent weight of exactly 550 stays in the band below (100 instead of 400). */
  readonly lighterBandEdge: boolean;
  /** An element with no font-weight of its own takes 400 instead of its parent's computed weight. */
  readonly weightNotInherited: boolean;
  /** font-style: oblique <angle> computes to italic, dropping the angle. */
  readonly obliqueAngleDropped: boolean;
  /** Bold is synthesized only for a request of 700 and up, not 600. */
  readonly syntheticBoldThreshold700: boolean;
  /** Weights and oblique angles round to the nearest quarter unit instead of truncating toward zero. */
  readonly quarterUnitRounding: boolean;
};

export const NO_FONT_FAULTS: FontFaults = {
  weightBandUpwardFirst: false,
  obliqueAsItalic: false,
  weightBeforeStretch: false,
  firstDeclaredWins: false,
  unicodeRangeIgnored: false,
  metricsRoundHalfDown: false,
  xHeightFromOs2: false,
  chWith16_16: false,
  capHeightFromBounds: false,
  overridesIgnored: false,
  remoteUrlAccepted: false,
  manifestOrderSensitive: false,
  skipUnreadableSrc: false,
  fenceDisabled: false,
  bolderBandEdge: false,
  lighterBandEdge: false,
  weightNotInherited: false,
  obliqueAngleDropped: false,
  syntheticBoldThreshold700: false,
  quarterUnitRounding: false,
};

export type FontFaultName = keyof FontFaults;

/** The faults a Chrome capture must catch, and those only a unit check catches. */
export const CAPTURE_FAULTS: readonly FontFaultName[] = [
  'weightBandUpwardFirst', 'obliqueAsItalic', 'weightBeforeStretch', 'firstDeclaredWins', 'unicodeRangeIgnored',
  'metricsRoundHalfDown', 'xHeightFromOs2', 'chWith16_16', 'capHeightFromBounds', 'overridesIgnored',
];
export const UNIT_FAULTS: readonly FontFaultName[] = ['remoteUrlAccepted', 'manifestOrderSensitive', 'skipUnreadableSrc', 'fenceDisabled'];
/** The computed font-weight and font-style faults (TXT-W1, fonts/weight.ts), each caught against Chrome by text-weight.test.ts. */
export const WEIGHT_FAULTS: readonly FontFaultName[] = ['bolderBandEdge', 'lighterBandEdge', 'weightNotInherited', 'obliqueAngleDropped', 'syntheticBoldThreshold700', 'quarterUnitRounding'];

export function withFault(name: FontFaultName): FontFaults {
  return { ...NO_FONT_FAULTS, [name]: true };
}
