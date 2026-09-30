// css-grid-2 and css-align-3 values: the longhand values of the grid properties and justify-items / justify-self, the expansions of
// the grid shorthands, and the checks Chrome 145's parser makes beyond the webref grammar (Blink css_parsing_utils.cc
// ConsumeGridLine, ConsumeGridTrackList, ParseGridTemplateAreasRow; css_property_parser_helpers ConsumeSelfPositionOverflowPosition).
import { generate, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import { asciiLower, decodeName, serializeIdentifier } from './escapes.ts';
import type { Longhand } from './properties.ts';
import type { LonghandValue, ParsedValue } from './stylesheet.ts';
import type { FontBases } from './units.ts';
import { V1_MATH_FUNCTIONS } from './math.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx, mathFunctionRefusal, normalizeUnit, unitEntry, unitRefusal } from './units.ts';
import type { CssValue } from './values.ts';
import { CSS_WIDE, kw } from './values.ts';

/** The properties whose values this module parses: the grid longhands and shorthands other than the gap aliases, and justify-*. */
export const GRID_VALUE_PROPERTIES: ReadonlySet<string> = new Set([
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
  'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end', 'justify-items', 'justify-self',
  'grid', 'grid-template', 'grid-row', 'grid-column', 'grid-area',
]);

/** The track-list longhands, whose lengths compute to px (computeGridLengths). */
export const GRID_TRACK_LONGHANDS = ['grid-template-columns', 'grid-template-rows', 'grid-auto-columns', 'grid-auto-rows'] as const satisfies readonly Longhand[];

const explicit = (property: Longhand, value: CssValue): LonghandValue => ({ property, value, explicit: true });
const implicit = (property: Longhand, value: CssValue): LonghandValue => ({ property, value, explicit: false });
const other = (type: string, text: string): CssValue => ({ kind: 'other', type, text });

/** An identifier in its serialized form (escapes.ts canonicalizeEscapes rewrote it from the authored text). */
const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? String(n['name']) : null);
/** css-syntax-3 §4.3.11: keywords match on the identifier's value after escapes are decoded (\\61uto is auto), ASCII case-insensitively. */
const lowerIdent = (n: CssNode | undefined): string | null => {
  const raw = ident(n);
  return raw === null ? null : asciiLower(decodeName(raw));
};
const isSlash = (n: CssNode): boolean => n.type === 'Operator' && n['value'] === '/';
const children = (n: CssNode): CssNode[] => list(n, 'children').filter((c) => c.type !== 'WhiteSpace');

/** Top-level tokens split at each "/". */
function splitSlash(tokens: readonly CssNode[]): CssNode[][] {
  const parts: CssNode[][] = [[]];
  for (const t of tokens) {
    if (isSlash(t)) parts.push([]);
    else (parts[parts.length - 1] as CssNode[]).push(t);
  }
  return parts;
}

// ---- Serialization -------------------------------------------------------------------------------------------------------

// Every value is written in Chrome 145's computed form (probed): lowercase keywords, function names and units; numbers without
// sign, leading dot or exponent where CSS allows; a unitless zero track size as 0px; one space between tokens and after each
// comma; names serialized as CSSOM identifiers. Numbers keep their full value: Chrome displays 6 significant digits, but the
// emitted CSS must give Chrome the value it computed from the authored CSS.

type DimensionText = (value: string, unit: string) => string;
/** A CSS number in its shortest form: +5 is 5, .5 is 0.5, 1e1 is 10, 12.50 is 12.5, -0 is 0. */
const cssNumber = (raw: string): string => String(Number(raw) + 0);
const keepDimension: DimensionText = (value, unit) => `${cssNumber(value)}${unit}`;

/** A custom identifier (a line name) in its serialized form. */
const nameText = (n: CssNode): string => serializeIdentifier(decodeName(String(n['name'])));

/** A track-list token as CSS text in Chrome's computed form (the comment above). */
function trackText(n: CssNode, dim: DimensionText): string {
  switch (n.type) {
    case 'Identifier':
      return lowerIdent(n) as string;
    case 'Number':
      // A unitless number in a track list is a zero length or a repeat() count.
      return Number(n['value']) === 0 ? dim('0', CANONICAL_LENGTH_UNIT) : cssNumber(String(n['value']));
    case 'Dimension':
      return dim(String(n['value']), normalizeUnit(String(n['unit'])));
    case 'Percentage':
      return `${cssNumber(String(n['value']))}%`;
    case 'Brackets':
      // Empty line names name nothing; Chrome omits them.
      return children(n).length === 0 ? '' : `[${children(n).map(nameText).join(' ')}]`;
    case 'Function': {
      const name = asciiLower(String(n['name']));
      const parts: CssNode[][] = [[]];
      for (const c of children(n)) {
        if (c.type === 'Operator' && c['value'] === ',') parts.push([]);
        else (parts[parts.length - 1] as CssNode[]).push(c);
      }
      // css-grid-2 §7.2.4: a flexible size is minmax(auto, <flex>), and Chrome writes it as the flex.
      const [first, second] = parts as [CssNode[], CssNode[]?];
      if (name === 'minmax' && first.length === 1 && lowerIdent(first[0]) === 'auto' && second?.length === 1 && isFlex(second[0])) return trackText(second[0] as CssNode, dim);
      const text = parts.map((a, i) => {
        // Blink ConsumeGridTrackRepeatFunction: a repetition count is clamped so the repeat() holds at most kGridMaxTracks tracks.
        if (name === 'repeat' && i === 0 && a.length === 1 && isInteger(a[0])) return String(clampCount(Number((a[0] as CssNode)['value']), (parts[1] ?? []).filter((t) => t.type !== 'Brackets').length));
        return tracksText(a, dim);
      });
      return `${name}(${text.join(', ')})`;
    }
    default:
      return generate(n);
  }
}

const tracksText = (tokens: readonly CssNode[], dim: DimensionText = keepDimension): string => tokens.map((t) => trackText(t, dim)).filter((t) => t !== '').join(' ');

/** Blink kGridMaxTracks: grid line integers are clamped to ±1e7, and a repeat() to 1e7 tracks. */
const GRID_MAX_TRACKS = 10000000;
const clampLine = (n: number): number => (n > GRID_MAX_TRACKS ? GRID_MAX_TRACKS : n < -GRID_MAX_TRACKS ? -GRID_MAX_TRACKS : n);
const clampCount = (count: number, tracks: number): number => {
  const max = tracks > 0 ? (GRID_MAX_TRACKS - (GRID_MAX_TRACKS % tracks)) / tracks : GRID_MAX_TRACKS;
  return count > max ? max : count;
};

/**
 * css-values-4 §6: the lengths of a track-list value computed to px (em against the element's computed font-size, rem against the
 * root's, absolute units by their ratio); fr, % and px stay as written.
 */
export function absolutizeGridText(text: string, fonts: FontBases): string {
  const node = parse(text, { context: 'value' });
  return tracksText(children(node), (value, unit) => {
    if (unit === CANONICAL_LENGTH_UNIT || unitEntry(unit) === null) return `${cssNumber(value)}${unit}`;
    const px = lengthToPx(Number(value), unit, fonts);
    return px === null ? `${cssNumber(value)}${unit}` : `${cssNumber(String(px))}${CANONICAL_LENGTH_UNIT}`;
  });
}

// ---- Refusals ------------------------------------------------------------------------------------------------------------

const SUBGRID_REASON = 'subgrid needs the grid engine and its subgrid package';
/** Where subgrid is the track-list keyword; elsewhere, and inside line-name brackets, it is a name like any other. */
const SUBGRID_PROPERTIES: ReadonlySet<string> = new Set(['grid-template-columns', 'grid-template-rows', 'grid-template', 'grid']);

/** calc(), min(), max() and clamp(), which V1 of the value model lowers only for box lengths, not inside grid values. */
function trackMathRefusal(name: string): { reason: string; fix: string } | null {
  const lower = asciiLower(name);
  if (!V1_MATH_FUNCTIONS.has(lower)) return null;
  return { reason: `${lower}() is a css-values-4 math function, which grid values take only with the grid engine`, fix: 'Write the size as px, a percentage, fr or a keyword.' };
}

/** vw, vh, vi, vb, vmin and vmax, which V1 of the value model resolves only in box lengths, not inside grid values. */
function trackViewportRefusal(unit: string): { reason: string; fix: string } | null {
  if (unitEntry(unit)?.conversion.kind !== 'viewport') return null;
  return { reason: `${unit} is a viewport unit, which grid values take only with the grid engine`, fix: 'Write the size as px, em, rem, a percentage, fr or a keyword.' };
}

/**
 * The first token Dragon cannot express: a unit with no build-time conversion, a viewport unit or a math function at any depth,
 * or the top-level subgrid keyword of a track list.
 */
function refusal(property: string, tokens: readonly CssNode[], base: Span, top = true): ParsedValue | null {
  for (const t of tokens) {
    let found: { reason: string; fix: string } | null = null;
    if (t.type === 'Dimension') {
      const unit = normalizeUnit(String(t['unit']));
      found = unitRefusal(unit) ?? trackViewportRefusal(unit);
    } else if (t.type === 'Function') found = mathFunctionRefusal(String(t['name'])) ?? trackMathRefusal(String(t['name']));
    else if (top && SUBGRID_PROPERTIES.has(property) && lowerIdent(t) === 'subgrid') found = { reason: SUBGRID_REASON, fix: 'Give the element its own track list.' };
    if (found !== null) {
      return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${found.reason}`, manual: found.fix }) };
    }
    if (t.type === 'Function' || t.type === 'Brackets') {
      const inner = refusal(property, children(t), base, false);
      if (inner !== null) return inner;
    }
  }
  return null;
}

// ---- Grid lines ----------------------------------------------------------------------------------------------------------

type GridLine = { readonly span: boolean; readonly integer: number | null; readonly name: string | null };

const isInteger = (n: CssNode | undefined): boolean => n !== undefined && n.type === 'Number' && /^[+-]?\d+$/.test(String(n['value']));

/** Blink ConsumeCustomIdentForGridLine and ConsumeGridLineNames: names other than auto, span, default and the CSS-wide keywords. */
const reservedName = (n: CssNode): boolean => {
  const lower = lowerIdent(n) ?? '';
  return lower === 'auto' || lower === 'span' || lower === 'default' || CSS_WIDE.has(lower);
};

/** A grid line's <custom-ident> in its serialized form, or null when it is not one. */
function lineName(n: CssNode | undefined): string | null {
  const name = ident(n);
  return name === null || reservedName(n as CssNode) ? null : nameText(n as CssNode);
}

/**
 * Blink ConsumeGridLine: auto, or the orders [<integer> <ident>? span?], [span <integer>? <ident>? <integer>?] and
 * [<ident> <integer>? span?], using every token; span needs an integer or a name, a span integer is positive, and 0 is invalid.
 */
function gridLine(tokens: readonly CssNode[]): GridLine | 'auto' | null {
  if (tokens.length === 1 && lowerIdent(tokens[0]) === 'auto') return 'auto';
  let i = 0;
  const take = {
    integer: (): number | null => (isInteger(tokens[i]) ? Number(tokens[i++]?.['value']) : null),
    name: (): string | null => {
      const n = lineName(tokens[i]);
      if (n !== null) i++;
      return n;
    },
    span: (): boolean => (lowerIdent(tokens[i]) === 'span' ? (i++, true) : false),
  };
  let integer = take.integer();
  let name: string | null = null;
  let span = false;
  if (integer !== null) {
    name = take.name();
    span = take.span();
  } else {
    span = take.span();
    if (span) {
      integer = take.integer();
      name = take.name();
      if (integer === null) integer = take.integer();
    } else {
      name = take.name();
      if (name === null) return null;
      integer = take.integer();
      span = take.span();
    }
  }
  if (i !== tokens.length) return null;
  if (span && integer === null && name === null) return null;
  if (span && integer !== null && integer < 0) return null;
  if (integer === 0) return null;
  return { span, integer, name };
}

function lineValue(line: GridLine | 'auto'): CssValue {
  if (line === 'auto') return kw('auto');
  // Chrome writes span 1 <name> as span <name> (1 is the default span) and clamps the integer (clampLine).
  const integer = line.integer === null || (line.span && line.integer === 1 && line.name !== null) ? null : String(clampLine(line.integer));
  const parts = [line.span ? 'span' : null, integer, line.name].filter((p) => p !== null);
  const type = [line.span ? 'span' : null, line.integer === null ? null : 'integer', line.name === null ? null : 'custom-ident'].filter((p) => p !== null).join('-');
  return other(type, parts.join(' '));
}

/** css-grid-2 §8.4: an omitted end line copies a start line that is a lone <custom-ident>, and is auto otherwise. */
const copied = (line: GridLine | 'auto'): GridLine | 'auto' => (line !== 'auto' && !line.span && line.integer === null ? line : 'auto');

// ---- Track lists ---------------------------------------------------------------------------------------------------------
// css-grid-2 §7.2 checked in full on the tokens, so the value is right whether or not the webref grammar ran first:
//   <track-list>          = [ <line-names>? [ <track-size> | <track-repeat> ] ]+ <line-names>?
//   <auto-track-list>     = [ <line-names>? [ <fixed-size> | <fixed-repeat> ] ]* <line-names>? <auto-repeat>
//                           [ <line-names>? [ <fixed-size> | <fixed-repeat> ] ]* <line-names>?
//   <explicit-track-list> = [ <line-names>? <track-size> ]+ <line-names>?
//   <track-size>  = <track-breadth> | minmax( <inflexible-breadth> , <track-breadth> ) | fit-content( <length-percentage [0,∞]> )
//   <fixed-size>  = <fixed-breadth> | minmax( <fixed-breadth> , <track-breadth> ) | minmax( <inflexible-breadth> , <fixed-breadth> )
//   <track-repeat> = repeat( <integer [1,∞]> , [ <line-names>? <track-size> ]+ <line-names>? )
//   <auto-repeat>  = repeat( [ auto-fill | auto-fit ] , [ <line-names>? <fixed-size> ]+ <line-names>? )
//   <fixed-repeat> = repeat( <integer [1,∞]> , [ <line-names>? <fixed-size> ]+ <line-names>? )

const INTRINSIC = new Set(['min-content', 'max-content', 'auto']);
const fnName = (n: CssNode): string | null => (n.type === 'Function' ? asciiLower(String(n['name'])) : null);
const nonNegative = (n: CssNode): boolean => Number(n['value']) >= 0;

/** <length-percentage [0,∞]>: a length in a length unit, a percentage, or a unitless zero; never negative. */
function isFixedBreadth(n: CssNode | undefined): boolean {
  if (n === undefined) return false;
  if (n.type === 'Percentage') return nonNegative(n);
  if (n.type === 'Number') return Number(n['value']) === 0;
  if (n.type !== 'Dimension') return false;
  return unitEntry(normalizeUnit(String(n['unit'])))?.dimension === 'length' && nonNegative(n);
}
const isFlex = (n: CssNode | undefined): boolean => n !== undefined && n.type === 'Dimension' && normalizeUnit(String(n['unit'])) === 'fr' && nonNegative(n);
const isInflexibleBreadth = (n: CssNode | undefined): boolean => isFixedBreadth(n) || INTRINSIC.has(lowerIdent(n) ?? '');
const isTrackBreadth = (n: CssNode | undefined): boolean => isInflexibleBreadth(n) || isFlex(n);

/** A function's arguments: its tokens split at each comma, or null when an argument is empty. */
function args(n: CssNode): CssNode[][] | null {
  const out: CssNode[][] = [[]];
  for (const c of children(n)) {
    if (c.type === 'Operator' && c['value'] === ',') out.push([]);
    else (out[out.length - 1] as CssNode[]).push(c);
  }
  return out.some((a) => a.length === 0) ? null : out;
}
/** A function's arguments when there are exactly count of them, each one token. */
function singleArgs(n: CssNode, count: number): CssNode[] | null {
  const a = args(n);
  return a === null || a.length !== count || a.some((x) => x.length !== 1) ? null : a.map((x) => x[0] as CssNode);
}

function isTrackSize(n: CssNode): boolean {
  if (isTrackBreadth(n)) return true;
  const name = fnName(n);
  if (name === 'minmax') {
    const a = singleArgs(n, 2);
    return a !== null && isInflexibleBreadth(a[0]) && isTrackBreadth(a[1]);
  }
  if (name === 'fit-content') {
    const a = singleArgs(n, 1);
    return a !== null && isFixedBreadth(a[0]);
  }
  return false;
}

function isFixedSize(n: CssNode): boolean {
  if (isFixedBreadth(n)) return true;
  if (fnName(n) !== 'minmax') return false;
  const a = singleArgs(n, 2);
  return a !== null && ((isFixedBreadth(a[0]) && isTrackBreadth(a[1])) || (isInflexibleBreadth(a[0]) && isFixedBreadth(a[1])));
}

/** <line-names>: brackets holding only identifiers that are not reserved names (Blink ConsumeGridLineNames). */
const isLineNames = (n: CssNode): boolean => n.type === 'Brackets' && children(n).every((c) => c.type === 'Identifier' && !reservedName(c));

/** [ <line-names>? <item> ]+ <line-names>? (or * when empty is allowed): at most one set of names between items. */
function isNamedSequence(tokens: readonly CssNode[], item: (n: CssNode) => boolean, allowEmpty: boolean): boolean {
  let items = 0;
  let names = false;
  for (const t of tokens) {
    if (t.type === 'Brackets') {
      if (names || !isLineNames(t)) return false;
      names = true;
    } else if (item(t)) {
      items++;
      names = false;
    } else {
      return false;
    }
  }
  return allowEmpty || items > 0;
}

type RepeatKind = 'auto' | 'fixed' | 'track' | null;
/** A repeat(): auto (auto-fill or auto-fit over fixed sizes), fixed (a count over fixed sizes), track (a count over track sizes), or null. */
function repeatKind(n: CssNode): RepeatKind {
  if (fnName(n) !== 'repeat') return null;
  const a = args(n);
  if (a === null || a.length !== 2 || (a[0] as CssNode[]).length !== 1) return null;
  const count = (a[0] as CssNode[])[0] as CssNode;
  const body = a[1] as CssNode[];
  const auto = ['auto-fill', 'auto-fit'].includes(lowerIdent(count) ?? '');
  if (!auto && !(isInteger(count) && Number(count['value']) >= 1)) return null;
  if (isNamedSequence(body, isFixedSize, false)) return auto ? 'auto' : 'fixed';
  return !auto && isNamedSequence(body, isTrackSize, false) ? 'track' : null;
}

const isTrackList = (tokens: readonly CssNode[]): boolean => isNamedSequence(tokens, (t) => isTrackSize(t) || repeatKind(t) !== null && repeatKind(t) !== 'auto', false);
function isAutoTrackList(tokens: readonly CssNode[]): boolean {
  if (tokens.filter((t) => repeatKind(t) === 'auto').length !== 1) return false;
  return isNamedSequence(tokens, (t) => isFixedSize(t) || repeatKind(t) === 'auto' || repeatKind(t) === 'fixed', false);
}
const isExplicitTrackList = (tokens: readonly CssNode[]): boolean => isNamedSequence(tokens, isTrackSize, false);

/** A grid-template-rows or -columns value (none, <track-list> or <auto-track-list>), or null when Chrome drops it. */
function templateValue(tokens: readonly CssNode[]): CssValue | null {
  if (tokens.length === 1 && lowerIdent(tokens[0]) === 'none') return kw('none');
  if (isTrackList(tokens)) return other('track-list', tracksText(tokens));
  if (isAutoTrackList(tokens)) return other('auto-track-list', tracksText(tokens));
  return null;
}

/** A grid-auto-rows or -columns value (<track-size>+), or null when Chrome drops it. */
function autoTracksValue(tokens: readonly CssNode[]): CssValue | null {
  if (tokens.length === 0 || !tokens.every(isTrackSize)) return null;
  const only = tokens.length === 1 ? lowerIdent(tokens[0]) : null;
  if (only !== null) return kw(only);
  return other(tokens.length === 1 ? 'track-size' : 'track-size-list', tracksText(tokens));
}

// ---- Areas ---------------------------------------------------------------------------------------------------------------

const NAME_CODE_POINT = /^[A-Za-z0-9_\-\u{80}-\u{10FFFF}]$/u;

/** css-grid-2 §7.3: one row's cells (null cells as "."), or null for a trash token or an empty row; scanned by code point. */
function areaRow(text: string): string[] | null {
  const points = Array.from(text);
  const cells: string[] = [];
  let i = 0;
  while (i < points.length) {
    const c = points[i] as string;
    if (/[ \t\n\r\f]/.test(c)) {
      i++;
    } else if (c === '.') {
      while (points[i] === '.') i++;
      cells.push('.');
    } else if (NAME_CODE_POINT.test(c)) {
      let name = '';
      while (i < points.length && NAME_CODE_POINT.test(points[i] as string)) name += points[i++];
      cells.push(name);
    } else {
      return null;
    }
  }
  return cells.length === 0 ? null : cells;
}

/** css-grid-2 §7.3: the grid-template-areas value of the strings, or null unless every row has the same column count and every named area is a filled rectangle. */
function areasValue(strings: readonly string[]): CssValue | null {
  const rows = strings.map(areaRow);
  if (rows.some((r) => r === null)) return null;
  const grid = rows as string[][];
  const width = (grid[0] as string[]).length;
  if (grid.some((r) => r.length !== width)) return null;
  const boxes = new Map<string, { top: number; left: number; bottom: number; right: number; count: number }>();
  grid.forEach((r, y) => r.forEach((name, x) => {
    if (name === '.') return;
    const b = boxes.get(name);
    if (b === undefined) boxes.set(name, { top: y, left: x, bottom: y, right: x, count: 1 });
    else boxes.set(name, { top: b.top < y ? b.top : y, left: b.left < x ? b.left : x, bottom: b.bottom > y ? b.bottom : y, right: b.right > x ? b.right : x, count: b.count + 1 });
  }));
  for (const [name, b] of boxes) {
    if (b.count !== (b.bottom - b.top + 1) * (b.right - b.left + 1)) return null;
    for (let y = b.top; y <= b.bottom; y++) for (let x = b.left; x <= b.right; x++) if ((grid[y] as string[])[x] !== name) return null;
  }
  return other('string', grid.map((r) => `"${r.join(' ')}"`).join(' '));
}

const stringOf = (n: CssNode): string => String(n['value']);

// ---- Alignment keywords --------------------------------------------------------------------------------------------------

const SELF_POSITIONS = new Set(['center', 'start', 'end', 'self-start', 'self-end', 'flex-start', 'flex-end', 'left', 'right']);

/**
 * css-align-3 §6.1 (justify-self) and §6.2 (justify-items) as Chrome 145 parses them, every token an identifier:
 * - one keyword: normal, stretch, baseline, anchor-center, a self position, left or right; auto for justify-self; legacy for
 *   justify-items;
 * - [first | last] baseline, written baseline or last baseline;
 * - safe or unsafe before a self position, left or right (never before normal, stretch or baseline);
 * - justify-items only: legacy with left, right or center in either order, written legacy <position>.
 */
function alignmentValue(property: string, tokens: readonly CssNode[]): CssValue | null {
  if (!tokens.every((t) => t.type === 'Identifier')) return null;
  const names = tokens.map((t) => lowerIdent(t) as string);
  const [a, b] = names;
  const items = property === 'justify-items';
  if (names.length === 1) {
    const single = ['normal', 'stretch', 'baseline', 'anchor-center', items ? 'legacy' : 'auto'];
    return single.includes(a as string) || SELF_POSITIONS.has(a as string) ? kw(a as string) : null;
  }
  if (names.length !== 2) return null;
  if ((a === 'first' || a === 'last') && b === 'baseline') return kw(a === 'last' ? 'last baseline' : 'baseline');
  if ((a === 'safe' || a === 'unsafe') && SELF_POSITIONS.has(b as string)) return kw(`${a} ${b as string}`);
  if (items) {
    const other = a === 'legacy' ? b : b === 'legacy' ? a : null;
    if (other === 'left' || other === 'right' || other === 'center') return kw(`legacy ${other}`);
  }
  return null;
}

/** css-grid-2 §7.7: [ row | column ] || dense, written row, column, dense or column dense. */
function autoFlowValue(tokens: readonly CssNode[]): CssValue | null {
  const names = tokens.map((t) => lowerIdent(t) ?? '');
  const axes = names.filter((n) => n === 'row' || n === 'column');
  const dense = names.filter((n) => n === 'dense');
  if (names.length === 0 || axes.length > 1 || dense.length > 1 || axes.length + dense.length !== names.length) return null;
  const column = axes[0] === 'column';
  return kw(column ? (dense.length > 0 ? 'column dense' : 'column') : (dense.length > 0 ? 'dense' : 'row'));
}

// ---- Longhands and shorthands --------------------------------------------------------------------------------------------

function gridTemplate(tokens: readonly CssNode[]): LonghandValue[] | null {
  if (tokens.length === 1 && lowerIdent(tokens[0]) === 'none') {
    return [explicit('grid-template-rows', kw('none')), explicit('grid-template-columns', kw('none')), explicit('grid-template-areas', kw('none'))];
  }
  const [before = [], after, ...rest] = splitSlash(tokens);
  if (rest.length > 0) return null;
  if (!before.some((t) => t.type === 'String')) {
    if (after === undefined) return null;
    const rows = templateValue(before);
    const columns = templateValue(after);
    if (rows === null || columns === null) return null;
    return [explicit('grid-template-rows', rows), explicit('grid-template-columns', columns), explicit('grid-template-areas', kw('none'))];
  }
  // css-grid-2 §7.4: [ <line-names>? <string> <track-size>? <line-names>? ]+ [ / <explicit-track-list> ]?; the trailing names of a
  // row and the leading names of the next are one set of line names in grid-template-rows.
  const strings: string[] = [];
  const rowText: string[] = [];
  let names: string[] = [];
  let i = 0;
  const lineNames = (): boolean => {
    const t = before[i];
    if (t === undefined || t.type !== 'Brackets') return true;
    if (!isLineNames(t)) return false;
    names.push(...children(t).map(nameText));
    i++;
    return true;
  };
  while (i < before.length) {
    if (!lineNames()) return null;
    const str = before[i];
    if (str === undefined || str.type !== 'String') return null;
    if (names.length > 0) rowText.push(`[${names.join(' ')}]`);
    names = [];
    strings.push(stringOf(str));
    i++;
    const size = before[i];
    if (size !== undefined && size.type !== 'Brackets' && size.type !== 'String') {
      if (!isTrackSize(size)) return null;
      rowText.push(trackText(size, keepDimension));
      i++;
    } else {
      rowText.push('auto');
    }
    if (!lineNames()) return null;
  }
  if (names.length > 0) rowText.push(`[${names.join(' ')}]`);
  const areas = areasValue(strings);
  const columns = after === undefined ? kw('none') : isExplicitTrackList(after) ? other('track-list', tracksText(after)) : null;
  if (areas === null || columns === null) return null;
  return [explicit('grid-template-rows', other('track-list', rowText.join(' '))), explicit('grid-template-columns', columns), explicit('grid-template-areas', areas)];
}

const AUTO_RESETS = (): LonghandValue[] => [implicit('grid-auto-rows', kw('auto')), implicit('grid-auto-columns', kw('auto')), implicit('grid-auto-flow', kw('row'))];

/** css-grid-2 §7.8: grid, a grid-template value or one axis of auto-flow. */
function grid(tokens: readonly CssNode[]): LonghandValue[] | null {
  const parts = splitSlash(tokens);
  const flowSide = parts.findIndex((p) => p.some((t) => lowerIdent(t) === 'auto-flow'));
  if (flowSide < 0) {
    const template = gridTemplate(tokens);
    return template === null ? null : [...template, ...AUTO_RESETS()];
  }
  if (parts.length !== 2) return null;
  // [ auto-flow && dense? ] <'grid-auto-rows'>?: the keywords first, in either order, then the track sizes.
  const flow = parts[flowSide] as CssNode[];
  let k = 0;
  while (k < flow.length && ['auto-flow', 'dense'].includes(lowerIdent(flow[k]) ?? '')) k++;
  const keywords = flow.slice(0, k).map((t) => lowerIdent(t));
  if (keywords.filter((w) => w === 'auto-flow').length !== 1 || keywords.filter((w) => w === 'dense').length > 1) return null;
  const dense = keywords.includes('dense');
  const sizes = flow.slice(k);
  const template = templateValue(parts[1 - flowSide] as CssNode[]);
  const autoSizes = sizes.length === 0 ? null : autoTracksValue(sizes);
  if (template === null || (sizes.length > 0 && autoSizes === null)) return null;
  const rowFlow = flowSide === 0;
  const flowValue = kw(rowFlow ? (dense ? 'dense' : 'row') : (dense ? 'column dense' : 'column'));
  return [
    explicit('grid-template-rows', rowFlow ? kw('none') : template),
    explicit('grid-template-columns', rowFlow ? template : kw('none')),
    explicit('grid-template-areas', kw('none')),
    rowFlow && autoSizes !== null ? explicit('grid-auto-rows', autoSizes) : implicit('grid-auto-rows', kw('auto')),
    !rowFlow && autoSizes !== null ? explicit('grid-auto-columns', autoSizes) : implicit('grid-auto-columns', kw('auto')),
    explicit('grid-auto-flow', flowValue),
  ];
}

function lines(tokens: readonly CssNode[], names: readonly Longhand[]): LonghandValue[] | null {
  const parts = splitSlash(tokens);
  if (parts.length > names.length) return null;
  const parsed = parts.map(gridLine);
  if (parsed.some((p) => p === null)) return null;
  const given = parsed as (GridLine | 'auto')[];
  if (names.length === 2) {
    const [start, end] = given as [GridLine | 'auto', (GridLine | 'auto')?];
    return [explicit(names[0] as Longhand, lineValue(start)), end === undefined ? filled(names[1] as Longhand, copied(start)) : explicit(names[1] as Longhand, lineValue(end))];
  }
  // css-grid-2 §8.4 grid-area: row-start / column-start / row-end / column-end.
  const [rowStart, columnStart = copied(rowStart as GridLine | 'auto'), rowEnd = copied(rowStart as GridLine | 'auto'), columnEnd = copied(columnStart)] = given;
  const out: LonghandValue[] = [];
  const values = [rowStart, columnStart, rowEnd, columnEnd] as (GridLine | 'auto')[];
  values.forEach((v, i) => out.push(i < given.length ? explicit(names[i] as Longhand, lineValue(v)) : filled(names[i] as Longhand, v)));
  return out;
}

/** A line the shorthand fills: a copied name is set, auto is the initial value. */
const filled = (property: Longhand, line: GridLine | 'auto'): LonghandValue => (line === 'auto' ? implicit(property, kw('auto')) : explicit(property, lineValue(line)));

export const GRID_SHORTHAND_LONGHANDS = {
  grid: ['grid-template-rows', 'grid-template-columns', 'grid-template-areas', 'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow'],
  'grid-template': ['grid-template-rows', 'grid-template-columns', 'grid-template-areas'],
  'grid-row': ['grid-row-start', 'grid-row-end'],
  'grid-column': ['grid-column-start', 'grid-column-end'],
  'grid-area': ['grid-row-start', 'grid-column-start', 'grid-row-end', 'grid-column-end'],
} as const satisfies { readonly [s: string]: readonly Longhand[] };

/** The longhand values of a grammar-valid grid value, or null when Chrome 145 drops it. */
export function gridLonghands(property: string, tokens: readonly CssNode[]): LonghandValue[] | null {
  const one = (p: Longhand, v: CssValue | null): LonghandValue[] | null => (v === null ? null : [explicit(p, v)]);
  switch (property) {
    case 'grid-template-columns':
    case 'grid-template-rows':
      return one(property, templateValue(tokens));
    case 'grid-template-areas':
      if (tokens.length === 1 && lowerIdent(tokens[0]) === 'none') return one(property, kw('none'));
      return one(property, tokens.every((t) => t.type === 'String') ? areasValue(tokens.map(stringOf)) : null);
    case 'grid-auto-columns':
    case 'grid-auto-rows':
      return one(property, autoTracksValue(tokens));
    case 'grid-auto-flow':
      return one(property, autoFlowValue(tokens));
    case 'grid-row-start':
    case 'grid-row-end':
    case 'grid-column-start':
    case 'grid-column-end': {
      const line = gridLine(tokens);
      return one(property, line === null ? null : lineValue(line));
    }
    case 'justify-items':
    case 'justify-self':
      return one(property, alignmentValue(property, tokens));
    case 'grid':
      return grid(tokens);
    case 'grid-template':
      return gridTemplate(tokens);
    case 'grid-row':
    case 'grid-column':
    case 'grid-area':
      return lines(tokens, GRID_SHORTHAND_LONGHANDS[property]);
    default:
      throw new Error(`${property} is not a grid value property`);
  }
}

const TRACKS_REASON = 'line names may not be span, auto, default or a CSS-wide keyword, and an automatic repetition takes only fixed sizes, with only fixed sizes and fixed repeats beside it and no second one (css-grid-2 §7.2)';
const AREAS_REASON = 'every row needs the same number of cells, every named area must be a filled rectangle, and a cell name uses only name code points (css-grid-2 §7.3)';
const LINE_REASON = 'a grid line is <integer> <name>? span?, span <integer>? <name>? or <name> <integer>? span?, with a nonzero integer and a positive span (css-grid-2 §8.3)';
const ALIGN_REASON = 'first or last goes before baseline, and safe or unsafe goes only before a position (css-align-3 §6)';

/** Why Chrome 145 drops a grammar-valid value of each property. */
const INVALID_REASONS: { readonly [p: string]: string } = {
  'grid-template-columns': TRACKS_REASON,
  'grid-template-rows': TRACKS_REASON,
  'grid-auto-columns': TRACKS_REASON,
  'grid-auto-rows': TRACKS_REASON,
  'grid-template-areas': AREAS_REASON,
  'grid-row-start': LINE_REASON,
  'grid-row-end': LINE_REASON,
  'grid-column-start': LINE_REASON,
  'grid-column-end': LINE_REASON,
  'grid-row': LINE_REASON,
  'grid-column': LINE_REASON,
  'grid-area': LINE_REASON,
  'justify-items': ALIGN_REASON,
  'justify-self': ALIGN_REASON,
  'grid-template': `${TRACKS_REASON}; ${AREAS_REASON}`,
  grid: `${TRACKS_REASON}; ${AREAS_REASON}`,
};

/** Parses a grammar-valid, non-CSS-wide grid or justify-* value: a refusal, invalid when Chrome drops it, or the longhands. */
export function parseGridValue(property: string, tokens: readonly CssNode[], base: Span): ParsedValue {
  const refused = refusal(property, tokens, base);
  if (refused !== null) return refused;
  const longhands = gridLonghands(property, tokens);
  return longhands === null ? { kind: 'invalid', reason: INVALID_REASONS[property] as string } : { kind: 'ok', longhands };
}
