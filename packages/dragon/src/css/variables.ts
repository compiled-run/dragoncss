// css-variables-1 §3: var() references in a declaration's source text. A value is split into literal text and var() parts; a
// part's fallback is split the same way. Parsing is token-aware: var( inside a string, a comment or an unquoted url() is text.
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

/** The end of a string starting at i (its quote), after its closing quote or at an unescaped newline or the end. */
function stringEnd(text: string, i: number): number {
  const quote = text[i];
  let j = i + 1;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '\\') j += 2;
    else if (c === quote) return j + 1;
    else if (c === '\n') return j;
    else j++;
  }
  return text.length;
}

/** The end of a run of name code points and escapes starting at i. */
function nameEnd(text: string, i: number): number {
  let j = i;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '\\' && j + 1 < text.length && text[j + 1] !== '\n') j += 2;
    else if (isNameChar(c)) j++;
    else break;
  }
  return j;
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

/** The index of the ")" closing the block opened just before i, or -1 when it is unbalanced. */
function blockEnd(text: string, i: number): number {
  const stack: string[] = [')'];
  let j = i;
  while (j < text.length) {
    const c = text[j] as string;
    if (c === '"' || c === "'") j = stringEnd(text, j);
    else if (text.startsWith('/*', j)) j = commentEnd(text, j);
    else if (c === '\\') j += 2;
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
 * [ , <declaration-value>? ]? ) ), which makes the declaration invalid at parse time.
 */
export function parseVarParts(text: string): VarPart[] | null {
  const parts: VarPart[] = [];
  let literal = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"' || c === "'") {
      const e = stringEnd(text, i);
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
      if (text[e] === '(' && isIdent(name) && name.toLowerCase() === 'var') {
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
      if (text[e] === '(' && isIdent(name) && name.toLowerCase() === 'url') {
        // css-syntax-3 §4.3.6: an unquoted url( is one token; its contents are never a function.
        const inner = skipBlank(text, e + 1);
        if (text[inner] !== '"' && text[inner] !== "'") {
          const close = text.indexOf(')', inner);
          const end = close < 0 ? text.length : close + 1;
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
  const name = inner.slice(start, end);
  if (!name.startsWith('--')) return null;
  const after = skipBlank(inner, end);
  if (after === inner.length) return { kind: 'var', name, fallback: null };
  if (inner[after] !== ',') return null;
  const fallback = parseVarParts(inner.slice(after + 1));
  return fallback === null ? null : { kind: 'var', name, fallback };
}

/** Whether a custom property name holds an escape; Dragon compares names as written, so an escaped name is refused. */
export const hasEscape = (name: string): boolean => name.includes('\\');

/** Every custom property name the parts reference, at any depth (for escape refusal). */
export function referencedNames(parts: readonly VarPart[]): string[] {
  return parts.flatMap((p) => (p.kind === 'var' ? [p.name, ...referencedNames(p.fallback ?? [])] : []));
}
