// SELD-R2: the interaction states (:hover, :active, :focus, :focus-visible).

export type SeldR2Faults = {
  /** The interaction partition loses the last :hover candidate, so a hover rule on it never applies (SELD-R2a). */
  readonly interactionRuleDropped: boolean;
  /** A combination of two or more interaction dimensions resolves as its first non-none dimension alone (SELD-R2 R7). */
  readonly comboStateDropped: boolean;
  /** The web output's :hover conditions are not wrapped in @media (hover: hover), so a tap leaves a hover style (SELD-R2 R3). */
  readonly webHoverUngated: boolean;
  /** An interaction rule in a case with a paint fact the hit test does not model is not refused on native (SELD-R2 R13). */
  readonly hitUnmodelledNotRefused: boolean;
};

export const SELD_R2_FAULTS: SeldR2Faults = { interactionRuleDropped: false, comboStateDropped: false, webHoverUngated: false, hitUnmodelledNotRefused: false };
