// Owner ruling NA-NATIVE (notes/PM-2026-10-04.md): the reviewed list of CSS properties with no visible or behavioural effect on
// touch-native iOS and Android. On native the compiler emits nothing for an entry and reports DRAGON_NOT_APPLICABLE_NATIVE (info);
// the web target still refuses it until a Chrome proof exists. Nothing is not-applicable by default: anything off this list is
// refused as before. text-rendering and scrollbar-color were reviewed and left off (optimizeSpeed turns off kerning and ligatures;
// transparent colours hide the scrollbar), and the owner listed them anyway (decision card, 2026-10-19). Reviewed and left off: break-*, orphans and
// widows (they fragment columns too; with no fragmentation context they are accepted on every target, properties/fragmentation.ts); scrollbar-width (supported: none hides the native scroll indicators, css/properties/scrollbar.ts);
// -webkit-appearance (a property now, properties/appearance.ts); will-change (transform makes a
// containing block and stacking context, analysis/paint-values/transform.ts); color-scheme (dark changes the UA colours,
// ua/datasets.ts); ::-webkit-slider-thumb (its appearance decides how a range paints, forms/appearance.ts); ::-moz-range-thumb
// (Chrome drops it, so Dragon already drops the rule on every target); ::-webkit-scrollbar* rules (several common forms hide the
// scrollbar, which is visible on native: those compile and hide the native scroll indicators, analysis/webkit-scrollbar.ts).

/** owner: listed by owner ruling although Chrome shows a difference for some values, so its message says so instead of "no effect". */
export type NotApplicableEntry = { readonly name: string; readonly reason: string; readonly owner?: true };

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
  { name: 'text-rendering', reason: 'optimizeSpeed turns kerning and ligatures off in Chrome, but the native text stack keeps them whatever it says', owner: true },
  { name: 'scrollbar-color', reason: 'it colours the browser scrollbar (a transparent colour hides it in Chrome), but native scroll indicators keep the platform colours', owner: true },
];

/** The sentence that says an entry is left out on a native target: "has no effect", or the owner ruling for an owner entry. */
export const notApplicableSentence = (e: NotApplicableEntry, target: string): string => (e.owner === true ? `${e.name} is left out on ${target} by owner ruling: ${e.reason}` : `${e.name} has no effect on ${target}: ${e.reason}`);

/** The list entry for a property name (ASCII lower case), or null when it is not on the list. */
export function notApplicableEntry(property: string): NotApplicableEntry | null {
  return NOT_APPLICABLE_NATIVE.find((e) => e.name === property) ?? null;
}
