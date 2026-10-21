// TXT2-i: declarations of a property Chrome 145 does not know, which it drops at parse time (css/chrome-dropped.ts).
import { diagnosticFeature, manual } from '../entry.ts';

export const TXT2_I = diagnosticFeature(
  [
    'DRAGON_PROPERTY_DROPPED',
  ],
  {
    DRAGON_PROPERTY_DROPPED: { severity: 'warning', message: 'This declaration is dropped: Chrome does not know its property.', why: 'Chrome drops a declaration whose property it does not know (css-syntax-3 §5.4.6), so it never applies; Dragon drops it too, so every target agrees with Chrome.', computedWhy: null, fix: manual('Remove the dropped declaration', 'Delete the declaration, or write the standard property Chrome knows (for example hyphens for -webkit-hyphens).') },
  },
);
