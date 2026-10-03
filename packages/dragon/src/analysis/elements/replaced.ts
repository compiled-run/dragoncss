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
  // A digit run past the double range is Infinity, which no length holds; dimensionRefusal reports it, so it never reaches a hint.
  if (!Number.isFinite(value)) return null;
  return { kind: m[3] === '%' ? 'percentage' : 'length', value };
}

/**
 * Why a width or height attribute value of a replaced element cannot compile, or null: a value whose digits overflow a double.
 * Dragon has no Chrome proof of how such a value lays out, so it refuses it instead of dropping the hint silently.
 */
export function dimensionRefusal(tag: string, name: string, text: string): string | null {
  if (!isReplacedTag(tag) || (name !== 'width' && name !== 'height')) return null;
  const m = /^([0-9]+)(\.[0-9]*)?/.exec(text.replace(ASCII_WHITESPACE, ''));
  if (m === null || Number.isFinite(Number(`${m[1] as string}${m[2] === undefined || m[2] === '.' ? '' : m[2]}`))) return null;
  return `its value starts with ${(m[1] as string).length} digits, past the range of a length`;
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

// RFC 3986 §3: an absolute https URI. The host is a DNS name (letters, digits, - and _ in dot-separated labels) or an IPv6
// literal in brackets, the only place brackets appear; a port is 0-65535; a % always starts a two-hex-digit escape (Foundation
// and Android read a malformed one differently); a fragment holds no second #.
const PCT = '%[0-9A-Fa-f]{2}';
const UNRESERVED_SUB = "A-Za-z0-9\\-._~!$&'()*+,;=";
const PCHAR = `(?:[${UNRESERVED_SUB}:@]|${PCT})`;
const USERINFO = `(?:[${UNRESERVED_SUB}:]|${PCT})*`;
const HTTPS_URI = new RegExp(`^https://(?:${USERINFO}@)?(?:\\[([0-9A-Fa-f:.]+)\\]|[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*\\.?)(?::([0-9]{1,5}))?(?:/${PCHAR}*)*(?:\\?(?:${PCHAR}|[/?])*)?(?:#(?:${PCHAR}|[/?])*)?$`, 'i');

/** RFC 3986 §3.2.2 IPv6address: eight 16-bit hex groups, or fewer around one ::, the last two optionally a dotted IPv4. */
function isIpv6(text: string): boolean {
  const v4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
  let groups = 8;
  let body = text;
  const tail = body.lastIndexOf(':');
  if (body.includes('.')) {
    if (!v4.test(body.slice(tail + 1))) return false;
    body = `${body.slice(0, tail + 1)}0:0`;
  }
  const halves = body.split('::');
  if (halves.length > 2) return false;
  const parts = (h: string): string[] | null => (h === '' ? [] : h.split(':').every((g) => /^[0-9A-Fa-f]{1,4}$/.test(g)) ? h.split(':') : null);
  const left = parts(halves[0] as string);
  const right = halves.length === 2 ? parts(halves[1] as string) : [];
  if (left === null || right === null) return false;
  const count = left.length + right.length;
  return halves.length === 2 ? count < groups : count === groups;
}

/**
 * An iframe src as the URL its web view loads (HTML strips leading and trailing ASCII white space), or null when it is not an
 * absolute https URI with a valid host and port. Plain http is refused: App Transport Security on iOS and the cleartext default
 * on Android (API 28+) block it in an app build.
 */
export function iframeSrcUrl(text: string): string | null {
  const t = text.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  const m = HTTPS_URI.exec(t);
  if (m === null) return null;
  if (m[1] !== undefined && !isIpv6(m[1])) return null;
  if (m[2] !== undefined && Number(m[2]) > 65535) return null;
  return t;
}

/**
 * Why an iframe src cannot compile, or null (R9: the slot's web view loads src). Native code has no document URL to resolve a
 * relative src against, and a normal app build loads only https documents, so the src must be an absolute https URL.
 */
export function iframeSrcRefusal(tag: string, name: string, text: string): string | null {
  if (tag !== 'iframe' || name !== 'src' || iframeSrcUrl(text) !== null) return null;
  return 'a native web view loads only a well-formed absolute https URL (RFC 3986; it has no document URL to resolve a relative one against, and an app build blocks plain http)';
}
