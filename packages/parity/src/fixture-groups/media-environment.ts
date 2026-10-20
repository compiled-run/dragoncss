// Fixture group media-environment (notes/T067-mq-r-spec.md §4 MQ-R2, R9), ltr and rtl: @media on the device features MQ-R2 reads.
// Their bands depend on the device, not the root, so they are not layout cases (a layout case's native program is folded on one
// device for every DPR): each runs only as its script (ENV_SCRIPTS), on the band runtime and in Chrome (resize-capture.ts), with a
// dump after the start and after every step at DPR 1, 2, 2.625 and 3. Chrome starts on its desktop page (a mouse, no motion
// preference); an env step switches touch emulation (Emulation.setTouchEmulationEnabled) or emulates prefers-reduced-motion
// (Emulation.setEmulatedMedia), and on the device the same step injects the same readings. resolution needs no step: each DPR is
// its own device. Readings touch emulation cannot give (no pointer, a touch screen with a mouse...) are a pointers step: Chrome takes
// them at launch (--blink-settings), so its capture opens the step's page there, while the device injects them live.
import type { FixtureSpec } from '../fixtures.ts';
import { both } from './define.ts';
import type { ResizeScript, ResizeStep } from './media-runtime.ts';

export const MEDIA_ENVIRONMENT_FIXTURES: readonly FixtureSpec[] = [
  both('mqr2-any-hover'),
  both('mqr2-pointer-hover'),
  both('mqr2-reduced-motion'),
  both('mqr2-resolution'),
  both('mqr2-resolution-dpcm'),
  both('mqr2-resolution-dpcm-max'),
];

/** The group's parity fixtures: none, as its fixtures run only as their scripts (MEDIA_ENVIRONMENT_FIXTURES, ENV_SCRIPTS). */
export const MEDIA_ENVIRONMENT: readonly FixtureSpec[] = [];

const r = (width: number, height: number): ResizeStep => ({ kind: 'resize', width, height });
const pointer = (value: 'touch' | 'desktop'): ResizeStep => ({ kind: 'env', reading: 'pointer', value });
const pointers = (pointer: 'none' | 'coarse' | 'fine', anyPointer: readonly ('coarse' | 'fine')[], hover: 'none' | 'hover', anyHover: 'none' | 'hover'): ResizeStep => ({ kind: 'env', reading: 'pointers', value: { pointer, anyPointer, hover, anyHover } });
const motion = (value: 'reduce' | 'no-preference'): ResizeStep => ({ kind: 'env', reading: 'motion', value });

export const ENV_SCRIPTS: readonly ResizeScript[] = [
  // any-hover on its own (with mqr2-pointer-hover's atoms it would split 24 bands): touch, back, touch at a narrower root.
  { fixture: 'mqr2-any-hover', start: { width: 400, height: 304 }, steps: [pointer('touch'), pointer('desktop'), r(352, 304), pointer('touch')] },
  // Touch and back, a resize across max-width 360 (any-pointer: fine with it), touch at the narrow size; then every other set of
  // readings the band partition splits (no pointer, a hovering primary, a fine pointer that cannot hover, a touch screen with a
  // mouse), each at both widths, so the script visits all 16 bands.
  { fixture: 'mqr2-pointer-hover', start: { width: 400, height: 304 }, steps: [
    pointer('touch'), pointer('desktop'), r(352, 304), pointer('touch'), r(400, 304),
    pointers('none', [], 'none', 'none'), r(352, 304), pointers('none', [], 'hover', 'hover'), r(400, 304),
    pointers('coarse', ['coarse'], 'hover', 'hover'), r(352, 304), pointers('fine', ['fine'], 'none', 'none'), r(400, 304),
    pointers('coarse', ['coarse', 'fine'], 'none', 'hover'), r(352, 304), pointers('coarse', ['coarse', 'fine'], 'hover', 'hover'), r(400, 304),
  ] },
  // Reduce and back, across max-width 360 in both settings.
  { fixture: 'mqr2-reduced-motion', start: { width: 400, height: 304 }, steps: [motion('reduce'), r(352, 304), motion('no-preference'), motion('reduce'), r(400, 304)] },
  // The scale is the device's: every DPR is one band of the four resolution atoms.
  { fixture: 'mqr2-resolution', start: { width: 400, height: 304 }, steps: [r(352, 304), r(400, 304)] },
  // dpcm compares at two decimals: each atom holds at its DPR only through that rounding, and every DPR is its own band.
  { fixture: 'mqr2-resolution-dpcm', start: { width: 400, height: 304 }, steps: [r(352, 304), r(400, 304)] },
  { fixture: 'mqr2-resolution-dpcm-max', start: { width: 400, height: 304 }, steps: [r(352, 304), r(400, 304)] },
];
