// S5: missing sources and assets.
import { diagnosticFeature, error, manual } from '../entry.ts';

export const S5 = diagnosticFeature(
  [
    'DRAGON_MISSING_ASSET',
  ],
  {
    DRAGON_MISSING_ASSET: error('A referenced source or asset is missing from the snapshot or does not match its hash.', 'Every source, stylesheet and asset the input refers to must be in the snapshot with bytes matching its hash; a missing or changed file would change the output without a trace.', manual('Supply the referenced file', 'Add the source or asset to the snapshot with its sha256 hash, or remove the reference.')),
  },
);
