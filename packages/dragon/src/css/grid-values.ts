// css-grid-2 and css-align-3 values: the longhand values of the grid properties and justify-items / justify-self, the expansions of
// the grid shorthands, and the checks Chrome 145's parser makes beyond the webref grammar (Blink css_parsing_utils.cc
// ConsumeGridLine, ConsumeGridTrackList, ParseGridTemplateAreasRow; css_property_parser_helpers ConsumeSelfPositionOverflowPosition).
import { generate, ident as cssIdent, parse } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Span } from '../types.ts';
import { list, spanOf } from './ast.ts';
import type { Longhand } from './properties.ts';
import type { LonghandValue, ParsedValue } from './stylesheet.ts';
import type { FontBases } from './units.ts';
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

/** An identifier as written: css-tree keeps its escapes, so this text is also its valid CSS serialization. */
const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? String(n['name']) : null);
/** css-syntax-3 §4.3.11: keywords match on the identifier's value after escapes are decoded (\\61uto is auto), ASCII case-insensitively. */
const lowerIdent = (n: CssNode | undefined): string | null => {
  const raw = ident(n);
  return raw === null ? null : cssIdent.decode(raw).toLowerCase();
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

type DimensionText = (value: string, unit: string) => string;
const keepDimension: DimensionText = (value, unit) => `${value}${unit}`;

/** A track-list token as CSS text: keywords and function names lowercased, line names kept as written. */
function trackText(n: CssNode, dim: DimensionText): string {
  switch (n.type) {
    case 'Identifier':
      return lowerIdent(n) as string;
    case 'Number':
      return String(n['value']);
    case 'Dimension':
      return dim(String(n['value']), normalizeUnit(String(n['unit'])));
    case 'Percentage':
      return `${String(n['value'])}%`;
    case 'Brackets':
      return `[${children(n).map((c) => String(c['name'])).join(' ')}]`;
    case 'Function': {
      const args: string[][] = [[]];
      for (const c of children(n)) {
        if (c.type === 'Operator' && c['value'] === ',') args.push([]);
        else (args[args.length - 1] as string[]).push(trackText(c, dim));
      }
      return `${String(n['name']).toLowerCase()}(${args.map((a) => a.join(' ')).join(', ')})`;
    }
    default:
      return generate(n);
  }
}

const tracksText = (tokens: readonly CssNode[], dim: DimensionText = keepDimension): string => tokens.map((t) => trackText(t, dim)).join(' ');

/**
 * css-values-4 §6: the lengths of a track-list value computed to px (em against the element's computed font-size, rem against the
 * root's, absolute units by their ratio); fr, % and px stay as written.
 */
export function absolutizeGridText(text: string, fonts: FontBases): string {
  const node = parse(text, { context: 'value' });
  return tracksText(children(node), (value, unit) => {
    if (unit === CANONICAL_LENGTH_UNIT || unitEntry(unit) === null) return `${value}${unit}`;
    const px = lengthToPx(Number(value), unit, fonts);
    return px === null ? `${value}${unit}` : `${String(px)}${CANONICAL_LENGTH_UNIT}`;
  });
}

// ---- Refusals ------------------------------------------------------------------------------------------------------------

const SUBGRID_REASON = 'subgrid needs the grid engine and its subgrid package';
/** Where subgrid is the track-list keyword; elsewhere, and inside line-name brackets, it is a name like any other. */
const SUBGRID_PROPERTIES: ReadonlySet<string> = new Set(['grid-template-columns', 'grid-template-rows', 'grid-template', 'grid']);

const ESCAPE_REASON = 'Dragon does not decode CSS escapes in grid values yet, so an escaped function name, unit or keyword could be read as a different value';
const ESCAPE_FIX = 'Write the function name, unit or keyword without backslash escapes.';
/** The grid-line properties, where an identifier that is not a keyword is a custom line name. */
const LINE_PROPERTIES: ReadonlySet<string> = new Set(['grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end', 'grid-row', 'grid-column', 'grid-area']);

/**
 * Fails closed on escapes: an escaped function name, unit or keyword is refused. Custom line names (in brackets, or a grid line's
 * name) and area strings keep their escaped text, which Chrome 145 reads as the same name (T113 probe).
 */
function escaped(property: string, t: CssNode, inNames: boolean): boolean {
  if (t.type === 'Function') return String(t['name']).includes('\\');
  if (t.type === 'Dimension') return String(t['unit']).includes('\\');
  if (t.type !== 'Identifier' || inNames) return false;
  const raw = String(t['name']);
  if (!raw.includes('\\')) return false;
  return !LINE_PROPERTIES.has(property) || reservedName(t);
}

/**
 * The first token Dragon cannot express: an escaped function name, unit or keyword, a unit with no build-time conversion or a math
 * function at any depth, or the top-level subgrid keyword of a track list.
 */
function refusal(property: string, tokens: readonly CssNode[], base: Span, top = true, inNames = false): ParsedValue | null {
  for (const t of tokens) {
    let found: { reason: string; fix: string } | null = null;
    if (escaped(property, t, inNames)) found = { reason: ESCAPE_REASON, fix: ESCAPE_FIX };
    else if (t.type === 'Dimension') found = unitRefusal(normalizeUnit(String(t['unit'])));
    else if (t.type === 'Function') found = mathFunctionRefusal(String(t['name']));
    else if (top && SUBGRID_PROPERTIES.has(property) && lowerIdent(t) === 'subgrid') found = { reason: SUBGRID_REASON, fix: 'Give the element its own track list.' };
    if (found !== null) {
      return { kind: 'refused', diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(spanOf(t, base)), message: `${property}: ${generate(t)} is unsupported: ${found.reason}`, manual: found.fix }) };
    }
    if (t.type === 'Function' || t.type === 'Brackets') {
      const inner = refusal(property, children(t), base, false, t.type === 'Brackets');
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

/** A grid line's <custom-ident> as written (escapes kept), or null when it is not one. */
function lineName(n: CssNode | undefined): string | null {
  const name = ident(n);
  return name === null || reservedName(n as CssNode) ? null : name;
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
  const parts = [line.span ? 'span' : null, line.integer === null ? null : String(line.integer), line.name].filter((p) => p !== null);
  const type = [line.span ? 'span' : null, line.integer === null ? null : 'integer', line.name === null ? null : 'custom-ident'].filter((p) => p !== null).join('-');
  return other(type, parts.join(' '));
}

/** css-grid-2 §8.4: an omitted end line copies a start line that is a lone <custom-ident>, and is auto otherwise. */
const copied = (line: GridLine | 'auto'): GridLine | 'auto' => (line !== 'auto' && !line.span && line.integer === null ? line : 'auto');

// ---- Track lists ---------------------------------------------------------------------------------------------------------

const isFixedBreadth = (n: CssNode | undefined): boolean =>
  n !== undefined && (n.type === 'Percentage' || n.type === 'Number' || (n.type === 'Dimension' && normalizeUnit(String(n['unit'])) !== 'fr'));

/** css-grid-2 §7.2.3: <fixed-size>, a fixed breadth or a minmax() with one fixed side. */
function isFixedSize(n: CssNode): boolean {
  if (isFixedBreadth(n)) return true;
  if (n.type !== 'Function' || String(n['name']).toLowerCase() !== 'minmax') return false;
  const args = children(n).filter((c) => !(c.type === 'Operator' && c['value'] === ','));
  return isFixedBreadth(args[0]) || isFixedBreadth(args[1]);
}

/** Line names may not be reserved names (Blink ConsumeGridLineNames); the webref grammar allows span and auto, and escaped forms of all. */
const badLineNames = (tokens: readonly CssNode[]): boolean =>
  tokens.some((t) => (t.type === 'Brackets' && children(t).some(reservedName)) || (t.type === 'Function' && badLineNames(children(t))));

/** A grid-template-rows or -columns value, or null when Chrome drops it. */
function templateValue(tokens: readonly CssNode[]): CssValue | null {
  if (tokens.length === 1 && lowerIdent(tokens[0]) === 'none') return kw('none');
  if (badLineNames(tokens)) return null;
  const autoRepeat = tokens.find((t) => t.type === 'Function' && String(t['name']).toLowerCase() === 'repeat' && ['auto-fill', 'auto-fit'].includes(lowerIdent(children(t)[0]) ?? ''));
  // css-grid-2 §7.2.3.2: an automatic repetition takes only fixed sizes (webref's <auto-repeat> says <track-size>).
  if (autoRepeat !== undefined && !children(autoRepeat).slice(2).every((c) => c.type === 'Brackets' || isFixedSize(c))) return null;
  return other(autoRepeat === undefined ? 'track-list' : 'auto-track-list', tracksText(tokens));
}

/** A grid-auto-rows or -columns value. */
function autoTracksValue(tokens: readonly CssNode[]): CssValue {
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

/**
 * css-align-3 §6.1, §6.2 as Chrome 145 parses them: [first | last]? baseline with the prefix first ("first baseline" is
 * "baseline"), an overflow position only before a self position, left or right (never before normal), and legacy with left,
 * right or center in either order, written "legacy <position>".
 */
function alignmentValue(tokens: readonly CssNode[]): CssValue | null {
  const names = tokens.map((t) => lowerIdent(t) ?? '');
  if (names.includes('baseline')) {
    if (names[names.length - 1] !== 'baseline') return null;
    return kw(names[0] === 'last' ? 'last baseline' : 'baseline');
  }
  if (names.includes('legacy')) return kw(names.length === 1 ? 'legacy' : `legacy ${names.find((n) => n !== 'legacy') as string}`);
  if ((names[0] === 'safe' || names[0] === 'unsafe') && names[1] === 'normal') return null;
  return kw(names.join(' '));
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
  // row and the leading names of the next are one set of line names.
  const strings: string[] = [];
  const rowText: string[] = [];
  let names: string[] = [];
  let sized = true;
  for (const t of before) {
    if (t.type === 'Brackets') {
      names.push(...children(t).map((c) => String(c['name'])));
    } else if (t.type === 'String') {
      if (!sized) rowText.push('auto');
      if (names.length > 0) rowText.push(`[${names.join(' ')}]`);
      names = [];
      strings.push(stringOf(t));
      sized = false;
    } else {
      rowText.push(trackText(t, keepDimension));
      sized = true;
    }
  }
  if (!sized) rowText.push('auto');
  if (names.length > 0) rowText.push(`[${names.join(' ')}]`);
  if (badLineNames(before)) return null;
  const areas = areasValue(strings);
  const columns = after === undefined ? kw('none') : templateValue(after);
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
  const flow = parts[flowSide] as CssNode[];
  const dense = flow.some((t) => lowerIdent(t) === 'dense');
  const sizes = flow.filter((t) => !['auto-flow', 'dense'].includes(lowerIdent(t) ?? ''));
  const template = templateValue(parts[1 - flowSide] as CssNode[]);
  if (template === null || badLineNames(sizes)) return null;
  const rowFlow = flowSide === 0;
  const autoSizes = sizes.length === 0 ? null : autoTracksValue(sizes);
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
      return one(property, tokens.length === 1 && lowerIdent(tokens[0]) === 'none' ? kw('none') : areasValue(tokens.map(stringOf)));
    case 'grid-auto-columns':
    case 'grid-auto-rows':
      return badLineNames(tokens) ? null : one(property, autoTracksValue(tokens));
    case 'grid-auto-flow': {
      const names = tokens.map((t) => lowerIdent(t) ?? '');
      const dense = names.includes('dense');
      return one(property, kw(names.includes('column') ? (dense ? 'column dense' : 'column') : (dense ? 'dense' : 'row')));
    }
    case 'grid-row-start':
    case 'grid-row-end':
    case 'grid-column-start':
    case 'grid-column-end': {
      const line = gridLine(tokens);
      return one(property, line === null ? null : lineValue(line));
    }
    case 'justify-items':
    case 'justify-self':
      return one(property, alignmentValue(tokens));
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

const TRACKS_REASON = 'line names may not be span, auto, default or a CSS-wide keyword, and an automatic repetition takes only fixed sizes (css-grid-2 §7.2)';
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
