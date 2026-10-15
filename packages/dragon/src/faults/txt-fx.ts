// TXT-FX: text-shadow, text-stroke and text-fill-color (coverage-rank lane TXT-FX); Dragon accepts text-shadow: none alone.

export type TxtFxFaults = {
  /** A text-shadow other than none is accepted, though no target draws text shadows. */
  readonly textShadowListAccepted: boolean;
};

export const TXT_FX_FAULTS: TxtFxFaults = { textShadowListAccepted: false };
