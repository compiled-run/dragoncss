// BROWSER-ONLY: CSS on the browser-only list (profiles/browser-only-native.ts), a build error on iOS and Android.
import { diagnosticFeature, manual } from '../entry.ts';

export const BROWSER_ONLY = diagnosticFeature(
  [
    'DRAGON_BROWSER_ONLY_NATIVE',
  ],
  {
    DRAGON_BROWSER_ONLY_NATIVE: { severity: 'error', message: 'This only works in a web browser, so it cannot build for iOS or Android.', why: 'It asks for browser behaviour (such as a view transition, which only script or a page navigation starts) that a native app never has. It is on Dragon\'s reviewed browser-only list (profiles/browser-only-native.ts), so Dragon reports it instead of dropping it and painting something else.', computedWhy: null, fix: manual('Remove it from the native build', 'Delete the declaration or at-rule, or move it to a stylesheet that only the web target compiles.') },
  },
);
