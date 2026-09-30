// Internal fault switches, reachable only through createProjectWith, so the parity harness can prove it fails (docs/api.md §7).

export type CompilerFaults = {
  /** The ios lowering swaps content-box and border-box. */
  readonly swapBoxSizing: boolean;
  /** The resolver ignores the last class of every compound selector with two or more classes, collapsing variants. */
  readonly variantCollapse: boolean;
  /** The resolver moves every resolved colour's red channel by one step and changes nothing else. */
  readonly colourOnly: boolean;
  /** The resolver ignores the state on this element address: its classes and attributes keep their initial-assignment values. */
  readonly stateCollapse: string | null;
  /** The resolver does not write the inherited font-size onto text nodes: each text node's font-size reverts to its initial value. */
  readonly dropInheritedText: boolean;
  /** The resolver gives the root direction ltr whatever the environment direction (M4). */
  readonly ignoreEnvironmentDirection: boolean;
  /** The cascade gives :is() the specificity of its first argument instead of its most specific one (Selectors-4 §17). */
  readonly isSpecificityFirstArgument: boolean;
  /** Spec-reading fault of the Chrome deviation empty-counts-whitespace: :empty ignores whitespace-only text (Selectors-4 §14.2). */
  readonly emptyIgnoresWhitespace: boolean;
  /** The cascade resolves direction before var() substitution: a direction declaration holding var() is skipped. */
  readonly directionBeforeVar: boolean;
  /** A flow-relative declaration holding var() is not narrowed to the element's direction: it competes on both physical sides. */
  readonly varLogicalBothSides: boolean;
  /** The cascade counts an #id selector in the class column instead of the id column (Selectors-4 §17). */
  readonly idSpecificityAsClass: boolean;
  /** Attribute values compare case-sensitively even for names in HTML's case-insensitive list (HTML §4.16.2). */
  readonly attributeCaseAlwaysSensitive: boolean;
  /** A rule whose selector list Chrome drops (one selector it does not parse) keeps its other selectors. */
  readonly invalidSelectorListKept: boolean;
  /** The web output writes a pinned generic as authored instead of its pinned family. */
  readonly pinnedGenericNotRewritten: boolean;
  /** The web output omits the @font-face rules of the pinned and declared faces. */
  readonly fontFaceNotEmitted: boolean;
  /** The compilation digest leaves out the font manifest. */
  readonly fontManifestOutOfDigest: boolean;
  /** A family that is neither declared nor mapped is accepted without a diagnostic. */
  readonly unmappedFamilyAccepted: boolean;
  /** Flex and grid items and absolutely positioned boxes keep their inline-level display (css-display-3 §2.7). */
  readonly blockifySkipped: boolean;
  /** Blockification turns inline-flex into block instead of flex. */
  readonly inlineFlexToBlock: boolean;
};

export const NO_FAULTS: CompilerFaults = { swapBoxSizing: false, variantCollapse: false, colourOnly: false, stateCollapse: null, dropInheritedText: false, ignoreEnvironmentDirection: false, isSpecificityFirstArgument: false, emptyIgnoresWhitespace: false, directionBeforeVar: false, varLogicalBothSides: false, idSpecificityAsClass: false, attributeCaseAlwaysSensitive: false, invalidSelectorListKept: false, pinnedGenericNotRewritten: false, fontFaceNotEmitted: false, fontManifestOutOfDigest: false, unmappedFamilyAccepted: false, blockifySkipped: false, inlineFlexToBlock: false };
