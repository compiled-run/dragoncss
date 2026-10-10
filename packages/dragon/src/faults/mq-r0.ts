// MQ-R0: Chrome-exact @media evaluation (fractional-width bands).

export type MqR0Faults = {
  /** MQ-R0: the web output drops the @media block of every band no whole-px viewport lies in (master's pre-MQ-R0 output). */
  readonly mediaFractionalBandDropped: boolean;
};

export const MQ_R0_FAULTS: MqR0Faults = { mediaFractionalBandDropped: false };
