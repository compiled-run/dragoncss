// ENV-SAFE: env(safe-area-inset-*).

export type EnvSafeFaults = {
  /** Resolution writes 0px for every env() call, as a compiler that resolved the insets at build time would (css/env.ts envAsZero). */
  readonly envResolvedToZero: boolean;
  /** The native lowering reads the opposite inset: top for bottom, left for right (css/math.ts lowerLeaf). */
  readonly envSideSwapped: boolean;
};

export const ENV_SAFE_FAULTS: EnvSafeFaults = { envResolvedToZero: false, envSideSwapped: false };
