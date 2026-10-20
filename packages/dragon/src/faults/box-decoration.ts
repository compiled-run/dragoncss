// css-break-4 §5.4: box-decoration-break; Dragon accepts its initial value, slice, alone.

export type BoxDecorationFaults = {
  /** box-decoration-break: clone is accepted, though no target lays out or draws cloned fragments. */
  readonly boxDecorationAccepted: boolean;
};

export const BOX_DECORATION_FAULTS: BoxDecorationFaults = { boxDecorationAccepted: false };
