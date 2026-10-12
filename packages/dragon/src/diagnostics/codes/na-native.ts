// NA-NATIVE: a property on the not-applicable list (profiles/not-applicable-native.ts), left out of the native outputs.
import { diagnosticFeature, manual } from '../entry.ts';

export const NA_NATIVE = diagnosticFeature(
  [
    'DRAGON_NOT_APPLICABLE_NATIVE',
  ],
  {
    DRAGON_NOT_APPLICABLE_NATIVE: { severity: 'info', message: 'This has no effect on iOS and Android, so the native output leaves it out.', why: 'It only has meaning in a desktop browser (a mouse pointer), so a touch-native user never observes it; it is on Dragon\'s reviewed not-applicable list (profiles/not-applicable-native.ts). The web target still refuses it until a Chrome proof exists.', computedWhy: null, fix: manual('No change needed', 'Dragon emits nothing for it on iOS and Android. Keep it if a web target needs it.') },
  },
);
