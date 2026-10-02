// The element table: the HTML tags the compiler resolves, each with captured Chrome UA defaults (ua/chrome-145.*.generated.ts).
// Every other tag is refused by the projection. pre is refused: white-space: pre is not supported.
import type { CapturedTag } from '../ua/datasets.ts';

export const SUPPORTED_TAGS: ReadonlySet<string> = new Set([
  'html', 'body', 'div',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'address', 'hr', 'dl', 'dt', 'dd',
  'span', 'a', 'label',
  'br',
  'b', 'strong', 'em', 'i',
  // INL2b (T044 R7, T059J-INL2b-1): sub and sup, styled by their UA rules (font-size: smaller, vertical-align: sub and super).
  'sub', 'sup',
]);

/**
 * Tags whose Chrome 145 UA rules set no longhand Dragon models (the elementKey and phrasingKey tables: span, a without href,
 * label, whose only rule is cursor: default, br, which has none, and b, strong, em and i, whose rules set only a text font). They
 * take dragon-unstyled's captured defaults, and their text font row (datasets.ts); test/blockify.test.ts pins the tables.
 */
export const UNSTYLED_TAGS: ReadonlySet<string> = new Set(['span', 'a', 'label', 'br', 'b', 'strong', 'em', 'i']);

/** The UA dataset row an element's tag reads. */
export function uaTagOf(tag: string): CapturedTag {
  return (UNSTYLED_TAGS.has(tag) ? 'dragon-unstyled' : tag) as CapturedTag;
}
