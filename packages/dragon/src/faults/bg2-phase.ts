// BG2-t (analysis/paint-values/gradient-phase.ts): a no-repeat gradient layer away from the start edge, which the native background
// plan models only where the compiler proves its tile lands inside the box at every device scale.

export type Bg2PhaseFaults = {
  /** The tile phase check is skipped: a no-repeat layer at any position compiles for the native targets. */
  readonly gradientPhaseUnchecked: boolean;
};

export const BG2_PHASE_FAULTS: Bg2PhaseFaults = { gradientPhaseUnchecked: false };
