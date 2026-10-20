// compositing-1 §9.2: background-blend-mode; Dragon accepts its initial value, normal, alone.

export type BackgroundBlendFaults = {
  /** A background-blend-mode other than normal is accepted, though no target blends background layers yet. */
  readonly backgroundBlendAccepted: boolean;
};

export const BACKGROUND_BLEND_FAULTS: BackgroundBlendFaults = { backgroundBlendAccepted: false };
