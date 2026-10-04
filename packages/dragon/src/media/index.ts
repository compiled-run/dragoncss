// Media Queries 4 for Dragon: parser, serialiser, Chrome's evaluator over { width, height } and the band partition. Pure TypeScript.
export { band, bandAt, contains, evaluateInBand, MAX_BANDS, mediaAtoms } from './band.ts';
export type { Band, BandPartition, Interval, MediaAtom } from './band.ts';
export { compareMedia, comparisonsOf, evaluateFeature, evaluateMediaQueryList, evaluateWithOracle, MEDIA_EPSILON, refusalsOf } from './evaluate.ts';
export type { FeatureOracle, MediaEnvironment, MediaRefusal, MediaResult } from './evaluate.ts';
export { ENVIRONMENT_FEATURES } from './features.ts';
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
