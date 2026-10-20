// unicode-bidi (css-writing-modes-4 §2.2): normal | embed | isolate | bidi-override | isolate-override | plaintext, initial normal,
// not inherited, one keyword computed as specified (Chrome 145 css_properties.json5 keyword field; the grammar is webref's, which
// lists exactly Chrome 145's keywords). Chrome's UA sheet gives the block-level HTML elements (div, p, the headings, ...) isolate.
// The web output keeps every value. Native reorders no text by it: analysis/bidi.ts accepts a value where Chrome's UAX #9 run
// order is the same as with normal and refuses the rest on iOS and Android, so the layout lowering never reads it.
import type { PropertyAspect } from '../properties.ts';

export const BIDI_LONGHANDS = ['unicode-bidi'] as const;
export const BIDI_SHORTHANDS = [] as const;
export const BIDI_INHERITED: readonly (typeof BIDI_LONGHANDS)[number][] = [];
export const BIDI_CONTAINER: readonly (typeof BIDI_LONGHANDS)[number][] = [];
export const BIDI_TEXT_ROLE: readonly (typeof BIDI_LONGHANDS)[number][] = [];

// It orders the text of inline content, so where native accepts it, the layout lanes prove it changes no box.
export const BIDI_ASPECTS: { readonly [P in (typeof BIDI_LONGHANDS)[number]]: PropertyAspect } = {
  'unicode-bidi': { layout: true, paint: false },
};
