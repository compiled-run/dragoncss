// The natural size is a build-time constant read from the header (R4): PNG IHDR; JPEG SOFn with the EXIF orientation applied
// (image-orientation: from-image) and Blink's EXIF density correction. Native code never measures an image.
import { NO_IMAGE_FAULTS } from './faults.ts';
import type { ImageFaults } from './faults.ts';
import type { ExifFacts, JpegFacts } from './jpeg.ts';
import type { PngFacts } from './png.ts';

export type NaturalSize = { readonly width: number; readonly height: number };

export type ImageHeader = { readonly format: 'png'; readonly facts: PngFacts } | { readonly format: 'jpeg'; readonly facts: JpegFacts };

const INCH = 2;
const DEFAULT_DPI = 72;

/** round(physical * 72 / (num / den)) === stated, in exact integers; rounding halves up, as Chrome does for these positive values. */
const roundsTo = (physical: number, [num, den]: readonly [number, number], stated: number): boolean =>
  (2 * stated - 1) * num <= 2 * physical * DEFAULT_DPI * den && 2 * physical * DEFAULT_DPI * den < (2 * stated + 1) * num;

/**
 * The density-corrected natural size (HTML §4.8.4.3.6): with ResolutionUnit inch, a non-empty resolution and the Exif pixel
 * dimensions, the pixel dimensions are the size when the physical size scaled by 72 / resolution rounds to them. Dragon works
 * in exact rationals; images.test.ts pins the rules measured in Chrome (which applies them in image_decoder.cc).
 */
export function densityCorrectedSize(physical: NaturalSize, exif: ExifFacts | null): NaturalSize {
  if (exif === null || exif.resolutionUnit !== INCH || exif.resolution === null || exif.pixelSize === null) return physical;
  const { x, y } = exif.resolution;
  if (x[0] === 0 || y[0] === 0 || x[1] === 0 || y[1] === 0) return physical;
  if (exif.pixelSize.width === 0 || exif.pixelSize.height === 0) return physical;
  if (roundsTo(physical.width, x, exif.pixelSize.width) && roundsTo(physical.height, y, exif.pixelSize.height)) return exif.pixelSize;
  return physical;
}

/** EXIF orientations 5-8 transpose the image. */
export const transposes = (orientation: number | null): boolean => orientation !== null && orientation >= 5;

/** The natural size in CSS px. */
export function naturalSize(header: ImageHeader, faults: ImageFaults = NO_IMAGE_FAULTS): NaturalSize {
  if (header.format === 'png') {
    const { width, height } = header.facts;
    return faults.ihdrSwap ? { width: height, height: width } : { width, height };
  }
  const f = header.facts;
  const physical = { width: f.width, height: f.height };
  const sized = faults.densityIgnored ? physical : densityCorrectedSize(physical, f.exif);
  return !faults.exifIgnored && transposes(f.exif?.orientation ?? null) ? { width: sized.height, height: sized.width } : sized;
}
