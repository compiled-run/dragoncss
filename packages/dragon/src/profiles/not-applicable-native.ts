// Owner ruling NA-NATIVE (notes/PM-2026-10-04.md): the reviewed list of CSS with no visible or behavioural effect on touch-native
// iOS and Android. On native the compiler emits nothing for an entry and reports DRAGON_NOT_APPLICABLE_NATIVE (info); the web target
// still refuses it until a Chrome proof exists. Nothing is not-applicable by default: anything off this list is refused as before.
// Reviewed and left off: scrollbar-width and -webkit-appearance (visible on native); will-change (transform makes a containing
// block and stacking context, analysis/paint-values/transform.ts); color-scheme (dark changes the UA colours, ua/datasets.ts);
// ::-webkit-slider-thumb (its appearance decides how a range paints, forms/appearance.ts); ::-moz-range-thumb (Chrome drops it,
// so Dragon already drops the rule on every target).

export type NotApplicableEntry = {
  /** A property name, or a pseudo-element name without its colons. */
  readonly name: string;
  readonly kind: 'property' | 'pseudo-element';
  readonly reason: string;
};

export const NOT_APPLICABLE_NATIVE: readonly NotApplicableEntry[] = [
  { name: 'cursor', kind: 'property', reason: 'it sets the mouse pointer shape, and a touch screen has no pointer' },
  { name: 'scrollbar-color', kind: 'property', reason: 'it colours a desktop scrollbar; native scroll views draw the platform scroll indicator in the system style' },
  { name: '-webkit-scrollbar', kind: 'pseudo-element', reason: 'it styles a desktop scrollbar box; native scroll views draw the platform scroll indicator instead' },
  { name: '-webkit-scrollbar-thumb', kind: 'pseudo-element', reason: 'it styles a desktop scrollbar thumb; native scroll views draw the platform scroll indicator instead' },
  { name: '-webkit-scrollbar-track', kind: 'pseudo-element', reason: 'it styles a desktop scrollbar track; native scroll views draw no track' },
];

/** The list entry for a property or pseudo-element name (ASCII lower case), or null when it is not on the list. */
export function notApplicableEntry(kind: NotApplicableEntry['kind'], name: string): NotApplicableEntry | null {
  return NOT_APPLICABLE_NATIVE.find((e) => e.kind === kind && e.name === name) ?? null;
}
