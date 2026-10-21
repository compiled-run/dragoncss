// SELD-R2 PR 5: the native interaction gate (analysis/interaction.ts gateInteractionFeatures).

export type InteractionGateFaults = {
  /** The native interaction gate accepts a rule whose profile row is missing, so an unproven pseudo-class compiles on native. */
  readonly interactionRowIgnored: boolean;
  /** rulesMayScroll counts overflow hidden as never scrolling, so hidden beside visible (which computes to auto) is missed. */
  readonly hiddenAxisUnpaired: boolean;
  /** rulesMayScroll takes a rule only body matches as propagated to the viewport even when html is not visible or is contained. */
  readonly bodyPropagationAssumed: boolean;
};

export const INTERACTION_FAULTS: InteractionGateFaults = { interactionRowIgnored: false, hiddenAxisUnpaired: false, bodyPropagationAssumed: false };
