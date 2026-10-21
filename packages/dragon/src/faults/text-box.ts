// text-box-trim and text-box-edge (css-inline-3 §5.1-§5.2).

export type TextBoxFaults = {
  /** Every text-box-trim is accepted, though the engine trims only a plain block of inline content in a block. */
  readonly textBoxTrimAccepted: boolean;
};

export const TEXT_BOX_FAULTS: TextBoxFaults = { textBoxTrimAccepted: false };
