// css-variables-1 §3: var() references in a declaration's source text. A value is split into literal text and var() parts; a
// part's fallback is split the same way. Parsing is token-aware: var( inside a string, a comment or an unquoted url() is text.
import { asciiLower, decodeName, escapeEnd } from './escapes.ts';
import type { Longhand } from './properties.ts';

/** One part of a value: literal source text, or a var() reference with its fallback (null when it has no comma). */
export type VarPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'var'; readonly name: string; readonly fallback: readonly VarPart[] | null };

/** A custom property declaration's specified value (css-variables-1 §2): a CSS-wide keyword, or its parts. */
export type CustomValue = { readonly name: string; readonly wide: string | null; readonly parts: readonly VarPart[] };

/**
 * A declaration of a longhand or shorthand whose value holds var(): every longhand it sets waits for substitution (§3.1).
 * sides: set on a flow-relative property, the physical longhands it maps to in each direction (css-logical-1 §3); the cascade
 * narrows longhands to one side (analysis/logical.ts), and direction names the side a narrowed declaration keeps.
 */
export type PendingSubstitution = {
  readonly parts: readonly VarPart[];
  readonly longhands: readonly Longhand[];
  readonly sides?: { readonly ltr: readonly Longhand[]; readonly rtl: readonly Longhand[] };
  readonly direction?: 'ltr' | 'rtl';
};

const WS = /[ \t\n\r\f]/;
const NEWLINE = /[\n\r\f]/;
// css-syntax-3 §4.2: a non-printable code point; one makes an unquoted url( a bad url.
const NON_PRINTABLE = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/;
const isNameChar = (c: string): boolean => /[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80;

/** Whether the value holds a var() reference at any depth. */
export function hasVar(parts: readonly VarPart[]): boolean {
  return parts.some((p) => p.kind === 'var');
}

/** css-syntax-3 §4.3: the end of a comment starting at i ("/*"), or of the whole text when it is unterminated. */
function commentEnd(text: string, i: number): number {
  const end = text.indexOf('*/', i + 2);
  return end < 0 ? text.length : end + 2;
}

/** The end of a string starting at i (its quote), after its closing quote or at an unescaped newline (a bad string) or the end. */
function stringEnd(text: string, i: number): { end: number; bad: boolean } {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '\\') j = escapeEnd(text, j);
    else if (c === quote) return { end: j + 1, bad: false };
    else if (NEWLINE.test(c)) return { end: j, bad: true };
    else j++;
  }
  return { end: text.length, bad: false };
}

/** The end of a run of name code points and escapes starting at i. */
function nameEnd(text: string, i: number): number {
  let j = i;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '\\' && j + 1 < text.length && !NEWLINE.test(text[j + 1] as string)) j = escapeEnd(text, j);
    else if (isNameChar(c)) j++;
    else break;
  }
  return j;
}

/**
 * css-syntax-3 §4.3.6: the end of an unquoted url( whose contents start at i, and whether it is a bad url: a quote, "(", inner white
 * space, a non-printable code point, or a backslash before a newline.
 */
function urlEnd(text: string, i: number): { end: number; bad: boolean } {
  let bad = false;
  let blank = false;
  let j = i;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === ')') return { end: j + 1, bad };
    if (c === '\\') {
      bad ||= blank || NEWLINE.test(text[j + 1] ?? '');
      j = escapeEnd(text, j);
      continue;
    }
    if (WS.test(c)) blank = true;
    else if (blank || c === '"' || c === "'" || c === '(' || NON_PRINTABLE.test(c)) bad = true;
    j++;
  }
  return { end: text.length, bad };
}

/** css-syntax-3 §4.3.9: whether a name run is an identifier (so a following "(" makes it a function token). */
function isIdent(name: string): boolean {
  const a = name[0] ?? '';
  const b = name[1] ?? '';
  if (a === '-') return b === '-' || (b !== '' && !/[0-9]/.test(b));
  return a !== '' && !/[0-9]/.test(a);
}

/** Skips white space and comments from i. */
function skipBlank(text: string, i: number): number {
  let j = i;
  while (j < text.length) {
    if (WS.test(text[j] as string)) j++;
    else if (text.startsWith('/*', j)) j = commentEnd(text, j);
    else break;
  }
  return j;
}

/** Dragon's limit on bracket nesting in a value holding var() or in a custom property; parsing and substitution recurse per level. */
export const MAX_NESTING = 256;

/** The deepest nesting of "(", "[" and "{" in a value, outside strings, comments and escapes. */
export function nestingDepth(text: string): number {
  let depth = 0;
  let max = 0;
  let j = 0;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '"' || c === "'") j = stringEnd(text, j).end;
    else if (text.startsWith('/*', j)) j = commentEnd(text, j);
    else if (c === '\\') j = escapeEnd(text, j);
    else {
      if (c === '(' || c === '[' || c === '{') max = Math.max(max, ++depth);
      else if (c === ')' || c === ']' || c === '}') depth--;
      j++;
    }
  }
  return max;
}

/** The index of the ")" closing the block opened just before i, or -1 when it is unbalanced. */
function blockEnd(text: string, i: number): number {
  const stack: string[] = [')'];
  let j = i;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '"' || c === "'") j = stringEnd(text, j).end;
    else if (text.startsWith('/*', j)) j = commentEnd(text, j);
    else if (c === '\\') j = escapeEnd(text, j);
    else if (c === '(' || c === '[' || c === '{') {
      stack.push(c === '(' ? ')' : c === '[' ? ']' : '}');
      j++;
    } else if (c === ')' || c === ']' || c === '}') {
      if (stack[stack.length - 1] !== c) return -1;
      stack.pop();
      if (stack.length === 0) return j;
      j++;
    } else j++;
  }
  return -1;
}

/**
 * Splits a value into text and var() parts, or returns null when a var() is malformed (css-variables-1 §3: var( <custom-property-name>
 * [ , <declaration-value>? ]? ) ) or the value is not a <declaration-value> (an unmatched ")", "]" or "}", a bad string or a bad url()), which
 * makes the declaration invalid at parse time.
 */
export function parseVarParts(text: string): VarPart[] | null {
  const parts: VarPart[] = [];
  const open: string[] = [];
  let literal = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '(' || c === '[' || c === '{') open.push(c === '(' ? ')' : c === '[' ? ']' : '}');
    else if ((c === ')' || c === ']' || c === '}') && open.pop() !== c) return null;
    // css-syntax-3 §4.3.1: "#" or "@" and a name is one hash or at-keyword token, so a "var(" right after it is not a function.
    if ((c === '#' || c === '@') && i + 1 < text.length) {
      const e = nameEnd(text, i + 1);
      literal += text.slice(i, e);
      i = e;
      continue;
    }
    if (c === '"' || c === "'") {
      const { end: e, bad } = stringEnd(text, i);
      if (bad) return null;
      literal += text.slice(i, e);
      i = e;
      continue;
    }
    if (text.startsWith('/*', i)) {
      const e = commentEnd(text, i);
      literal += text.slice(i, e);
      i = e;
      continue;
    }
    if (isNameChar(c) || c === '\\') {
      const e = nameEnd(text, i);
      if (e === i) {
        literal += c;
        i++;
        continue;
      }
      const name = text.slice(i, e);
      const fn = text[e] === '(' && isIdent(name) ? asciiLower(decodeName(name)) : null;
      if (fn === 'var') {
        const close = blockEnd(text, e + 1);
        if (close < 0) return null;
        const ref = parseReference(text.slice(e + 1, close));
        if (ref === null) return null;
        if (literal !== '') parts.push({ kind: 'text', text: literal });
        literal = '';
        parts.push(ref);
        i = close + 1;
        continue;
      }
      if (fn === 'url') {
        // css-syntax-3 §4.3.6: an unquoted url( is one token; its contents are never a function.
        const inner = skipBlank(text, e + 1);
        if (text[inner] !== '"' && text[inner] !== "'") {
          const { end, bad } = urlEnd(text, inner);
          if (bad) return null;
          literal += text.slice(i, end);
          i = end;
          continue;
        }
      }
      literal += name;
      i = e;
      continue;
    }
    literal += c;
    i++;
  }
  if (literal !== '') parts.push({ kind: 'text', text: literal });
  return parts;
}

/** The inside of var( ... ): a custom property name, then nothing or a comma and a fallback. */
function parseReference(inner: string): VarPart | null {
  const start = skipBlank(inner, 0);
  const end = nameEnd(inner, start);
  const written = inner.slice(start, end);
  // css-syntax-3 §4.3.7: the reference names the identifier's value, so var(--\61) reads --a.
  const name = decodeName(written);
  if (!isIdent(written)) return null;
  // "--" alone is reserved (css-variables-1 §2); Chrome 145 drops a declaration that references it.
  if (!name.startsWith('--') || name === '--') return null;
  const after = skipBlank(inner, end);
  if (after === inner.length) return { kind: 'var', name, fallback: null };
  if (inner[after] !== ',') return null;
  const fallback = parseVarParts(inner.slice(after + 1));
  return fallback === null ? null : { kind: 'var', name, fallback };
}
