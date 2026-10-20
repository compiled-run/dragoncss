// Accessibility roles of Dragon-drawn text (P6b, notes/T046-paint-spec.md §5.6): an h1 to h6 element is a heading of its level in
// Chrome's accessibility tree (HTML-AAM: role heading, aria-level the tag's number), and every line of text under it is read as a
// heading. Native marks those lines: iOS gives their accessibility elements the header trait, Android their virtual nodes
// AccessibilityNodeInfo.setHeading. The write is on the heading's box; the text views find it through their DOM ancestors.
import type { PaintLowering } from './types.ts';

export type HeadingWrite = { readonly kind: 'heading'; readonly level: number };

/** The heading level of a tag, or 0. */
export function headingLevel(tag: string): number {
  const m = /^h([1-6])$/.exec(tag);
  return m === null ? 0 : Number(m[1]);
}

export const ROLE_LOWERING: PaintLowering<HeadingWrite> = {
  name: 'role',
  vocabulary: {
    uikit: { heading: { key: 'accessibilityHeading', technique: 'native-property', detail: "every line's UIAccessibilityElement under the box takes the header trait (DragonTextView.dragonSetAccessibleLines)" } },
    'android-views': { heading: { key: 'accessibilityHeading', technique: 'native-property', detail: "every line's virtual AccessibilityNodeInfo under the box is setHeading(true) (DragonTextView's node provider)" } },
  },
  css: { heading: [] },
  lower: ({ el }) => {
    if (el === null) return [];
    const level = headingLevel(el.element.tag);
    return level === 0 ? [] : [{ kind: 'heading', level }];
  },
};
