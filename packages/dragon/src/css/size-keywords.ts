// Chrome 145's prefixed sizing keywords (css_parsing_utils.cc ConsumeWidthOrHeight): -webkit-fill-available computes to stretch
// and -webkit-min-content, -webkit-max-content and -webkit-fit-content to their unprefixed keywords, on width, height, their min-
// and max- forms and the logical sizes (pinned against Chrome by packages/parity/test/size-keyword-parse.test.ts).
import type { CssValue } from './values.ts';

const SIZE_PROPERTIES: ReadonlySet<string> = new Set([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'inline-size', 'block-size', 'min-inline-size', 'min-block-size', 'max-inline-size', 'max-block-size',
]);

const UNPREFIXED: ReadonlyMap<string, string> = new Map([
  ['-webkit-fill-available', 'stretch'],
  ['-webkit-min-content', 'min-content'],
  ['-webkit-max-content', 'max-content'],
  ['-webkit-fit-content', 'fit-content'],
]);

/** The computed form of a sizing property's keyword: the unprefixed keyword for a prefixed one, else the value itself. */
export function unprefixedSizeKeyword(property: string, v: CssValue): CssValue {
  if (v.kind !== 'keyword' || !SIZE_PROPERTIES.has(property)) return v;
  const as = UNPREFIXED.get(v.value);
  return as === undefined ? v : { kind: 'keyword', value: as };
}
