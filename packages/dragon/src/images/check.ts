// Pairs the header natural size of every captured corpus image with Chrome's naturalWidth/naturalHeight. Used by the
// capture script's --check (where a plant must break a pair) and by the tests.
import { NO_IMAGE_FAULTS } from './faults.ts';
import type { ImageFaults } from './faults.ts';
import { readImageHeader } from './manifest.ts';
import { naturalSize } from './natural-size.ts';
import type { NaturalSize } from './natural-size.ts';

export type NaturalCapture = {
  readonly chrome: string;
  readonly images: readonly {
    readonly file: string;
    readonly type: string;
    readonly sha256: string;
    readonly chrome: { readonly naturalWidth: number; readonly naturalHeight: number; readonly decoded: boolean };
  }[];
};

export type NaturalMismatch = { readonly file: string; readonly dragon: NaturalSize | null; readonly chrome: NaturalSize | null };

/** Every image with a header Dragon reads (PNG and JPEG) must have Chrome's natural size; any other image must not decode in REPL-0. */
export function compareNaturalSizes(
  capture: NaturalCapture,
  bytesOf: (file: string) => Uint8Array,
  faults: ImageFaults = NO_IMAGE_FAULTS,
): { readonly compared: number; readonly mismatches: readonly NaturalMismatch[] } {
  const mismatches: NaturalMismatch[] = [];
  let compared = 0;
  for (const img of capture.images) {
    const header = readImageHeader(bytesOf(img.file), img.type);
    if (header === null) continue;
    compared += 1;
    const chrome = img.chrome.decoded ? { width: img.chrome.naturalWidth, height: img.chrome.naturalHeight } : null;
    const dragon = naturalSize(header, faults);
    if (chrome === null || chrome.width !== dragon.width || chrome.height !== dragon.height) mismatches.push({ file: img.file, dragon, chrome });
  }
  return { compared, mismatches };
}
