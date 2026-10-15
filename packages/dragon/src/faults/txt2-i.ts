// TXT2-i: hyphens (css-text-3 §6.1) and the -webkit-hyphens alias (notes/T149-txt2-spec.md R14).

export type Txt2IFaults = {
  /** hyphens: none is accepted on text that holds a soft hyphen, where the engine still breaks after it and shows the hyphen. */
  readonly noneSoftHyphenAccepted: boolean;
};

export const TXT2_I_FAULTS: Txt2IFaults = { noneSoftHyphenAccepted: false };
