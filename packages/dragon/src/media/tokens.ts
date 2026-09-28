// CSS Syntax 3 tokenizer and component values for a media query prelude; offsets index the source text.

export type Token =
  | { readonly type: 'ident' | 'function' | 'at-keyword' | 'hash' | 'url'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly type: 'string'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly type: 'bad-string' | 'bad-url' | 'whitespace' | 'cdo' | 'cdc' | 'colon' | 'semicolon' | 'comma'; readonly start: number; readonly end: number }
  | { readonly type: '(' | ')' | '[' | ']' | '{' | '}'; readonly start: number; readonly end: number }
  | { readonly type: 'delim'; readonly value: string; readonly start: number; readonly end: number }
  | { readonly type: 'number' | 'percentage'; readonly value: number; readonly start: number; readonly end: number }
  | { readonly type: 'dimension'; readonly value: number; readonly unit: string; readonly start: number; readonly end: number };

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
const isHex = (c: string | undefined): boolean => c !== undefined && /^[0-9a-fA-F]$/.test(c);
const isNameStart = (c: string | undefined): boolean => c !== undefined && (/^[A-Za-z_]$/.test(c) || c.charCodeAt(0) >= 0x80);
const isName = (c: string | undefined): boolean => isNameStart(c) || isDigit(c) || c === '-';
const isWs = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
const validEscape = (a: string | undefined, b: string | undefined): boolean => a === '\\' && b !== '\n' && b !== undefined;

/** Tokenizes CSS source; comments are dropped. */
export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const at = (k: number): string | undefined => (i + k < src.length ? src[i + k] : undefined);
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
    const c = at(0);
    i++;
    if (isHex(c)) {
      let hex = c as string;
      while (hex.length < 6 && isHex(at(0))) hex += src[i++];
      if (isWs(at(0))) i++;
      const cp = Number.parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? '�' : String.fromCodePoint(cp);
    }
    return c === undefined ? '�' : c;
  };
  const consumeName = (): string => {
    let s = '';
    for (;;) {
      const c = at(0);
      if (isName(c)) {
        s += c;
        i++;
      } else if (validEscape(c, at(1))) {
        i++;
        s += consumeEscape();
      } else return s;
    }
  };
  const consumeNumber = (): number => {
    const begin = i;
    if (at(0) === '+' || at(0) === '-') i++;
    while (isDigit(at(0))) i++;
    if (at(0) === '.' && isDigit(at(1))) {
      i++;
      while (isDigit(at(0))) i++;
    }
    if ((at(0) === 'e' || at(0) === 'E') && (isDigit(at(1)) || ((at(1) === '+' || at(1) === '-') && isDigit(at(2))))) {
      i += 2;
      while (isDigit(at(0))) i++;
    }
    return Number(src.slice(begin, i));
  };
  while (i < src.length) {
    const start = i;
    const c = src[i] as string;
    if (c === '/' && at(1) === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close < 0 ? src.length : close + 2;
      continue;
    }
    if (isWs(c)) {
      while (isWs(at(0))) i++;
      out.push({ type: 'whitespace', start, end: i });
    } else if (c === '"' || c === "'") {
      i++;
      let value = '';
      let bad = false;
      for (;;) {
        const d = at(0);
        if (d === undefined) break;
        if (d === c) {
          i++;
          break;
        }
        if (d === '\n') {
          bad = true;
          break;
        }
        if (d === '\\') {
          if (at(1) === undefined) i++;
          else if (at(1) === '\n') i += 2;
          else {
            i++;
            value += consumeEscape();
          }
          continue;
        }
        value += d;
        i++;
      }
      out.push(bad ? { type: 'bad-string', start, end: i } : { type: 'string', value, start, end: i });
    } else if (c === '#') {
      if (isName(at(1)) || validEscape(at(1), at(2))) {
        i++;
        out.push({ type: 'hash', value: consumeName(), start, end: i });
      } else {
        i++;
        out.push({ type: 'delim', value: c, start, end: i });
      }
    } else if (c === '(' || c === ')' || c === '[' || c === ']' || c === '{' || c === '}') {
      i++;
      out.push({ type: c, start, end: i });
    } else if (c === ',' || c === ':' || c === ';') {
      i++;
      out.push({ type: c === ',' ? 'comma' : c === ':' ? 'colon' : 'semicolon', start, end: i });
    } else if (startsNumber(c, at(1), at(2))) {
      const value = consumeNumber();
      if (startsIdent(at(0), at(1), at(2))) out.push({ type: 'dimension', value, unit: consumeName(), start, end: i });
      else if (at(0) === '%') {
        i++;
        out.push({ type: 'percentage', value, start, end: i });
      } else out.push({ type: 'number', value, start, end: i });
    } else if (c === '-' && at(1) === '-' && at(2) === '>') {
      i += 3;
      out.push({ type: 'cdc', start, end: i });
    } else if (c === '<' && at(1) === '!' && at(2) === '-' && at(3) === '-') {
      i += 4;
      out.push({ type: 'cdo', start, end: i });
    } else if (c === '@' && startsIdent(at(1), at(2), at(3))) {
      i++;
      out.push({ type: 'at-keyword', value: consumeName(), start, end: i });
    } else if (startsIdent(c, at(1), at(2))) {
      const name = consumeName();
      if (at(0) === '(') {
        i++;
        out.push({ type: 'function', value: name, start, end: i });
      } else out.push({ type: 'ident', value: name, start, end: i });
    } else {
      i++;
      out.push({ type: 'delim', value: c, start, end: i });
    }
  }
  return out;
}

export type ComponentValue =
  | { readonly kind: 'token'; readonly token: Token; readonly start: number; readonly end: number }
  | { readonly kind: 'block'; readonly open: '(' | '[' | '{'; readonly children: readonly ComponentValue[]; readonly start: number; readonly end: number }
  | { readonly kind: 'function'; readonly name: string; readonly children: readonly ComponentValue[]; readonly start: number; readonly end: number };

const CLOSE = { '(': ')', '[': ']', '{': '}' } as const;

/** Groups tokens into component values; an unclosed block or function runs to the end of the source. */
export function componentValues(tokens: readonly Token[], srcLength: number): ComponentValue[] {
  let i = 0;
  const consume = (close: string | null): { children: ComponentValue[]; end: number } => {
    const children: ComponentValue[] = [];
    while (i < tokens.length) {
      const t = tokens[i] as Token;
      if (t.type === close) {
        i++;
        return { children, end: t.end };
      }
      i++;
      if (t.type === '(' || t.type === '[' || t.type === '{') {
        const inner = consume(CLOSE[t.type]);
        children.push({ kind: 'block', open: t.type, children: inner.children, start: t.start, end: inner.end });
      } else if (t.type === 'function') {
        const inner = consume(')');
        children.push({ kind: 'function', name: t.value, children: inner.children, start: t.start, end: inner.end });
      } else children.push({ kind: 'token', token: t, start: t.start, end: t.end });
    }
    return { children, end: srcLength };
  };
  return consume(null).children;
}

export const isWhitespace = (cv: ComponentValue): boolean => cv.kind === 'token' && cv.token.type === 'whitespace';
