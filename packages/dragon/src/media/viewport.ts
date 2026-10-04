// The media size Chrome 145 evaluates for a root of whole device px (notes/T067 R3). These are measurements (M1, M4, M5):
// local_frame_view.cc, which computes them, is LGPL and is only a reference.
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
