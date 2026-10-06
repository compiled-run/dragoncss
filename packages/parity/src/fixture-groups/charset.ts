// Fixture group charset (css-syntax-3 §3.2): @charset "utf-8"; at the very start of a sheet is accepted as a no-op,
// as Chrome drops it after decoding. Each accepted fixture must render in Chrome exactly as charset-none, the same sheet without
// it (packages/dragon/test/charset.test.ts). The rejects name the forms that need Chrome-checked semantics.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CHARSET: readonly FixtureSpec[] = [
  both('charset-none'),
  both('charset-utf8'),
  both('charset-utf8-upper'),
  reject('reject-charset-latin1', 'DRAGON_UNSUPPORTED_AT_RULE', '@charset "iso-8859-1";', '@charset in the stylesheet is not supported: its encoding iso-8859-1 is not UTF-8'),
  reject('reject-charset-late', 'DRAGON_UNSUPPORTED_AT_RULE', '@charset "utf-8";', '@charset in the stylesheet is not supported: it is not at the very start of the stylesheet'),
  reject('reject-charset-single-quotes', 'DRAGON_UNSUPPORTED_AT_RULE', "@charset 'utf-8';", '@charset in the stylesheet is not supported: it is not written as @charset "<label>"; with double quotes'),
];
