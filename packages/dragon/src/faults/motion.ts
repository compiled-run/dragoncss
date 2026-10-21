// The motion path family; Dragon accepts its initial values alone.

export type MotionFaults = {
  /** An offset-path, offset-distance, offset-position, offset-anchor or offset-rotate other than its initial value is accepted, though no target composes an offset transform. */
  readonly motionAccepted: boolean;
};

export const MOTION_FAULTS: MotionFaults = { motionAccepted: false };
