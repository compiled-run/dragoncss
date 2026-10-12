// The hit lane leaves out, each by name, PNT2's transform-writing cases (until SELD-R2b T146), these PNT1 cases with a stacking
// context below the root (until rt-hit.ts orders z-index and opacity layers) and these INL1a inline-box and <br> cases (rt-hit.ts
// hitRefusal). Shared by hit-report.test.ts and lanes.test.ts so both judge the same exact union.
export const INLINE_OUT: readonly string[] = [
  'inline-mixed-sizes', 'inline-mixed-sizes-rtl', 'inline-empty-boxes', 'inline-empty-boxes-rtl', 'inline-br', 'inline-br-rtl', 'inline-box-boundaries',
  'inline-box-boundaries-rtl', 'inline-box-hyphen', 'inline-tags', 'inline-tags-rtl', 'inline-baselines', 'inline-baselines-rtl',
];
export const INLINE_REASON = /is (an inline box|a <br>), which the hit table does not model yet/;
export const TRANSFORM_REASON = /^transform on .+: hit testing through transforms is SELD-R2b \(T146\)$/;
export const STACKING_OUT: readonly string[] = [
  'opacity-basic', 'opacity-basic-rtl', 'opacity-cascade', 'opacity-cascade-rtl', 'opacity-web', 'opacity-web-rtl', 'stacking-basic',
  'stacking-basic-rtl', 'stacking-context', 'stacking-context-rtl', 'stacking-escape', 'stacking-escape-rtl',
];
export const STACKING_REASON = /^stacking context on .+: hit testing through z-index and opacity layers is not modelled yet/;
