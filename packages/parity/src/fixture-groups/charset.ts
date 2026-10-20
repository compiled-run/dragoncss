// Fixture group charset (css-syntax-3 §3.2): @charset is accepted as a no-op, as Chrome drops it after decoding: "utf-8" at the
// very start of a sheet, and any @charset the encoding sniffer does not read (after whitespace, in single quotes, after rules, inside
// @media). Each accepted fixture must render in Chrome exactly as charset-none, the same sheet without it
// (packages/dragon/test/charset.test.ts). The reject is the sniffed form with another encoding.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CHARSET: readonly FixtureSpec[] = [
  both('charset-none'),
  both('charset-utf8'),
  both('charset-utf8-upper'),
  reject('reject-charset-latin1', 'DRAGON_UNSUPPORTED_AT_RULE', '@charset "iso-8859-1";', '@charset in the stylesheet is not supported: its encoding iso-8859-1 is not UTF-8'),
  both('charset-late'),
  both('charset-single-quotes'),
  both('charset-after-rules'),
];
