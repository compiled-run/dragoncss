// FORM-c: the single-line text field of Chrome 145 (text, email, url, tel, password). Its UA shadow tree is the placeholder div,
// present while the value is empty and the placeholder is not, then the inner editor div, which holds the value's text. Neither
// is reachable from script; Chrome 145's computed values for both are read through CDP (packages/parity/src/capture.ts).
// - The placeholder takes html.css's ::-webkit-input-placeholder and input::-webkit-input-placeholder rules, and the
//   display: block !important that text_field_input_type.cc:566-608 UpdatePlaceholderText writes in its style attribute.
// - The inner editor's style is built in C++, inheriting from the input (text_control_inner_elements.cc:131-216
//   TextControlInnerEditorElement::CustomStyleForLayoutObject), after the div rule of html.css: its declarations are written here as
//   rules. Its line height is decided in layout (packages/layout/src/controls.ts), which reads the input's font metrics.

/** A UA rule of a shadow part, as RANGE_UA_SHADOW holds them: [property, value, important] in cascade order. */
export type ShadowRule = { readonly selectors: readonly string[]; readonly declarations: readonly (readonly [string, string, boolean])[] };

export const TEXT_FIELD_UA_SHADOW: { readonly placeholder: readonly ShadowRule[]; readonly editor: readonly ShadowRule[] } = {
  placeholder: [
    { selectors: ['div'], declarations: [['display', 'block', false]] },
    { selectors: ['div'], declarations: [['unicode-bidi', 'isolate', false]] },
    // html.css: color: darkGray, which Chrome 145 computes to rgb(117, 117, 117) (GrayText on the reference platform).
    { selectors: ['::-webkit-input-placeholder'], declarations: [['-webkit-text-security', 'none', false], ['color', 'rgb(117, 117, 117)', false], ['direction', 'inherit', true], ['pointer-events', 'none', true], ['text-orientation', 'inherit', true], ['writing-mode', 'inherit', true]] },
    {
      selectors: ['input::-webkit-input-placeholder'],
      declarations: [
        ['text-overflow', 'inherit', false],
        ['white-space-collapse', 'preserve', false],
        ['text-wrap-mode', 'nowrap', false],
        ['overflow-wrap', 'normal', false],
        ['overflow-x', 'hidden', false],
        ['overflow-y', 'hidden', false],
        ['line-height', 'normal', true],
        ['-webkit-user-modify', 'read-only', true],
      ],
    },
    { selectors: ['[style]'], declarations: [['display', 'block', true]] },
  ],
  editor: [
    { selectors: ['div'], declarations: [['display', 'block', false]] },
    {
      selectors: ['(CustomStyleForLayoutObject)'],
      declarations: [
        ['unicode-bidi', 'inherit', true],
        ['user-select', 'text', true],
        ['-webkit-user-modify', 'read-write-plaintext-only', true],
        ['display', 'block', true],
        ['white-space-collapse', 'preserve', true],
        ['text-wrap-mode', 'nowrap', true],
        ['overflow-wrap', 'normal', true],
        ['text-overflow', 'inherit', true],
        // Chrome scrolls the editor (scroll offset 0 until the user edits), with no scrollbar.
        ['overflow-x', 'scroll', true],
        ['overflow-y', 'scroll', true],
        ['scrollbar-width', 'none', true],
      ],
    },
  ],
};

const stripLineBreaks = (s: string): string => s.replace(/[\n\r]/g, '');
const stripAsciiWhitespace = (s: string): string => s.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');

/**
 * HTML §4.10.5.1: the value sanitization algorithm of a text field's state: text, tel and password strip line breaks; url and
 * email (single-valued) also strip leading and trailing ASCII white space. No value attribute is the empty string.
 */
export function sanitizedTextValue(state: string, value: string | undefined): string {
  const v = stripLineBreaks(value ?? '');
  return state === 'url' || state === 'email' ? stripAsciiWhitespace(v) : v;
}

/** HTML §4.10.5.3.10: the placeholder text the field shows (line breaks stripped), or null while it shows none (a non-empty value). */
export function shownPlaceholder(value: string, placeholder: string | undefined): string | null {
  if (value !== '' || placeholder === undefined) return null;
  const text = stripLineBreaks(placeholder);
  return text === '' ? null : text;
}
