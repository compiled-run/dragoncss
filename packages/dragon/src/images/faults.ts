// Planted faults local to the images module; the Chrome comparison must catch each one.

export type ImageFaults = {
  /** The PNG natural size takes the IHDR width as the height and the height as the width. */
  readonly ihdrSwap: boolean;
  /** The JPEG natural size ignores the EXIF orientation (image-orientation: from-image swaps axes for 5-8). */
  readonly exifIgnored: boolean;
  /** The JPEG natural size ignores the EXIF density correction. */
  readonly densityIgnored: boolean;
};

export const NO_IMAGE_FAULTS: ImageFaults = { ihdrSwap: false, exifIgnored: false, densityIgnored: false };

/** The plant names of scripts/capture-image-data.ts --plant, each mapped to its fault. */
export const IMAGE_PLANTS = { 'ihdr-swap': 'ihdrSwap', 'exif-ignored': 'exifIgnored', 'density-ignored': 'densityIgnored' } as const satisfies Record<string, keyof ImageFaults>;
export type ImagePlant = keyof typeof IMAGE_PLANTS;

export function faultsOfPlant(plant: ImagePlant): ImageFaults {
  return { ...NO_IMAGE_FAULTS, [IMAGE_PLANTS[plant]]: true };
}
