// Fixture group media-environment (notes/T067-mq-r-spec.md §4 MQ-R2, R9), ltr and rtl: @media on the device features MQ-R2 reads.
// Their bands depend on the device, not the root, so they are not layout cases (a layout case's native program is folded on one
// device for every DPR): each runs only as its script (ENV_SCRIPTS), on the band runtime and in Chrome (resize-capture.ts), with a
// dump after the start and after every step at DPR 1, 2, 2.625 and 3. Chrome starts on its desktop page (a mouse, no motion
// preference); an env step switches touch emulation (Emulation.setTouchEmulationEnabled) or emulates prefers-reduced-motion
// (Emulation.setEmulatedMedia), and on the device the same step injects the same readings. resolution needs no step: each DPR is
// its own device. A touch screen with a mouse cannot be emulated, so those readings are proven by the Android port's vectors.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';
import type { ResizeScript, ResizeStep } from './media-runtime.ts';

export const MEDIA_ENVIRONMENT_FIXTURES: readonly FixtureSpec[] = [
  both('mqr2-any-hover'),
  both('mqr2-pointer-hover'),
  both('mqr2-reduced-motion'),
  both('mqr2-resolution'),
];

const r = (width: number, height: number): ResizeStep => ({ kind: 'resize', width, height });
const pointer = (value: 'touch' | 'desktop'): ResizeStep => ({ kind: 'env', reading: 'pointer', value });
const motion = (value: 'reduce' | 'no-preference'): ResizeStep => ({ kind: 'env', reading: 'motion', value });

export const ENV_SCRIPTS: readonly ResizeScript[] = [
  // any-hover on its own (with mqr2-pointer-hover's atoms it would split 24 bands): touch, back, touch at a narrower root.
  { fixture: 'mqr2-any-hover', start: { width: 400, height: 304 }, steps: [pointer('touch'), pointer('desktop'), r(352, 304), pointer('touch')] },
  // Touch and back, a resize across max-width 360 (any-pointer: fine with it), touch at the narrow size.
  { fixture: 'mqr2-pointer-hover', start: { width: 400, height: 304 }, steps: [pointer('touch'), pointer('desktop'), r(352, 304), pointer('touch'), r(400, 304)] },
  // Reduce and back, across max-width 360 in both settings.
  { fixture: 'mqr2-reduced-motion', start: { width: 400, height: 304 }, steps: [motion('reduce'), r(352, 304), motion('no-preference'), motion('reduce'), r(400, 304)] },
  // The scale is the device's: every DPR is one band of the four resolution atoms.
  { fixture: 'mqr2-resolution', start: { width: 400, height: 304 }, steps: [r(352, 304), r(400, 304)] },
];
