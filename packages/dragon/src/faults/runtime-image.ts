// An img whose src is set at run time and whose height follows its image (images/runtime.ts).

export type RuntimeImageFaults = {
  /** The build sweep does not compare inline sizes and positions with the img's 0 by 0 layout (rule 2). */
  readonly runtimeFollowsWidthUnchecked: boolean;
};

export const RUNTIME_IMAGE_FAULTS: RuntimeImageFaults = { runtimeFollowsWidthUnchecked: false };
