// TXT-FX: text-shadow, text-stroke and text-fill-color (coverage-rank lane TXT-FX); analysis/text-shadow.ts rules on text-shadow.

export type TxtFxFaults = {
  /** Every text-shadow list is accepted on every target, including those the native targets do not draw as Chrome does. */
  readonly textShadowListAccepted: boolean;
};

export const TXT_FX_FAULTS: TxtFxFaults = { textShadowListAccepted: false };
