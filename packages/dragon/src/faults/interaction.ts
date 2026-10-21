// SELD-R2 PR 5: the native interaction gate (analysis/interaction.ts gateInteractionFeatures).

export type InteractionGateFaults = {
  /** The native interaction gate accepts a rule whose profile row is missing, so an unproven pseudo-class compiles on native. */
  readonly interactionRowIgnored: boolean;
};

export const INTERACTION_FAULTS: InteractionGateFaults = { interactionRowIgnored: false };
