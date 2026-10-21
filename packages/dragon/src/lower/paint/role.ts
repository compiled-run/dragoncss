// Accessibility roles of Dragon-drawn text (P6b, notes/T046-paint-spec.md §5.6): an h1 to h6 element is a heading of its level in
// Chrome's accessibility tree (HTML-AAM: role heading, aria-level the tag's number), as is any element whose role is heading, and
// role and aria-level override the tag (headingOf); every line of text under a heading is read as a heading. Native marks those lines: iOS gives their accessibility elements the header trait, Android their virtual nodes
// AccessibilityNodeInfo.setHeading. The write is on the heading's box; the text views find it through their DOM ancestors.
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type HeadingWrite = { readonly kind: 'heading'; readonly level: number };

/**
 * The roles an h1 to h6 may take in place of heading: Chrome exposes the element in that role and its text as plain lines, as
 * a11y-lines.test.ts proves for each. Any other role on h1 to h6 is refused (headingOf): one whose text Chrome may expose otherwise
 * (button, img), one Chrome drops back to the heading (region without a name), and none and presentation, which Chrome drops only
 * without global ARIA attributes.
 */
export const PLAIN_TEXT_ROLES: ReadonlySet<string> = new Set(['note', 'group', 'generic', 'paragraph', 'article']);

/** The levels aria-level may give a heading: those a11y-lines.test.ts proves; Chrome reads any other value its own way. */
const ARIA_LEVEL = /^[1-6]$/;

/**
 * An element's heading in Chrome's accessibility tree, from its tag and its role and aria-level attributes (attr gives an
 * attribute's value, undefined when absent and null when it is bound at run time): the first token of role, if any, is the role
 * (heading, or a role of PLAIN_TEXT_ROLES); else h1 to h6 are headings of the tag's number. A heading's aria-level, if any, is its
 * level, else the tag's number, and 2 for another element (WAI-ARIA 1.2 heading: aria-level defaults to 2). The level, 0 for none,
 * or why Dragon refuses the element (a role or aria-level it cannot prove, or bound at run time).
 */
export function headingOf(tag: string, attr: (name: string) => string | null | undefined): { readonly level: number } | { readonly refusal: string } {
  const tagLevel = /^h([1-6])$/.exec(tag);
  const role = attr('role');
  if (role === null) return { refusal: 'a role bound at run time can make or unmake a heading, which native cannot follow' };
  const first = role === undefined ? undefined : (role.trim().toLowerCase().split(/\s+/)[0] ?? '');
  let heading: boolean;
  if (first === undefined || first === '') heading = tagLevel !== null;
  else if (first === 'heading') heading = true;
  else if (PLAIN_TEXT_ROLES.has(first)) heading = false;
  else if (tagLevel !== null || /(^|\s)heading(\s|$)/i.test(role ?? '')) return { refusal: `role "${role}" on <${tag}> is not proven against Chrome's accessibility tree (a heading takes heading or one of ${[...PLAIN_TEXT_ROLES].join(', ')})` };
  else heading = false;
  if (!heading) return { level: 0 };
  const level = attr('aria-level');
  if (level === null) return { refusal: `aria-level bound at run time on the heading <${tag}>` };
  if (level !== undefined) {
    if (!ARIA_LEVEL.test(level.trim())) return { refusal: `aria-level "${level}" on the heading <${tag}> is not a level 1 to 6` };
    return { level: Number(level.trim()) };
  }
  return { level: tagLevel === null ? 2 : Number(tagLevel[1]) };
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
    const h = headingOf(el.element.tag, (name) => el.element.attributes.get(name));
    // project.ts refuses the compile first (DRAGON_UNSUPPORTED_ATTRIBUTE), so a refusal never reaches here.
    if ('refusal' in h) throw new ProgramError(`${el.element.address}: ${h.refusal}`);
    return h.level === 0 ? [] : [{ kind: 'heading', level: h.level }];
  },
};
