// The device lane ids, apart from device-lanes.ts, so profile:rows names them without importing the device lane runner.

export const DEVICE_CHECK_LANES = ['device-frames', 'device-applied', 'device-lines', 'device-pixels'] as const;
export type DeviceCheckLane = (typeof DEVICE_CHECK_LANES)[number];

/** SELD-R1b's device lanes: the case scripts' dumps (device-states) and the device hit test's answers (device-hit). */
export const STATE_LANE = 'device-states';
export const HIT_LANE = 'device-hit';
/** ANIM-b1 3b (T065 R18): every frame sample's dump, checked by the four device checks against that sample's references. */
export const ANIM_LANE = 'device-anim';
/** SELD-R2's device lane (T064 R14): the interaction scripts' traces against the TS interaction runtime's. */
export const TRACE_LANE = 'device-traces';
export type DeviceLaneId = DeviceCheckLane | typeof STATE_LANE | typeof HIT_LANE | typeof ANIM_LANE | typeof TRACE_LANE;
