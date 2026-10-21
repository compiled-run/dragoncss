// SVG-d: d (SVG 2 §9.3.1, Blink D::ParseSingleValue) is none or path(<string>), the string SVG path data that must parse whole: Chrome
// drops a declaration whose path data has an error, unlike the d attribute, which draws up to it. path("") computes to none. The
// path() function takes no fill rule in d (Chrome rejects path(evenodd, "...")). Dragon keeps the value as text, path() with the data
// as a serialized string; an elliptical arc in it is refused (package SVG-arc), as in the attribute.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { parsePathData } from '../../analysis/elements/svg-path.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower, parseSerializedString, serializeString } from '../escapes.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

/** The CssValue type of a d path; its text is path() with the data as a serialized string. */
export const SVG_PATH = 'path';

/** The d value of path data: none when it is empty, else path() of it; null when the data does not parse. */
export function svgPathValue(data: string): { readonly value: CssValue } | { readonly error: string; readonly arc: boolean } {
  const d = parsePathData(data);
  if (!d.ok) return { error: d.reason, arc: d.arc };
  return { value: d.segments.length === 0 ? { kind: 'keyword', value: 'none' } : { kind: 'other', type: SVG_PATH, text: `path(${serializeString(data)})` } };
}

/** The path data of a computed d that is not none. */
export function svgPathData(v: CssValue): string {
  if (v.kind !== 'other' || v.type !== SVG_PATH) throw new Error(`d computed to ${v.kind}`);
  return parseSerializedString(v.text.slice('path('.length, -1));
}

function parseD(tokens: readonly CssNode[], base: Span): ParsedValue {
  const ok = (value: CssValue): ParsedValue => ({ kind: 'ok', longhands: [{ property: 'd', value, explicit: true }] });
  const invalid: ParsedValue = { kind: 'invalid', reason: 'd is none or path() of one string of path data' };
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined) return invalid;
  if (t.type === 'Identifier') return asciiLower(String(t['name'])) === 'none' ? ok({ kind: 'keyword', value: 'none' }) : invalid;
  if (t.type !== 'Function' || asciiLower(String(t['name'])) !== 'path') return invalid;
  const args = (t['children'] as { toArray(): CssNode[] }).toArray().filter((n) => n.type !== 'WhiteSpace');
  const s = args[0];
  if (args.length !== 1 || s === undefined || s.type !== 'String') return invalid;
  const v = svgPathValue(String(s['value']));
  if ('value' in v) return ok(v.value);
  if (!v.arc) return { kind: 'invalid', reason: `the path data does not parse (${v.error}), so Chrome drops the declaration` };
  return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `d: ${generate(t)} is unsupported: ${v.error}`, manual: 'Draw the curve with C or Q commands instead of A.' }) };
}

/** The value parser of d (the value hook, css/paint-parsers.ts). */
export const SVG_D_VALUE_PARSERS: { readonly d: (tokens: readonly CssNode[], base: Span) => ParsedValue } = { d: parseD };
