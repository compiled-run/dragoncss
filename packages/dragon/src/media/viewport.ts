// The media size Chrome 145 evaluates for a root of whole device px (notes/T067 R3). These are measurements (M1, M4, M5):
// local_frame_view.cc, which computes them, is LGPL and is only a reference. Every rounding media/ needs to match Chrome's measured
// behaviour (the float media size, device px, the int width and height orientation and aspect-ratio read) lives here and nowhere else.
import type { MediaFaults } from './faults.ts';
import { NO_MEDIA_FAULTS } from './faults.ts';

const checkDpr = (dpr: number): void => {
  if (!Number.isFinite(dpr) || dpr <= 0) throw new Error(`device pixel ratio ${dpr} is not a positive number`);
};

/** One axis of the media size: fround(fround(px) * fround(1 / dpr)) for a root of `px` whole device px (M4). */
export function mediaSize(px: number, dpr: number, faults: MediaFaults = NO_MEDIA_FAULTS): number {
  if (!Number.isInteger(px) || px < 0) throw new Error(`a media root is whole device px, not ${px}`);
  checkDpr(dpr);
  if (faults.mediaWidthDouble) return px / dpr;
  return Math.fround(Math.fround(px) * Math.fround(1 / Math.fround(dpr)));
}

/** The device px of a Chrome emulated main frame (Page.setViewportSize) of `dip` CSS px: rounded up (M5). */
export function emulatedDevicePx(dip: number, dpr: number, faults: MediaFaults = NO_MEDIA_FAULTS): number {
  if (!Number.isFinite(dip) || dip < 0) throw new Error(`an emulated frame of ${dip} CSS px`);
  checkDpr(dpr);
  return faults.emulatedSizeRounded ? Math.round(dip * dpr) : Math.ceil(dip * dpr);
}

/** The device px of an iframe of `css` CSS px: rounded half up (M1). */
export function iframeDevicePx(css: number, dpr: number): number {
  if (!Number.isFinite(css) || css < 0) throw new Error(`an iframe of ${css} CSS px`);
  checkDpr(dpr);
  return Math.floor(css * dpr + 0.5);
}

/** The media viewport of a root of whole device px. */
export function mediaViewport(px: { readonly width: number; readonly height: number }, dpr: number, faults: MediaFaults = NO_MEDIA_FAULTS): { readonly width: number; readonly height: number } {
  return { width: mediaSize(px.width, dpr, faults), height: mediaSize(px.height, dpr, faults) };
}

/** The media viewport Chrome evaluates for an emulated main frame of the given CSS px size. */
export function emulatedMediaViewport(viewport: { readonly width: number; readonly height: number }, dpr: number, faults: MediaFaults = NO_MEDIA_FAULTS): { readonly width: number; readonly height: number } {
  return mediaViewport({ width: emulatedDevicePx(viewport.width, dpr, faults), height: emulatedDevicePx(viewport.height, dpr, faults) }, dpr, faults);
}

/** The int Chrome reads a media size into for orientation and aspect-ratio: truncation toward zero (M3). */
export function wholePx(size: number): number {
  return Math.trunc(size);
}

/** The whole px at or below a media size (floor). */
export function wholeAtOrBelow(size: number): number {
  return Math.floor(size);
}

/** The whole px at or above a media size (ceil). */
export function wholeAtOrAbove(size: number): number {
  return Math.ceil(size);
}

/** Chrome's float of a double (ClampTo<float>): a value past the float range clamps to the largest float. */
export function clampToFloat(x: number): number {
  const MAX = 3.4028234663852886e38;
  return Math.fround(x > MAX ? MAX : x < -MAX ? -MAX : x);
}

/** Two decimals in float, as Chrome compares dpcm with the device's dppx (floorf(0.5 + 100 x) / 100). */
export const twoDecimals = (x: number): number => Math.fround(Math.floor(Math.fround(0.5 + Math.fround(100 * x))) / 100);
