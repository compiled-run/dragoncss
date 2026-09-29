// CSS escapes as Chrome 145 reads them: css-syntax-3 §4.3.7 decoding of identifier, function, unit and hash names, and the CSSOM
// serialization Dragon writes them back in. css-tree keeps names as written, so canonicalizeEscapes rewrites a parsed tree once,
// before any keyword or grammar matching, to the serialization of each name's decoded value.
import { parse } from 'css-tree';
import type { CssNode } from 'css-tree';

const isHex = (c: string | undefined): boolean => c !== undefined && /^[0-9A-Fa-f]$/.test(c);
const isWhite = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** css-syntax-3 §3.3: NUL becomes U+FFFD. Chrome 145 keeps a lone surrogate in the input as it is (probed). */
const preprocess = (cp: number): string => (cp === 0 ? '\uFFFD' : String.fromCodePoint(cp));

/**
 * css-syntax-3 §4.3.7: the value of a name as written (an identifier, function name, unit or hash name): each escape is up to six hex
 * digits and one white space (CRLF counts as one), or the next code point; zero, a surrogate, a value past U+10FFFF and an escape at
 * the end of the input are U+FFFD.
 */
export function decodeName(raw: string): string {
  if (!/[\\\u0000]/.test(raw)) return raw;
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const cp = raw.codePointAt(i) as number;
    if (cp !== 0x5c) {
      out += preprocess(cp);
      i += cp > 0xffff ? 2 : 1;
      continue;
    }
    i++;
    if (i >= raw.length) {
      out += '\uFFFD';
      break;
    }
    let hex = '';
    while (hex.length < 6 && isHex(raw[i])) hex += raw[i++];
    if (hex === '') {
      const next = raw.codePointAt(i) as number;
      out += preprocess(next);
      i += next > 0xffff ? 2 : 1;
      continue;
    }
    if (raw.startsWith('\r\n', i)) i += 2;
    else if (isWhite(raw[i])) i++;
    const v = parseInt(hex, 16);
    out += v === 0 || (v >= 0xd800 && v <= 0xdfff) || v > 0x10ffff ? '\uFFFD' : String.fromCodePoint(v);
  }
  return out;
}

const hexEscape = (cp: number): string => `\\${cp.toString(16)} `;

/** CSSOM "serialize an identifier" (css-cssom-1 §2.1), on the decoded identifier; Chrome serializes custom idents this way. */
export function serializeIdentifier(decoded: string): string {
  const points = Array.from(decoded);
  let out = '';
  points.forEach((c, i) => {
    const cp = c.codePointAt(0) as number;
    if (cp === 0) out += '\uFFFD';
    else if ((cp >= 0x1 && cp <= 0x1f) || cp === 0x7f || (i === 0 && /[0-9]/.test(c)) || (i === 1 && /[0-9]/.test(c) && points[0] === '-')) out += hexEscape(cp);
    else if (i === 0 && c === '-' && points.length === 1) out += '\\-';
    else if (cp >= 0x80 || /[-_0-9A-Za-z]/.test(c)) out += c;
    else out += `\\${c}`;
  });
  return out;
}

/** A hash token's name: "serialize an identifier" without its rules for a leading digit or hyphen, which a hash name may start with. */
function serializeName(decoded: string): string {
  let out = '';
  for (const c of decoded) {
    const cp = c.codePointAt(0) as number;
    if (cp === 0) out += '\uFFFD';
    else if ((cp >= 0x1 && cp <= 0x1f) || cp === 0x7f) out += hexEscape(cp);
    else if (cp >= 0x80 || /[-_0-9A-Za-z]/.test(c)) out += c;
    else out += `\\${c}`;
  }
  return out;
}

/** A dimension's unit: an identifier, with a leading e escaped where the number would read it as an exponent (1\65 3 is not 1e3). */
function serializeUnit(decoded: string): string {
  const s = serializeIdentifier(decoded);
  return /^[eE](?:[0-9]|[+-][0-9])/.test(s) ? `${hexEscape(s.charCodeAt(0))}${s.slice(1)}` : s;
}

/**
 * The input as Chrome 145 tokenizes it, at the same length so every offset holds: css-syntax-3 §3.3 NUL is U+FFFD, and §4.3.7 an
 * escape at the end of the input is U+FFFD, which css-tree does not read, so a trailing backslash outside a string or comment becomes
 * U+FFFD. In a string that escape is dropped, as css-tree does already.
 */
export function preprocessInput(input: string): string {
  const text = input.includes('\u0000') ? input.replace(/\u0000/g, '\uFFFD') : input;
  if (!text.endsWith('\\')) return text;
  let i = 0;
  let comment = false;
  let quote: string | null = null;
  const last = text.length - 1;
  while (i < last) {
    const c = text[i] as string;
    if (comment) {
      if (text.startsWith('*/', i)) {
        comment = false;
        i += 2;
      } else i++;
    } else if (quote !== null) {
      // css-syntax-3 §3.3: CRLF is one newline, so an escaped CRLF is three code units.
      if (c === '\\') i += text.startsWith('\r\n', i + 1) ? 3 : 2;
      else {
        if (c === quote || c === '\n' || c === '\r' || c === '\f') quote = null;
        i++;
      }
    } else if (text.startsWith('/*', i)) {
      comment = true;
      i += 2;
    } else if (c === '"' || c === "'") {
      quote = c;
      i++;
    } else i += c === '\\' ? 2 : 1;
  }
  return i === last && !comment && quote === null ? `${text.slice(0, last)}\uFFFD` : text;
}

const needsCanonical = (raw: string): boolean => /[\\\u0000]/.test(raw);

type Mutable = { [key: string]: unknown };

/** The functional pseudo-classes css-tree parses by name; with an escaped name it keeps their argument as Raw text. */
const PSEUDO_ARGUMENTS: ReadonlySet<string> = new Set(['is', 'where', 'not', 'has', 'matches', 'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type']);

/**
 * Parses the Raw argument of a functional pseudo-class whose name was escaped, as css-tree would have under the decoded name, at the
 * argument's own offsets. An argument css-tree cannot parse (an escaped An+B, for example) stays Raw, which the selector parser refuses.
 */
function reparseArgument(n: Mutable, name: string): void {
  const args = n['children'] as { toArray(): CssNode[] } | null;
  const raw = args?.toArray();
  const only = raw?.[0];
  if (raw === undefined || raw.length !== 1 || only === undefined || only.type !== 'Raw' || !PSEUDO_ARGUMENTS.has(name.toLowerCase())) return;
  const start = only.loc?.start.offset;
  if (start === undefined) return;
  const prefix = `:${name}(`;
  let failed = false;
  try {
    const parsed = parse(`${prefix}${String(only['value'])})`, { context: 'selector', positions: true, offset: start - prefix.length, onParseError: () => { failed = true; } });
    const pseudo = (parsed['children'] as { toArray(): CssNode[] }).toArray()[0];
    if (!failed && pseudo?.type === 'PseudoClassSelector') n['children'] = pseudo['children'];
  } catch {
    // css-tree throws on some arguments even with an error handler; the argument stays Raw.
  }
}

function rewrite(node: Mutable, key: string, serialize: (decoded: string) => string): void {
  const raw = node[key];
  if (typeof raw === 'string' && needsCanonical(raw)) node[key] = serialize(decodeName(raw));
}

/**
 * Rewrites every identifier, function name, unit, hash name, selector name and attribute flag of a css-tree tree to the serialization
 * of its decoded value, so \62 lock is block and c\61lc( is calc(, while a name that needs escapes keeps them (\31 x). Strings and
 * urls are decoded by css-tree already; Raw text (custom property values) is left as written. Declaration properties are decoded by
 * the parse driver, since a custom property name is kept decoded.
 */
export function canonicalizeEscapes(root: CssNode): void {
  // An explicit stack: a deeply nested tree must not overflow the call stack here if css-tree parsed it.
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    const n = value as Mutable & { toArray?: () => unknown[] };
    if (typeof n.toArray === 'function') {
      for (const c of n.toArray()) stack.push(c);
      continue;
    }
    switch (n['type']) {
      case 'PseudoClassSelector':
        if (typeof n['name'] === 'string' && needsCanonical(n['name'])) {
          rewrite(n, 'name', serializeIdentifier);
          reparseArgument(n, n['name'] as string);
        }
        break;
      case 'Identifier':
      case 'Function':
      case 'ClassSelector':
      case 'IdSelector':
      case 'PseudoElementSelector':
      case 'Atrule':
        rewrite(n, 'name', serializeIdentifier);
        break;
      case 'TypeSelector':
        // A namespace prefix and the universal selector are not identifiers; namespaced selectors are refused.
        if (typeof n['name'] === 'string' && n['name'] !== '*' && !n['name'].includes('|')) rewrite(n, 'name', serializeIdentifier);
        break;
      case 'Dimension':
        rewrite(n, 'unit', serializeUnit);
        break;
      case 'Hash':
        rewrite(n, 'value', serializeName);
        break;
      case 'AttributeSelector':
        rewrite(n, 'flags', serializeIdentifier);
        break;
    }
    for (const [k, v] of Object.entries(n)) if (k !== 'loc' && v !== null && typeof v === 'object') stack.push(v);
  }
}
