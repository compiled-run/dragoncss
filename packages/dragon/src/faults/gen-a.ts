// GEN-a: ::before and ::after with string content, built as elements of the resolved tree (notes/T151-gen-spec.md R2-R12).

export type GenAFaults = {
  /** content: normal on ::before or ::after generates an empty box, where it computes to none (css-content-3 §2). */
  readonly pseudoContentNormalGenerates: boolean;
  /** The ::after box is placed as its host's first child, before the host's content. */
  readonly pseudoAfterFirst: boolean;
  /** A generated box inherits from its host's parent instead of its host (CSS2 §12.1). */
  readonly pseudoInheritsFromHostParent: boolean;
  /**
   * The legacy single-colon :before and :after weigh [0, 1, 0], as the pseudo-class css-tree parses them as, instead of the
   * pseudo-element's [0, 0, 1] (Selectors-4 §17; GEN-P family1 before-single-colon). Every generated box's rules carry one
   * pseudo-element, so only a weight that differs between spellings can change a winner.
   */
  readonly legacyPseudoAsClass: boolean;
  /** content: 'a' 'b' generates only its first string. */
  readonly contentFirstStringOnly: boolean;
  /** Generated text collapses its white space on its own, outside its host's inline formatting context (css-text-3 §4.1.1). */
  readonly generatedTextCollapsedAlone: boolean;
  /** ::before and ::after generate a box on a replaced element, where Chrome generates none. */
  readonly pseudoOnReplacedGenerated: boolean;
  /** A statically empty pseudo-element (::placeholder) is accepted although an element of the tree can host it. */
  readonly staticEmptyIgnoresHost: boolean;
};

export const GEN_A_FAULTS: GenAFaults = {
  pseudoContentNormalGenerates: false,
  pseudoAfterFirst: false,
  pseudoInheritsFromHostParent: false,
  legacyPseudoAsClass: false,
  contentFirstStringOnly: false,
  generatedTextCollapsedAlone: false,
  pseudoOnReplacedGenerated: false,
  staticEmptyIgnoresHost: false,
};
