// Selectors: specificity, :empty, attribute case and dropped selector lists.

export type SelectorsFaults = {
  /** The cascade gives :is() the specificity of its first argument instead of its most specific one (Selectors-4 §17). */
  readonly isSpecificityFirstArgument: boolean;
  /** Spec-reading fault of the Chrome deviation empty-counts-whitespace: :empty ignores whitespace-only text (Selectors-4 §14.2). */
  readonly emptyIgnoresWhitespace: boolean;
  /** The cascade counts an #id selector in the class column instead of the id column (Selectors-4 §17). */
  readonly idSpecificityAsClass: boolean;
  /** Attribute values compare case-sensitively even for names in HTML's case-insensitive list (HTML §4.16.2). */
  readonly attributeCaseAlwaysSensitive: boolean;
  /** A rule whose selector list Chrome drops (one selector it does not parse) keeps its other selectors. */
  readonly invalidSelectorListKept: boolean;
};

export const SELECTORS_FAULTS: SelectorsFaults = { isSpecificityFirstArgument: false, emptyIgnoresWhitespace: false, idSpecificityAsClass: false, attributeCaseAlwaysSensitive: false, invalidSelectorListKept: false };
