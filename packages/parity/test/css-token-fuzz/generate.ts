// The CSS tokenizer differential fuzzer's generator: seeded short value texts built from the pieces Chrome's tokenizer decides
// escapes by (hex runs of 1 to 7 digits and their white space, identity escapes, backslashes before newlines and at the end, CR, LF,
// FF and CRLF, strings, comments, U+0000, lone surrogates, astral code points, and the non-ASCII letters Unicode case mapping folds
// onto ASCII: U+212A KELVIN SIGN, U+017F, U+0130, U+0131). The committed corpus (generated/corpus.json) is its output for
// CSS_TOKEN_FUZZ_SEED; packages/parity/test/css-token-fuzz.test.ts regenerates it, checks it equals the committed file, and compares
// every case with Chrome 145.
// Rewrite the corpus: node packages/parity/test/css-token-fuzz/generate.ts --write

import { writeFileSync } from 'node:fs';

export const CSS_TOKEN_FUZZ_SEED = 20260930;
export const CSS_TOKEN_FUZZ_COUNT = 600;
export const CORPUS_URL = new URL('./generated/corpus.json', import.meta.url);

type Rng = () => number;

/** mulberry32: a small deterministic PRNG, so the corpus is a pure function of the seed. */
function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What a value text is checked as: a font-family value, a custom property value, a class selector, or a display keyword. */
export type FuzzMode = 'family' | 'custom' | 'class' | 'keyword';
export type FuzzText = { readonly mode: FuzzMode; readonly text: string };

const KEYWORDS = ['block', 'inline', 'flex', 'none', 'grid', 'contents', 'inline-block', 'flow-root', 'table', 'list-item'];
const FOLDING = ['K', 'ſ', 'İ', 'ı', 'K', 'S', 'I'];

export function generateTexts(seed: number = CSS_TOKEN_FUZZ_SEED, count: number = CSS_TOKEN_FUZZ_COUNT): FuzzText[] {
  const r = mulberry32(seed);
  const int = (lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
  const hexRun = (cp: number): string => {
    const digits = cp.toString(16);
    const len = int(Math.max(1, digits.length), 7);
    return (len <= 6 ? digits.padStart(len, '0') : `${digits.padStart(6, '0')}${pick(['0', 'a', 'F', '9'])}`).replace(/[a-f]/g, (c) => (r() < 0.3 ? c.toUpperCase() : c));
  };
  const white = (): string => pick([' ', '\t', '\n', '\r', '\f', '\r\n', '']);
  const escapeOf = (c: string): string => {
    const cp = c.codePointAt(0) as number;
    if (r() < 0.6) return `\\${hexRun(cp)}${white()}`;
    return /[0-9a-fA-F\n\r\f]/.test(c) ? `\\${hexRun(cp)} ` : `\\${c}`;
  };
  const piece = (): string => {
    switch (int(0, 15)) {
      case 0: return escapeOf(pick(['a', 'b', 'k', 's', 'i', '-', '_', '1', ' ', '"', "'", '\\', '/', '*', ',', ':', '\u{1F600}', 'é']));
      case 1: return `\\${hexRun(pick([0, 0xd800, 0xdfff, 0x110000, 0xffffff, 0x10ffff, 0x7f, 0x1, 0x20, 0x2d, 0x31, 0x212a, 0x17f]))}${white()}`;
      case 2: return pick(['\\\n', '\\\r\n', '\\\r', '\\\f', '\\']);
      case 3: return pick(['"', "'"]);
      case 4: return `"${pick(['a', 'b c', '\\"', "\\'", '\\\n', '\\\r\n', '\\61 ', '\\', ''])}${pick(['"', ''])}`;
      case 5: return pick(['/*', '*/', '/* c */', '/**/']);
      case 6: return pick(['\u0000', '\uD800', '\uDC00', '\u{1F600}']);
      case 7: return pick(FOLDING);
      case 8: return white() || ' ';
      case 9: return pick([',', ' , ', '(', ')', '-', '--', '_']);
      case 10: return pick(['1', '12', '1e3', '0']);
      default: return Array.from({ length: int(1, 4) }, () => pick(['a', 'b', 'x', 'A', 'serif', 'Arial', 'k', 's', 'i', 'n'])).join('');
    }
  };
  const keyword = (): string => {
    const k = pick(KEYWORDS);
    const i = int(0, k.length - 1);
    const c = k[i] as string;
    const swap = pick(['escape', 'fold', 'upper', 'trail']);
    if (swap === 'escape') return `${k.slice(0, i)}${escapeOf(r() < 0.5 ? c : c.toUpperCase())}${k.slice(i + 1)}`;
    if (swap === 'fold') return `${k.slice(0, i)}${c === 'k' ? 'K' : c === 's' ? 'ſ' : c === 'i' ? pick(['İ', 'ı']) : pick(FOLDING)}${k.slice(i + 1)}`;
    if (swap === 'upper') return k.toUpperCase();
    return `${k}${piece()}`;
  };
  const modes: FuzzMode[] = ['family', 'custom', 'class', 'keyword'];
  return Array.from({ length: count }, (_, n) => {
    const mode = modes[n % modes.length] as FuzzMode;
    const text = mode === 'keyword' ? keyword() : Array.from({ length: int(1, 5) }, piece).join('');
    return { mode, text };
  });
}

if (process.argv.includes('--write')) {
  writeFileSync(CORPUS_URL, `${JSON.stringify({ seed: CSS_TOKEN_FUZZ_SEED, count: CSS_TOKEN_FUZZ_COUNT, texts: generateTexts() }, null, 1)}\n`);
}
