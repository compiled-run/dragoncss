// A CSS Syntax 3 tokenizer for descriptor and font-family values. Blink's descriptor parsers work on tokens, so the fonts module
// ports them over tokens too; unicode-range tokens are produced only when asked for, as Blink's EnableUnicodeRanges does.

export type Token =
  | { readonly type: 'ident'; readonly value: string }
  | { readonly type: 'function'; readonly value: string; readonly args: readonly Token[] }
  | { readonly type: 'string'; readonly value: string }
  | { readonly type: 'url'; readonly value: string }
  | { readonly type: 'bad'; readonly value: string }
  | { readonly type: 'number'; readonly value: number; readonly integer: boolean; readonly repr: string }
  | { readonly type: 'percentage'; readonly value: number; readonly repr: string }
  | { readonly type: 'dimension'; readonly value: number; readonly unit: string; readonly repr: string }
  | { readonly type: 'unicode-range'; readonly start: number; readonly end: number }
  | { readonly type: 'whitespace' }
  | { readonly type: 'comma' }
  | { readonly type: 'delim'; readonly value: string }
  | { readonly type: 'block'; readonly open: string; readonly args: readonly Token[] };

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined): boolean => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isNameStart = (c: string | undefined): boolean => c !== undefined && (/^[a-zA-Z_]$/.test(c) || c.charCodeAt(0) >= 0x80);
const isName = (c: string | undefined): boolean => c !== undefined && (isNameStart(c) || isDigit(c) || c === '-');
const isWs = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** Tokenizes a component value list; nested functions and blocks carry their own token lists. */
export function tokenize(text: string, unicodeRanges = false): Token[] {
  const s = text.replace(/\r\n?|\f/g, '\n').replace(/\u0000/g, '�');
  let i = 0;
  const peek = (k = 0): string | undefined => s[i + k];
  const validEscape = (a: string | undefined, b: string | undefined): boolean => a === '\\' && b !== '\n' && b !== undefined;
  const startsIdent = (a: string | undefined, b: string | undefined, c: string | undefined): boolean => {
    if (a === '-') return isNameStart(b) || b === '-' || validEscape(b, c);
    if (isNameStart(a)) return true;
    return validEscape(a, b);
  };
  const startsNumber = (a: string | undefined, b: string | undefined, c: string | undefined): boolean => {
    if (a === '+' || a === '-') return isDigit(b) || (b === '.' && isDigit(c));
    if (a === '.') return isDigit(b);
    return isDigit(a);
  };
  const consumeEscape = (): string => {
    const c = s[i++];
    if (c === undefined) return '�';
    if (isHex(c)) {
      let hex = c;
      while (hex.length < 6 && isHex(peek())) hex += s[i++];
      if (isWs(peek())) i++;
      const cp = parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
    }
    return c;
  };
  const consumeName = (): string => {
    let out = '';
    for (;;) {
      const c = peek();
      if (isName(c)) {
        out += c;
        i++;
      } else if (validEscape(c, peek(1))) {
        i++;
        out += consumeEscape();
      } else return out;
    }
  };
  const consumeNumber = (): { value: number; integer: boolean; repr: string } => {
    let repr = '';
    let integer = true;
    if (peek() === '+' || peek() === '-') repr += s[i++];
    while (isDigit(peek())) repr += s[i++];
    if (peek() === '.' && isDigit(peek(1))) {
      repr += s[i++];
      integer = false;
      while (isDigit(peek())) repr += s[i++];
    }
    if ((peek() === 'e' || peek() === 'E') && (isDigit(peek(1)) || ((peek(1) === '+' || peek(1) === '-') && isDigit(peek(2))))) {
      repr += s[i++];
      if (peek() === '+' || peek() === '-') repr += s[i++];
      while (isDigit(peek())) repr += s[i++];
      integer = false;
    }
    return { value: Number(repr), integer, repr };
  };
  const consumeString = (quote: string): Token => {
    let out = '';
    for (;;) {
      const c = s[i++];
      if (c === undefined || c === quote) return { type: 'string', value: out };
      if (c === '\n') {
        i--;
        return { type: 'bad', value: out };
      }
      if (c === '\\') {
        if (peek() === undefined) continue;
        if (peek() === '\n') {
          i++;
          continue;
        }
        out += consumeEscape();
      } else out += c;
    }
  };
  const consumeUrl = (): Token => {
    while (isWs(peek())) i++;
    let out = '';
    for (;;) {
      const c = s[i++];
      if (c === undefined || c === ')') return { type: 'url', value: out };
      if (isWs(c)) {
        while (isWs(peek())) i++;
        if (peek() === ')' || peek() === undefined) {
          i++;
          return { type: 'url', value: out };
        }
        return badUrl(out);
      }
      if (c === '"' || c === "'" || c === '(' || c.charCodeAt(0) < 0x09 || c === '\u000b' || (c.charCodeAt(0) >= 0x0e && c.charCodeAt(0) <= 0x1f) || c === '\u007f') return badUrl(out);
      if (c === '\\') {
        if (validEscape(c, peek())) out += consumeEscape();
        else return badUrl(out);
      } else out += c;
    }
  };
  const badUrl = (sofar: string): Token => {
    for (;;) {
      const c = s[i++];
      if (c === undefined || c === ')') return { type: 'bad', value: sofar };
      if (validEscape(c, peek())) consumeEscape();
    }
  };
  const consumeUnicodeRange = (): Token => {
    let first = '';
    while (first.length < 6 && isHex(peek())) first += s[i++];
    let q = 0;
    while (first.length + q < 6 && peek() === '?') {
      q++;
      i++;
    }
    if (q > 0) {
      return { type: 'unicode-range', start: parseInt(first + '0'.repeat(q), 16), end: parseInt(first + 'F'.repeat(q), 16) };
    }
    const start = parseInt(first, 16);
    if (peek() === '-' && isHex(peek(1))) {
      i++;
      let second = '';
      while (second.length < 6 && isHex(peek())) second += s[i++];
      return { type: 'unicode-range', start, end: parseInt(second, 16) };
    }
    return { type: 'unicode-range', start, end: start };
  };
  const consumeList = (close: string | null): Token[] => {
    const out: Token[] = [];
    for (;;) {
      if (s.startsWith('/*', i)) {
        const end = s.indexOf('*/', i + 2);
        i = end < 0 ? s.length : end + 2;
        continue;
      }
      const c = peek();
      if (c === undefined) return out;
      if (close !== null && c === close) {
        i++;
        return out;
      }
      if (isWs(c)) {
        while (isWs(peek())) i++;
        out.push({ type: 'whitespace' });
        continue;
      }
      if (c === '"' || c === "'") {
        i++;
        out.push(consumeString(c));
        continue;
      }
      if (c === ',') {
        i++;
        out.push({ type: 'comma' });
        continue;
      }
      if (c === '(' || c === '[' || c === '{') {
        i++;
        out.push({ type: 'block', open: c, args: consumeList(c === '(' ? ')' : c === '[' ? ']' : '}') });
        continue;
      }
      if (unicodeRanges && (c === 'u' || c === 'U') && peek(1) === '+' && (isHex(peek(2)) || peek(2) === '?')) {
        i += 2;
        out.push(consumeUnicodeRange());
        continue;
      }
      if (startsNumber(c, peek(1), peek(2))) {
        const n = consumeNumber();
        if (startsIdent(peek(), peek(1), peek(2))) {
          const unit = consumeName();
          out.push({ type: 'dimension', value: n.value, unit, repr: n.repr });
        } else if (peek() === '%') {
          i++;
          out.push({ type: 'percentage', value: n.value, repr: n.repr });
        } else out.push({ type: 'number', ...n });
        continue;
      }
      if (startsIdent(c, peek(1), peek(2))) {
        const name = consumeName();
        if (peek() === '(') {
          i++;
          if (asciiLower(name) === 'url') {
            const save = i;
            while (isWs(peek())) i++;
            if (peek() === '"' || peek() === "'") {
              i = save;
              out.push({ type: 'function', value: name, args: consumeList(')') });
            } else {
              i = save;
              out.push(consumeUrl());
            }
          } else out.push({ type: 'function', value: name, args: consumeList(')') });
        } else out.push({ type: 'ident', value: name });
        continue;
      }
      i++;
      out.push({ type: 'delim', value: c });
    }
  };
  return consumeList(null);
}

/** A token stream with Blink's ConsumeWhitespace / ConsumeIncludingWhitespace idioms. */
export class TokenStream {
  private i = 0;
  private readonly tokens: readonly Token[];
  constructor(tokens: readonly Token[]) {
    this.tokens = tokens;
  }
  peek(): Token | undefined {
    return this.tokens[this.i];
  }
  atEnd(): boolean {
    return this.i >= this.tokens.length;
  }
  consume(): Token | undefined {
    return this.tokens[this.i++];
  }
  consumeWhitespace(): void {
    while (this.peek()?.type === 'whitespace') this.i++;
  }
  consumeIncludingWhitespace(): Token | undefined {
    const t = this.consume();
    this.consumeWhitespace();
    return t;
  }
  /** Consumes a comma and the whitespace after it; false (and nothing consumed) when the next token is not a comma. */
  consumeCommaIncludingWhitespace(): boolean {
    if (this.peek()?.type !== 'comma') return false;
    this.consumeIncludingWhitespace();
    return true;
  }
  skipUntilComma(): void {
    while (!this.atEnd() && this.peek()?.type !== 'comma') this.i++;
  }
}

/** ASCII lowercase: CSS keywords compare ASCII case-insensitively, so non-ASCII letters keep their case. */
export const asciiLower = (s: string): string => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

/** ASCII case-insensitive identifier comparison, as CSS keywords compare. */
export const identIs = (t: Token | undefined, ...names: string[]): boolean => t?.type === 'ident' && names.includes(asciiLower(t.value));
