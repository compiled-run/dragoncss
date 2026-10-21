// TXT2-tal: text-align-last (css-text-3 §7.2).

export type Txt2talFaults = {
  /** Any text-align-last is accepted, though the engine aligns a block's last line as text-align-last: auto does. */
  readonly alignLastAccepted: boolean;
};

export const TXT2_TAL_FAULTS: Txt2talFaults = { alignLastAccepted: false };
