// REPL-a: the replaced elements the compiler resolves (CSS 2.2 §10.3.2, HTML §15.4). Each reads its UA defaults from a REPL-0
// replaced key: an img with a src (img[src]), and an iframe, which Dragon renders as a platform web view in a slot it lays out.
import type { CssValue } from '../../css/values.ts';
import type { ReplacedKey } from '../../ua/datasets.ts';

export const REPLACED_TAGS: readonly string[] = ['img', 'iframe'];

/** The UA dataset key of a replaced tag. */
export const REPLACED_UA_KEYS: { readonly [tag: string]: ReplacedKey } = { img: 'img[src]', iframe: 'iframe' };

/** CSS 2.2 §10.3.2 and HTML §15.4.1: the default object size in CSS px, which sizes a replaced box with no natural size or ratio. */
export const DEFAULT_OBJECT_SIZE = { width: 300, height: 150 } as const;

/** Whether a tag is a replaced element. */
export function isReplacedTag(tag: string): boolean {
  return REPLACED_TAGS.includes(tag);
}

/** A parsed HTML dimension value: a length in CSS px or a percentage. */
export type Dimension = { readonly kind: 'length' | 'percentage'; readonly value: number };

const ASCII_WHITESPACE = /^[\t\n\f\r ]*/;

/**
 * HTML §2.3.4.4 rules for parsing dimension values: leading ASCII white space, digits, an optional fraction, then "%" for a
 * percentage; anything after is ignored. null for a value that does not start with a digit.
 */
export function parseDimension(text: string): Dimension | null {
  const m = /^([0-9]+)(\.[0-9]*)?(%?)/.exec(text.replace(ASCII_WHITESPACE, ''));
  if (m === null) return null;
  const value = Number(`${m[1] as string}${m[2] === undefined || m[2] === '.' ? '' : m[2]}`);
  return { kind: m[3] === '%' ? 'percentage' : 'length', value };
}

/** HTML §15.4.5 presentational hints of a replaced element, as CSS values; author rules win over them (css-cascade-5 §6.1). */
export function presentationalHints(tag: string, attributes: ReadonlyMap<string, string>): ReadonlyMap<'width' | 'height' | 'aspect-ratio', CssValue> {
  const out = new Map<'width' | 'height' | 'aspect-ratio', CssValue>();
  if (!isReplacedTag(tag)) return out;
  const parsed = (name: 'width' | 'height'): Dimension | null => {
    const text = attributes.get(name);
    return text === undefined ? null : parseDimension(text);
  };
  const w = parsed('width');
  const h = parsed('height');
  const asValue = (d: Dimension): CssValue => (d.kind === 'length' ? { kind: 'length', value: d.value, unit: 'px' } : { kind: 'percentage', value: d.value });
  if (w !== null) out.set('width', asValue(w));
  if (h !== null) out.set('height', asValue(h));
  // img only (HTML §15.4.5 "map to the aspect-ratio property (using dimension rules)"): auto w / h when both are lengths.
  if (tag === 'img' && w !== null && h !== null && w.kind === 'length' && h.kind === 'length') out.set('aspect-ratio', { kind: 'ratio', auto: true, width: w.value, height: h.value });
  return out;
}
