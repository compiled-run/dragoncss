// FORM-b: Chrome 145's single select (a menulist) is a flex row container of one UA shadow element, the inner element, holding the
// shown option's label; options get no box. The inner element's style is built in C++ (menu_list_inner_element.cc:20-102
// MenuListInnerElement::CustomStyleForLayoutObject), written here as rules; with appearance: none its internal margins and
// paddings are 0 (layout_theme_default.cc PopupInternalPadding*, a reference: the captures show it). Its line height is the
// engine's (environment.ts), and its direction, unicode-bidi and text-align the shown option's (select_type.cc:1001-1062).
import type { ShadowRule } from './text-field.ts';

export const SELECT_UA_SHADOW: { readonly inner: readonly ShadowRule[] } = {
  inner: [
    { selectors: ['div'], declarations: [['display', 'block', false]] },
    {
      selectors: ['(CustomStyleForLayoutObject)'],
      declarations: [
        ['display', 'block', true],
        ['flex-grow', '1', true],
        ['flex-shrink', '1', true],
        ['min-width', '0px', true],
        ['overflow-x', 'hidden', true],
        ['overflow-y', 'hidden', true],
        ['text-overflow', 'inherit', true],
        ['-webkit-user-modify', 'read-only', true],
        ['margin-top', 'auto', true],
        ['margin-bottom', 'auto', true],
        ['align-self', 'start', true],
      ],
    },
  ],
};

/**
 * FORM-b S4: a host that renders a select's options as rows of a list (the Markless style export) sets this data attribute on the
 * select. Dragon then sees only the list's template option, so the widths that read the select's widest option stay refused for it.
 */
export const LISTED_OPTIONS_ATTRIBUTE = 'data-dragon-listed-options';

/** An option of a select's list, in tree order: its selected and disabled attributes, its label attribute and its text. */
export type SelectOption = { readonly selected: boolean; readonly disabled: boolean; readonly label: string | undefined; readonly text: string };

/**
 * HTML §4.10.7 selectedness setting algorithm for a select with display size 1 and no multiple: of the options with a selected
 * attribute the last one in tree order, else the first option that is not disabled, else none (Chrome 145: controls-select-none).
 */
export function shownOptionIndex(options: readonly SelectOption[]): number | null {
  for (let i = options.length - 1; i >= 0; i--) if ((options[i] as SelectOption).selected) return i;
  const first = options.findIndex((o) => !o.disabled);
  return first < 0 ? null : first;
}

const ASCII_WHITESPACE = /[\t\n\f\r ]+/g;
const stripAsciiWhitespace = (s: string): string => s.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');

/**
 * The text the closed select shows for an option: HTML §4.10.10 label (a non-empty label attribute, else the text with ASCII
 * whitespace stripped and collapsed), then stripped of leading and trailing white space as select_type.cc:1061 does, which
 * keeps a label attribute's inner spaces (Chrome 145: label="  L   L  " shows "L   L").
 */
export function shownLabel(option: SelectOption): string {
  const label = option.label !== undefined && option.label !== '' ? option.label : stripAsciiWhitespace(option.text.replace(ASCII_WHITESPACE, ' '));
  return stripAsciiWhitespace(label);
}

/**
 * Whether a label lays out differently under the select's white-space: pre than collapsed: only a tab, a line feed or a run of
 * spaces does, since a label is stripped at both ends and the select never wraps (text-wrap-mode: nowrap).
 */
export function labelKeepsWhiteSpace(label: string): boolean {
  return /[\t\n\f\r]| {2}/.test(label);
}

/** HTML §4.10.7 display size: the size attribute parsed as a non-negative integer when it is above zero, else 1 (no multiple). */
export function selectDisplaySize(size: string | undefined): number {
  const m = size === undefined ? null : /^[\t\n\f\r ]*\+?([0-9]+)/.exec(size);
  const n = m === null ? 0 : Number(m[1]);
  return n > 0 && Number.isSafeInteger(n) ? n : 1;
}
