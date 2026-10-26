// The device scales the native targets' device lanes run at, in a module of its own so any check can read them without the gradient
// analysis behind gradient-phase.ts.

/** The device scales each native target's device lanes run at (parity targets.ts deviceDprs checks it holds the same). */
export const NATIVE_DEVICE_DPRS: { readonly ios: readonly number[]; readonly android: readonly number[] } = { ios: [2, 3], android: [2, 3, 2.625] };
