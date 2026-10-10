// The element table: the HTML tags the compiler resolves, each with captured Chrome UA defaults (ua/chrome-145.*.generated.ts).
// Every other tag is refused by the projection. pre is refused: white-space: pre is not supported.
import type { CapturedTag, UaKey } from '../ua/datasets.ts';
import { REPLACED_TAGS, REPLACED_UA_KEYS } from './elements/replaced.ts';

export const SUPPORTED_TAGS: ReadonlySet<string> = new Set([
  'html', 'body', 'div',
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'address', 'hr', 'dl', 'dt', 'dd',
  'span', 'a', 'label',
  'br',
  ...REPLACED_TAGS,
]);

/**
 * Tags whose Chrome 145 UA rules set no longhand Dragon models (the elementKey and phrasingKey tables: span, a without href,
 * label, whose only rule is cursor: default, and br, which has none). They take dragon-unstyled's captured defaults;
 * test/blockify.test.ts pins the tables.
 */
export const UNSTYLED_TAGS: ReadonlySet<string> = new Set(['span', 'a', 'label', 'br']);

/**
 * The tags of the elements resolve.ts builds for ::before and ::after boxes (GEN-a, notes/T151-gen-spec.md R2). html.css has no
 * ::before or ::after rule outside q (unsupported), so they take dragon-unstyled's defaults, as span does.
 */
export const GENERATED_TAGS: ReadonlySet<string> = new Set(['::before', '::after']);

/** The UA dataset row an element's tag reads. */
export function uaTagOf(tag: string): UaKey {
  if (Object.hasOwn(REPLACED_UA_KEYS, tag)) return REPLACED_UA_KEYS[tag] as UaKey;
  if (GENERATED_TAGS.has(tag)) return 'dragon-unstyled';
  return (UNSTYLED_TAGS.has(tag) ? 'dragon-unstyled' : tag) as CapturedTag;
}
