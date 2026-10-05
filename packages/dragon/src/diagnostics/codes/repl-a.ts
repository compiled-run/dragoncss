// REPL-a: replaced elements (img and iframe).
import { diagnosticFeature, error, manual } from '../entry.ts';

export const REPL_A = diagnosticFeature(
  [
    'DRAGON_REMOTE_IMAGE',
    'DRAGON_UNSUPPORTED_IMAGE',
  ],
  {
    DRAGON_REMOTE_IMAGE: error('This image source is not known at build time.', 'Dragon sizes and draws images from bytes the build reads (a data: URL, or a src the images option maps to a snapshot asset); a remote or unmapped src could change or fail to load, so the output would not be reproducible.', manual('Map or embed the image', 'Map the src to a snapshot asset with the images option, or use a data: URL.')),
    DRAGON_UNSUPPORTED_IMAGE: error('This image is not supported.', 'Dragon draws only images whose pixels decode identically in Chrome and on every target; other formats and colour encodings belong to follow-up packages.', manual('Use an 8-bit sRGB PNG', 'Convert the image to an 8-bit PNG that is untagged or tagged sRGB.')),
  },
);
