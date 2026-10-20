// Fixture group media-runtime (notes/T067-mq-r-spec.md §4 MQ-R1), ltr and rtl: @media bands that a native root switches at run
// time. Each fixture runs as a layout case at 400x300 like every other, and its resize script (RESIZE_SCRIPTS) runs on the band
// runtime and in Chrome (packages/parity/src/resize-capture.ts): a dump after the start and after every step, at DPR 1, 2, 2.625
// and 3. Every size is a multiple of 8 CSS px and at most 400x400, so it is whole device px at every DPR and every portrait stage
// holds it (R7 (a)). mqr-orientation proves MQ-R0's ratio atoms; a transition a size change starts (R8) is refused on native only, so its reject is a compiler test
// (packages/dragon/test/media-runtime.test.ts), not a fixture here, where a reject must block every output.
import type { PointerReadings, Scalar } from 'dragon';
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject, tree } from './define.ts';

export const MEDIA_RUNTIME: readonly FixtureSpec[] = [
  both('mqr-width-switch'),
  both('mqr-height'),
  tree('mqr-state-band'),
  both('mqr-vw-relayout'),
  both('mqr-nested'),
  both('mqr-music-shape'),
  both('mqr-forms'),
  both('mqr-orientation'),
  // device-env (T067 R7 (c)): a fill-the-stage tree whose root is the device's stage, rotated once on every device.
  tree('mqr-rotate'),
  reject('reject-mqr-17-bands', 'DRAGON_UNSUPPORTED_AT_RULE', '@media (min-width: 100px) { .a { width: 1px; } }', 'the @media rules of this document split the viewport into 17 bands, more than 16, which is not supported yet (package MQ-R4)'),
  // MQ-R2 reads prefers-reduced-motion; the other user preferences wait for MQ-R3.
  reject('reject-mqr-env-feature', 'DRAGON_UNSUPPORTED_AT_RULE', '@media (prefers-contrast: more) { .a { width: 20px; } }', '@media (prefers-contrast: more) in the stylesheet is not supported: (prefers-contrast: more) depends on the device or the user, which Dragon does not read yet (package MQ-R3)'),
];

export type Size = { readonly width: number; readonly height: number };

/**
 * One step of a resize script: a root size change in CSS px, an app setter (a free state's key "<instance>#<state>"), or (MQ-R2)
 * new device readings: the pointer reading of a touch screen or a desktop's mouse, every pointer and hover reading, or the
 * reduced-motion setting.
 */
export type ResizeStep =
  | { readonly kind: 'resize'; readonly width: number; readonly height: number }
  | { readonly kind: 'set'; readonly state: string; readonly value: Scalar }
  | { readonly kind: 'env'; readonly reading: 'pointer'; readonly value: 'touch' | 'desktop' }
  | { readonly kind: 'env'; readonly reading: 'motion'; readonly value: 'reduce' | 'no-preference' }
  /** Every pointer and hover reading at once; Chrome takes them at launch (--blink-settings), so its capture opens a new page there. */
  | { readonly kind: 'env'; readonly reading: 'pointers'; readonly value: PointerReadings };

/** A fixture's resize script: the root size it starts at and its steps; a dump follows the start and every step. */
export type ResizeScript = { readonly fixture: string; readonly start: Size; readonly steps: readonly ResizeStep[] };

const r = (width: number, height: number): ResizeStep => ({ kind: 'resize', width, height });
const set = (state: string, value: Scalar): ResizeStep => ({ kind: 'set', state, value });

export const RESIZE_SCRIPTS: readonly ResizeScript[] = [
  // max-width 320, min-width 352 and width > 384: inside, at and past each threshold, both orientations.
  { fixture: 'mqr-width-switch', start: { width: 400, height: 304 }, steps: [r(304, 400), r(352, 304), r(384, 304), r(392, 304), r(336, 304), r(320, 304), r(400, 304)] },
  { fixture: 'mqr-height', start: { width: 400, height: 304 }, steps: [r(400, 400), r(400, 352), r(400, 336), r(304, 320), r(400, 304)] },
  // A free state across three bands: set, resize, set, resize back.
  { fixture: 'mqr-state-band', start: { width: 400, height: 304 }, steps: [set('doc#open', true), r(352, 304), set('doc#open', false), r(304, 304), set('doc#open', true), r(400, 304)] },
  // No @media: every size change only lays out again.
  { fixture: 'mqr-vw-relayout', start: { width: 400, height: 304 }, steps: [r(304, 400), r(352, 352), r(400, 304)] },
  { fixture: 'mqr-nested', start: { width: 400, height: 304 }, steps: [r(384, 304), r(352, 304), r(312, 304), r(304, 400), r(392, 304), r(400, 304)] },
  // The north star's 768 and 640 breakpoints at half scale.
  { fixture: 'mqr-music-shape', start: { width: 400, height: 304 }, steps: [r(384, 304), r(352, 304), r(320, 304), r(304, 400), r(400, 304)] },
  // The other comparison forms the media rows cover: plain = (with its 1/64 px slack at 352), a strict < range, an em max- (24em is
  // 384px at the initial 16px) and a <= range on height; every width group in both height groups.
  { fixture: 'mqr-forms', start: { width: 400, height: 304 }, steps: [r(400, 400), r(384, 400), r(384, 304), r(352, 304), r(352, 400), r(344, 400), r(328, 400), r(328, 304), r(336, 320)] },
  // MQ-R0's ratio atoms: landscape, portrait (a square is portrait) and a max-aspect-ratio of 3/4, at, above and below it. (A
  // min-aspect-ratio with portrait would ship a band only a 0 x 0 root reaches, which no resize can prove.)
  { fixture: 'mqr-orientation', start: { width: 400, height: 296 }, steps: [r(352, 304), r(304, 304), r(304, 400), r(288, 384), r(296, 400), r(400, 296)] },
];

/** The largest root a resize script may ask for, so every portrait stage of the device matrix holds it (R7 (a)). */
export const MAX_RESIZE: Size = { width: 400, height: 400 };
export const RESIZE_GRID = 8;

/** Why a size cannot be a resize step, or null: whole multiples of 8 CSS px, positive, at most MAX_RESIZE. */
export function resizeSizeProblem(s: Size): string | null {
  for (const [axis, v, max] of [['width', s.width, MAX_RESIZE.width], ['height', s.height, MAX_RESIZE.height]] as const) {
    if (!Number.isInteger(v) || v <= 0 || v % RESIZE_GRID !== 0) return `${axis} ${v} is not a positive multiple of ${RESIZE_GRID} css px`;
    if (v > max) return `${axis} ${v} is over ${max} css px, which not every portrait stage holds`;
  }
  return null;
}
