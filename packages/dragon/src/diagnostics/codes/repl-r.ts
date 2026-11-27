// REPL-r1: an img whose src the app sets at run time (notes/IMG-dynamic-src-spec.md).
import { diagnosticFeature, error, manual } from '../entry.ts';

export const REPL_R = diagnosticFeature(
  [
    'DRAGON_RUNTIME_IMAGE_SIZE',
    'DRAGON_RUNTIME_IMAGE_FALLBACK',
  ],
  {
    DRAGON_RUNTIME_IMAGE_SIZE: error('The size of this image would depend on the image the app loads.', 'Dragon lays an img whose src is set at run time out once, without the image, and proves that layout against Chrome for every image; a box whose size follows the image\'s natural size or ratio, an alt text a missing src would show, or a selector that reads the src would make the native layout differ from Chrome\'s.', manual('Size the image with CSS', 'Give the img a width and a height, or one of them and a CSS aspect-ratio; give a flex item a min-width; keep alt text off an img whose src may be missing; and match the img by a class rather than by its src.')),
    DRAGON_RUNTIME_IMAGE_FALLBACK: { severity: 'info', message: 'When this image fails to load, Chrome draws a different box.', why: 'On a load error, an empty src or a src removed at run time, Chrome replaces the img with fallback content (its alt text, or a box with a broken-image icon); the native output keeps the laid-out box and draws the no-image outline instead.', computedWhy: null, fix: manual('No change needed', 'Keep the src valid while the img is shown, or remove the img when there is no image.') },
  },
);
