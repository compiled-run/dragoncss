// Owner ruling NA-NATIVE (notes/PM-2026-10-04.md): the reviewed list of CSS properties with no visible or behavioural effect on
// touch-native iOS and Android. On native the compiler emits nothing for an entry and reports DRAGON_NOT_APPLICABLE_NATIVE (info);
// the web target still refuses it until a Chrome proof exists. Nothing is not-applicable by default: anything off this list is
// refused as before. Reviewed and left off: text-rendering (optimizeSpeed turns off kerning and ligatures); break-*, orphans and
// widows (they fragment columns too); scrollbar-width and -webkit-appearance (visible on native); will-change (transform makes a
// containing block and stacking context, analysis/paint-values/transform.ts); color-scheme (dark changes the UA colours,
// ua/datasets.ts); ::-webkit-slider-thumb (its appearance decides how a range paints, forms/appearance.ts); ::-moz-range-thumb
// (Chrome drops it, so Dragon already drops the rule on every target); scrollbar-color and ::-webkit-scrollbar* rules (several
// common forms hide the scrollbar, which is visible on native; deferred).

export type NotApplicableEntry = { readonly name: string; readonly reason: string };

export const NOT_APPLICABLE_NATIVE: readonly NotApplicableEntry[] = [
  { name: 'cursor', reason: 'it sets the mouse pointer shape, and a touch screen has no pointer' },
  { name: 'scroll-behavior', reason: 'it only animates scrolls that script, fragment links or focus start, and the native output starts none' },
  { name: '-webkit-tap-highlight-color', reason: 'it colours the flash a mobile browser draws over a tapped link, and native views draw no such flash' },
  { name: '-webkit-font-smoothing', reason: 'browsers honour it only on macOS, and iOS and Android text keeps the platform antialiasing' },
  { name: 'text-size-adjust', reason: 'it only limits the text inflation of mobile browsers, and the native output inflates no text' },
  { name: '-webkit-text-size-adjust', reason: 'it only limits the text inflation of mobile browsers, and the native output inflates no text' },
  { name: 'forced-color-adjust', reason: 'it only matters in forced colors mode, which neither iOS nor Android has' },
  { name: '-webkit-user-drag', reason: 'it decides whether a mouse drag of an element starts a drag and drop, and native views start none' },
  { name: 'print-color-adjust', reason: 'it only decides whether printing keeps backgrounds, and the native output is never printed' },
  { name: '-webkit-print-color-adjust', reason: 'it only decides whether printing keeps backgrounds, and the native output is never printed' },
];

/** The list entry for a property name (ASCII lower case), or null when it is not on the list. */
export function notApplicableEntry(property: string): NotApplicableEntry | null {
  return NOT_APPLICABLE_NATIVE.find((e) => e.name === property) ?? null;
}
