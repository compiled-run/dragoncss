// FIELD-font-width: a text field in a face whose average character width Dragon does not measure.

export type FieldFontWidthFaults = {
  /** A field in an unmeasured face is accepted natively whatever its width, so its used width may read its intrinsic width. */
  readonly fieldWidthAnyContext: boolean;
};

export const FIELD_FONT_WIDTH_FAULTS: FieldFontWidthFaults = { fieldWidthAnyContext: false };
