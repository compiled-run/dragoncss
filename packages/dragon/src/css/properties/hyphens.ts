// hyphens (css-text-3 §6.1): none | manual | auto, inherited, initial manual. -webkit-hyphens stays
// unknown, as in Chrome 145 (css_properties.json5 lists no alias for hyphens).
// The engine breaks after a soft hyphen and shows the hyphen, which is manual. Chrome hyphenates nothing under auto without a
// content language (its macOS dictionary needs lang, which Dragon refuses, or a content-language pragma, which the parity fixture
// reader refuses: parity test/hyphens-chrome.test.ts), so auto lowers as manual (notes/T149-txt2-spec.md R14).
// none on text that holds a soft hyphen is refused until the engine honours it (TXT2-i).
import type { PropertyAspect } from '../properties.ts';

export const HYPHENS_LONGHANDS = ['hyphens'] as const;
export const HYPHENS_SHORTHANDS = [] as const;
export const HYPHENS_INHERITED: readonly (typeof HYPHENS_LONGHANDS)[number][] = ['hyphens'];
export const HYPHENS_CONTAINER: readonly (typeof HYPHENS_LONGHANDS)[number][] = [];
export const HYPHENS_TEXT_ROLE: readonly (typeof HYPHENS_LONGHANDS)[number][] = ['hyphens'];

export const HYPHENS_ASPECTS: { readonly [P in (typeof HYPHENS_LONGHANDS)[number]]: PropertyAspect } = {
  hyphens: { layout: true, paint: false },
};
