// The paint value hook (PNT1): the paint families whose values are more than one token (border radii, and later shadows,
// outlines and colour schemes) parse their own values, with the checks Chrome's parser makes beyond the webref grammar. The parse
// driver (stylesheet.ts parseValue) calls the parser of a property named here after the grammar check, for a value that is not a
// CSS-wide keyword.
import type { CssNode } from 'css-tree';
import type { Span } from '../types.ts';
import { RADIUS_VALUE_PARSERS } from './properties/radius.ts';
import { parseBoxShadow } from './properties/shadow.ts';
import { parseBorderRadius } from './shorthands/radius.ts';
import type { ParsedValue } from './stylesheet.ts';

export type PaintValueParser = (tokens: readonly CssNode[], base: Span) => ParsedValue;

/** Registration point (PNT1): the paint value parsers by property, one entry per family property. */
export const PAINT_VALUE_PARSERS: ReadonlyMap<string, PaintValueParser> = new Map<string, PaintValueParser>([
  ...Object.entries(RADIUS_VALUE_PARSERS),
  ['border-radius', parseBorderRadius],
  ['box-shadow', parseBoxShadow],
]);
