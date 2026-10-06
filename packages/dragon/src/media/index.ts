// Media Queries 4 for Dragon: parser, serialiser, Chrome's evaluator over { width, height } and the device readings (MQ-R2), and the
// band partition. Pure TypeScript.
export { band, bandAt, contains, evaluateInBand, holdsWholePx, MAX_BANDS, mediaAtoms } from './band.ts';
export type { Band, BandPartition, Interval, MediaAtom } from './band.ts';
export { clampToFloat, compareMedia, comparisonsOf, DESKTOP_DEVICE, evaluateFeature, evaluateMediaQueryList, evaluateWithOracle, MEDIA_EPSILON, refusalsOf, TOUCH_DEVICE } from './evaluate.ts';
export type { FeatureOracle, MediaDevice, MediaEnvironment, MediaRefusal, MediaResult } from './evaluate.ts';
export { DEVICE_FEATURES, ENVIRONMENT_FEATURES } from './features.ts';
export { MEDIA_FAULT_NAMES, NO_MEDIA_FAULTS } from './faults.ts';
export type { MediaFaults } from './faults.ts';
export { INITIAL_FONT_SIZE, resolveLength } from './length.ts';
export type { MediaLength } from './length.ts';
export {
  featuresOf,
  featuresOfList,
  parseMediaPrelude,
  parseMediaQueryList,
  serialiseCondition,
  serialiseFeature,
  serialiseMediaQuery,
  serialiseMediaQueryList,
} from './parse.ts';
export type { Comparison, MediaCondition, MediaFeature, MediaInParens, MediaQuery, MediaQueryList, MediaValue } from './parse.ts';
export { exactNumber } from './number.ts';
export { emulatedDevicePx, emulatedMediaViewport, iframeDevicePx, mediaSize, mediaViewport } from './viewport.ts';
export type { NumberFormat } from './number.ts';
