// The mask family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for (lines 7008-7096 and 9159-9180). MaskImage,
// MaskRepeat and MaskSize ignore UseAliasParsing, MaskPosition uses it only for a use counter, and Mask's none takes no aliased
// component (css_parsing_utils.cc ParseBackgroundOrMask), so those parse alike. MaskClip and MaskOrigin parse the prefixed boxes
// under the alias (ConsumePrefixedBackgroundBox), which take border-box as the unprefixed parsers do (measured in
// packages/parity/test/mask-parse.test.ts); Dragon keeps every other value and refuses it, but for the prefixed border, which
// ConsumePrefixedBackgroundBox reads as border-box, the initial value (prefixedMaskBox). MaskComposite::ParseSingleValue parses only
// the prefixed compositing operators under the alias (ConsumePrefixedMaskComposite, the keyword range clear to plus-lighter), so a
// style sheet's -webkit-mask-composite: add is dropped and source-over is kept, computing to source-over (MASK_ALIAS_PARSERS). CSSOM
// setProperty differs: CSSParser::ParseValue first parses an alias as its resolved property, so it keeps add too. A var() value is
// parsed after substitution as mask-composite.
import type { CssNode } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { MASK_LONGHANDS, MASK_SHORTHANDS } from '../properties/mask.ts';
import { MASK_COMPOSITE_SOURCE_OVER, maskLayerOther } from '../properties/mask.ts';
import type { ParsedValue } from '../stylesheet.ts';
import { CSS_WIDE, type CssValue } from '../values.ts';

export const MASK_ALIASES = {
  '-webkit-mask': 'mask',
  '-webkit-mask-clip': 'mask-clip',
  '-webkit-mask-composite': 'mask-composite',
  '-webkit-mask-image': 'mask-image',
  '-webkit-mask-origin': 'mask-origin',
  '-webkit-mask-position': 'mask-position',
  '-webkit-mask-repeat': 'mask-repeat',
  '-webkit-mask-size': 'mask-size',
} as const satisfies { readonly [alias: string]: (typeof MASK_LONGHANDS)[number] | (typeof MASK_SHORTHANDS)[number] };

/** The value -webkit-mask-clip or -webkit-mask-origin computes from a value kept as written: border is border-box; else null. */
export function prefixedMaskBox(alias: string, value: CssValue): CssValue | null {
  if (alias !== '-webkit-mask-clip' && alias !== '-webkit-mask-origin') return null;
  return value.kind === 'other' && /^border$/i.test(value.text.trim()) ? { kind: 'keyword', value: 'border-box' } : null;
}
/** Chrome 145's prefixed compositing operators, the CSSValueID range clear to plus-lighter (css_value_keywords.json5; highlight is commented out). */
export const PREFIXED_MASK_COMPOSITE: ReadonlySet<string> = new Set(['clear', 'copy', 'source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in', 'destination-out', 'destination-atop', 'xor', 'plus-lighter']);

/**
 * -webkit-mask-composite as Chrome parses it in a style sheet: a comma-separated list of prefixed operators. source-over alone is
 * accepted; another list is kept and refused (checkMask); identifiers and commas that are not such a list are dropped. null for a
 * CSS-wide keyword or a value with a token other than an identifier or operator, which parses as mask-composite does (kept and refused).
 */
export function parsePrefixedMaskComposite(tokens: readonly CssNode[]): ParsedValue | null {
  if (tokens.length === 0) return null;
  if (!tokens.every((t) => t.type === 'Identifier' || t.type === 'Operator')) return null;
  const first = tokens[0] as CssNode;
  if (tokens.length === 1 && first.type === 'Identifier' && CSS_WIDE.has(asciiLower(String(first['name'])))) return null;
  const reason = 'Chrome parses -webkit-mask-composite as a list of the prefixed compositing operators, clear to plus-lighter';
  if (tokens.length % 2 === 0) return { kind: 'invalid', reason };
  for (const [i, t] of tokens.entries()) {
    const ok = i % 2 === 0 ? t.type === 'Identifier' && PREFIXED_MASK_COMPOSITE.has(asciiLower(String(t['name']))) : t.type === 'Operator' && t['value'] === ',';
    if (!ok) return { kind: 'invalid', reason };
  }
  const value = tokens.length === 1 && asciiLower(String(first['name'])) === 'source-over' ? MASK_COMPOSITE_SOURCE_OVER : maskLayerOther(tokens);
  return { kind: 'ok', longhands: [{ property: 'mask-composite', value, explicit: true }] };
}

/** The aliases Chrome parses unlike their property (UseAliasParsing), each with its own value parser. */
export const MASK_ALIAS_PARSERS: { readonly [alias in keyof typeof MASK_ALIASES]?: (tokens: readonly CssNode[]) => ParsedValue | null } = {
  '-webkit-mask-composite': parsePrefixedMaskComposite,
};
