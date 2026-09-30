// Grid lowering (GRID G1a): the computed grid values of a grid container and its items to the engine's grid input. Line names
// and template areas are static, so the compiler resolves every item line here (Blink GridLineResolver, grid_line_resolver.cc at
// Chrome 145.0.7632.6) and the engine sees only line numbers: css-grid-2 §8.3 placement, §7.3 implicit area names.
import type { CssNode } from 'css-tree';
import { ident as cssIdent, parse } from 'css-tree';
import type { GridContainerStyle, GridItemStyle, GridSelfAlign, GridSpan, TrackBreadth, TrackRepeater, TrackSize } from '@dragon/layout';
import { list } from '../css/ast.ts';
import { serializeIdentifier } from '../css/grid-values.ts';
import type { Longhand } from '../css/properties.ts';
import type { CssValue } from '../css/stylesheet.ts';
import { valueToString } from '../analysis/resolve.ts';

/** Blink kGridMaxTracks (core/style/grid_area.h). */
const GRID_MAX_TRACKS = 10000000;
/** The most line-name positions a track list may expand to; a longer named repeat() is refused rather than expanded. */
const MAX_NAMED_LINES = 100000;

export class GridLoweringError extends Error {
  readonly property: Longhand;
  constructor(property: Longhand, message: string) {
    super(message);
    this.property = property;
  }
}

type Get = (p: Longhand) => CssValue;

const children = (n: CssNode): CssNode[] => list(n, 'children').filter((c) => c.type !== 'WhiteSpace');

function tokensOf(text: string): CssNode[] {
  return children(parse(text, { context: 'value' }));
}

/** Arguments of a function node split at top-level commas. */
function argsOf(n: CssNode): CssNode[][] {
  const parts: CssNode[][] = [[]];
  for (const c of children(n)) {
    if (c.type === 'Operator' && c['value'] === ',') parts.push([]);
    else (parts[parts.length - 1] as CssNode[]).push(c);
  }
  return parts;
}

const refuse = (p: Longhand, v: CssValue | string, why: string): never => {
  throw new GridLoweringError(p, `${p}: ${typeof v === 'string' ? v : valueToString(v)} has no grid layout mapping: ${why}`);
};

function breadth(p: Longhand, n: CssNode | undefined): TrackBreadth {
  if (n === undefined) return refuse(p, '(missing)', 'a track breadth is missing');
  if (n.type === 'Identifier') {
    const k = String(n['name']).toLowerCase();
    if (k === 'auto') return { kind: 'auto' };
    if (k === 'min-content') return { kind: 'min-content' };
    if (k === 'max-content') return { kind: 'max-content' };
  }
  if (n.type === 'Dimension') {
    const unit = String(n['unit']).toLowerCase();
    const value = Number(n['value']);
    if (unit === 'px') return { kind: 'px', value };
    if (unit === 'fr') return { kind: 'fr', value };
  }
  if (n.type === 'Percentage') return { kind: 'percent', value: Number(n['value']) };
  return refuse(p, String(n.type), 'expected px, %, fr, auto, min-content or max-content');
}

function lengthPercentage(p: Longhand, n: CssNode | undefined): { readonly kind: 'px'; readonly value: number } | { readonly kind: 'percent'; readonly value: number } {
  const b = breadth(p, n);
  if (b.kind === 'px' || b.kind === 'percent') return b;
  return refuse(p, b.kind, 'fit-content() takes a length or percentage');
}

/** A <track-size> token. css-grid-2 §7.2.1: a flexible minimum is invalid, and the computed text writes minmax(auto, <flex>) as the <flex>. */
function trackSize(p: Longhand, n: CssNode): TrackSize {
  if (n.type === 'Function') {
    const name = String(n['name']).toLowerCase();
    const args = argsOf(n);
    if (name === 'minmax' && args.length === 2 && args[0]?.length === 1 && args[1]?.length === 1) {
      const min = breadth(p, args[0][0]);
      const max = breadth(p, args[1][0]);
      if (min.kind === 'fr') return refuse(p, 'minmax()', 'a flexible minimum');
      return { kind: 'minmax', min, max };
    }
    if (name === 'fit-content' && args.length === 1 && args[0]?.length === 1) return { kind: 'fit-content', limit: lengthPercentage(p, args[0][0]) };
    return refuse(p, `${name}()`, 'expected minmax() or fit-content()');
  }
  return { kind: 'breadth', breadth: breadth(p, n) };
}

/** The names at each line of a track list, as serialized identifiers (the form placements carry). */
type NamedLines = Map<string, number[]>;

function addName(names: NamedLines, name: string, line: number, p: Longhand, count: { n: number }): void {
  count.n++;
  if (count.n > MAX_NAMED_LINES) refuse(p, 'repeat()', `a track list names more than ${MAX_NAMED_LINES} lines`);
  const at = names.get(name);
  if (at === undefined) names.set(name, [line]);
  else if (at[at.length - 1] !== line) at.push(line);
}

const namesIn = (n: CssNode): string[] => children(n).map((c) => serializeIdentifier(cssIdent.decode(String(c['name']))));

type TrackList = { readonly repeaters: TrackRepeater[]; readonly names: NamedLines; readonly trackCount: number };

/** A computed grid-template-columns or -rows value (none or a <track-list>); an automatic repetition is not supported yet. */
function trackList(p: Longhand, v: CssValue): TrackList {
  const names: NamedLines = new Map();
  if (v.kind === 'keyword' && v.value === 'none') return { repeaters: [], names, trackCount: 0 };
  if (v.kind !== 'other' || v.type !== 'track-list') return refuse(p, v, v.kind === 'other' && v.type === 'auto-track-list' ? 'repeat(auto-fill) and repeat(auto-fit) are not supported yet' : 'expected none or a track list');
  const repeaters: TrackRepeater[] = [];
  const count = { n: 0 };
  let line = 0;
  for (const t of tokensOf(v.text)) {
    if (t.type === 'Brackets') {
      for (const name of namesIn(t)) addName(names, name, line, p, count);
      continue;
    }
    if (t.type === 'Function' && String(t['name']).toLowerCase() === 'repeat') {
      const [countArg, inner] = argsOf(t);
      const repetitions = Number(countArg?.[0]?.['value']);
      if (countArg?.length !== 1 || !Number.isInteger(repetitions) || repetitions < 1 || inner === undefined) return refuse(p, v, 'expected repeat(<integer>, <track-list>)');
      const sizes: TrackSize[] = [];
      const offsets: { name: string; at: number }[] = [];
      for (const c of inner) {
        if (c.type === 'Brackets') for (const name of namesIn(c)) offsets.push({ name, at: sizes.length });
        else sizes.push(trackSize(p, c));
      }
      if (sizes.length === 0) return refuse(p, v, 'repeat() holds no track size');
      for (let k = 0; k < repetitions && offsets.length > 0; k++) for (const o of offsets) addName(names, o.name, line + k * sizes.length + o.at, p, count);
      repeaters.push({ count: repetitions, sizes });
      line += repetitions * sizes.length;
      continue;
    }
    repeaters.push({ count: 1, sizes: [trackSize(p, t)] });
    line++;
  }
  if (line > GRID_MAX_TRACKS) return refuse(p, v, `more than ${GRID_MAX_TRACKS} tracks`);
  for (const lines of names.values()) lines.sort((a, b) => a - b);
  return { repeaters, names, trackCount: line };
}

/** A computed grid-auto-columns or -rows value: one or more track sizes. */
function autoTracks(p: Longhand, v: CssValue): TrackSize[] {
  if (v.kind === 'keyword') {
    if (v.value === 'auto' || v.value === 'min-content' || v.value === 'max-content') return [{ kind: 'breadth', breadth: { kind: v.value } }];
    return refuse(p, v, 'expected track sizes');
  }
  if (v.kind !== 'other' || (v.type !== 'track-size' && v.type !== 'track-size-list')) return refuse(p, v, 'expected track sizes');
  return tokensOf(v.text).map((t) => trackSize(p, t));
}

/** A named area of grid-template-areas, in 0-based lines, keyed by its cell name. */
type Area = { readonly rowStart: number; readonly rowEnd: number; readonly columnStart: number; readonly columnEnd: number };

type Areas = { readonly rows: number; readonly columns: number; readonly areas: Map<string, Area> };

/** css-grid-2 §7.3: the computed areas value, which the parser has already checked is rectangular. */
function templateAreas(v: CssValue): Areas {
  const areas = new Map<string, Area>();
  if (v.kind === 'keyword' && v.value === 'none') return { rows: 0, columns: 0, areas };
  if (v.kind !== 'other' || v.type !== 'string') return refuse('grid-template-areas', v, 'expected none or strings');
  const rows = tokensOf(v.text).map((t) => String(t['value']).split(' ').filter((c) => c !== ''));
  if (rows.length === 0 || rows.some((r) => r.length === 0 || r.length !== (rows[0] as string[]).length)) return refuse('grid-template-areas', v, 'the rows are not a rectangle of cells');
  rows.forEach((cells, y) => cells.forEach((cell, x) => {
    if (cell === '.') return;
    const a = areas.get(cell);
    areas.set(cell, a === undefined ? { rowStart: y, rowEnd: y + 1, columnStart: x, columnEnd: x + 1 } : { rowStart: a.rowStart, rowEnd: y + 1 > a.rowEnd ? y + 1 : a.rowEnd, columnStart: a.columnStart, columnEnd: x + 1 > a.columnEnd ? x + 1 : a.columnEnd });
  }));
  return { rows: rows.length, columns: (rows[0] as string[]).length, areas };
}

/** Blink ComputedGridTemplateAreas::CreateImplicitNamedGridLinesFromGridArea: <area>-start and <area>-end lines. */
function implicitAreaLines(areas: Areas, axis: 'columns' | 'rows'): NamedLines {
  const out: NamedLines = new Map();
  const add = (name: string, line: number): void => {
    const at = out.get(name);
    if (at === undefined) out.set(name, [line]);
    else if (!at.includes(line)) at.push(line);
  };
  for (const [name, a] of areas.areas) {
    add(serializeIdentifier(`${name}-start`), axis === 'columns' ? a.columnStart : a.rowStart);
    add(serializeIdentifier(`${name}-end`), axis === 'columns' ? a.columnEnd : a.rowEnd);
  }
  for (const lines of out.values()) lines.sort((x, y) => x - y);
  return out;
}

/** One axis of a grid container's line resolver. */
type AxisLines = { readonly explicitCount: number; readonly explicitNames: NamedLines; readonly implicitNames: NamedLines };

/** A grid container's resolved grid input and the line resolver its items use. */
export type GridContainer = { readonly style: GridContainerStyle; readonly columns: AxisLines; readonly rows: AxisLines };

const ITEM_ALIGN: readonly GridSelfAlign[] = ['normal', 'stretch', 'start', 'end', 'center', 'self-start', 'self-end', 'flex-start', 'flex-end', 'left', 'right'];

/**
 * A justify-items or justify-self value as a grid self position. legacy <position> aligns grid items by the position; unsafe is
 * Chrome's default overflow behaviour for grid items; safe, baseline and anchor-center are not supported yet.
 */
function selfAlign(p: Longhand, v: CssValue, allowAuto: boolean): GridSelfAlign | 'auto' {
  if (v.kind !== 'keyword') return refuse(p, v, 'expected a keyword');
  let k = v.value;
  if (k.startsWith('legacy ')) k = k.slice('legacy '.length);
  else if (k.startsWith('unsafe ')) k = k.slice('unsafe '.length);
  if (allowAuto && k === 'auto') return 'auto';
  if ((ITEM_ALIGN as readonly string[]).includes(k)) return k as GridSelfAlign;
  return refuse(p, v, 'safe alignment, baseline alignment and anchor-center in a grid are not supported yet');
}

/** css-grid-2 §7: the grid input of a display: grid element. */
export function lowerGridContainer(get: Get): GridContainer {
  const columns = trackList('grid-template-columns', get('grid-template-columns'));
  const rows = trackList('grid-template-rows', get('grid-template-rows'));
  const areas = templateAreas(get('grid-template-areas'));
  const flow = get('grid-auto-flow');
  if (flow.kind !== 'keyword' || !['row', 'column', 'dense', 'column dense'].includes(flow.value)) return refuse('grid-auto-flow', flow, 'expected row, column, dense or column dense');
  const justifyItems = selfAlign('justify-items', get('justify-items'), false) as GridSelfAlign;
  const explicitColumnCount = minOf(maxOf(columns.trackCount, areas.columns), GRID_MAX_TRACKS);
  const explicitRowCount = minOf(maxOf(rows.trackCount, areas.rows), GRID_MAX_TRACKS);
  return {
    style: {
      templateColumns: columns.repeaters,
      templateRows: rows.repeaters,
      autoColumns: autoTracks('grid-auto-columns', get('grid-auto-columns')),
      autoRows: autoTracks('grid-auto-rows', get('grid-auto-rows')),
      explicitColumnCount,
      explicitRowCount,
      autoFlow: flow.value.startsWith('column') ? 'column' : 'row',
      dense: flow.value.endsWith('dense'),
      justifyItems,
    },
    columns: { explicitCount: explicitColumnCount, explicitNames: columns.names, implicitNames: implicitAreaLines(areas, 'columns') },
    rows: { explicitCount: explicitRowCount, explicitNames: rows.names, implicitNames: implicitAreaLines(areas, 'rows') },
  };
}

const maxOf = (a: number, b: number): number => (a > b ? a : b);
const minOf = (a: number, b: number): number => (a < b ? a : b);

// ---- Line resolution (Blink GridLineResolver, GridNamedLineCollection; no automatic repetition) --------------------------------

/** Blink GridPosition: auto, an explicit <integer> [<name>], span <integer> [<name>], or a lone <name> (kNamedGridAreaPosition). */
type Position =
  | { readonly kind: 'auto' }
  | { readonly kind: 'explicit'; readonly n: number; readonly name: string | null }
  | { readonly kind: 'span'; readonly n: number; readonly name: string | null }
  | { readonly kind: 'area'; readonly name: string };

/** A computed grid line value, written span first, then the integer, then the name (grid-values.ts lineValue). */
function positionOf(p: Longhand, v: CssValue): Position {
  if (v.kind === 'keyword' && v.value === 'auto') return { kind: 'auto' };
  if (v.kind !== 'other') return refuse(p, v, 'expected a grid line');
  const words = v.text.split(' ');
  const span = words[0] === 'span';
  const rest = span ? words.slice(1) : words;
  const integer = rest[0] !== undefined && /^[+-]?\d+$/.test(rest[0]) ? Number(rest[0]) : null;
  const nameParts = integer === null ? rest : rest.slice(1);
  const name = nameParts.length === 0 ? null : nameParts.join(' ');
  if (span) {
    const n = integer === null ? 1 : integer;
    if (n < 1) return refuse(p, v, 'a span is a positive integer');
    return { kind: 'span', n, name };
  }
  if (integer !== null) {
    if (integer === 0) return refuse(p, v, 'a grid line integer is never 0');
    return { kind: 'explicit', n: integer, name };
  }
  if (name === null) return refuse(p, v, 'expected a grid line');
  return { kind: 'area', name };
}

type LineCollection = { readonly lines: readonly number[]; readonly set: ReadonlySet<number>; readonly last: number };

function collectionOf(axis: AxisLines, name: string): LineCollection {
  const all = [...(axis.explicitNames.get(name) ?? []), ...(axis.implicitNames.get(name) ?? [])].sort((a, b) => a - b);
  return { lines: all, set: new Set(all), last: axis.explicitCount };
}

// A Set: the look-ahead and look-back walks visit up to kGridMaxTracks lines.
const contains = (c: LineCollection, line: number): boolean => line <= c.last && c.set.has(line);

/** Blink LookAheadForNamedGridLine. */
function lookAhead(start: number, count: number, c: LineCollection): number {
  let end = maxOf(start, 0);
  if (c.lines.length === 0) {
    end = maxOf(end, c.last + 1);
    return end + count - 1;
  }
  let left = count;
  for (; left > 0; end++) if (end > c.last || contains(c, end)) left--;
  return end - 1;
}

/** Blink LookBackForNamedGridLine. */
function lookBack(end: number, count: number, c: LineCollection): number {
  let start = minOf(end, c.last);
  if (c.lines.length === 0) {
    start = minOf(start, -1);
    return start - count + 1;
  }
  let left = count;
  for (; left > 0; start--) if (start < 0 || contains(c, start)) left--;
  return start + 1;
}

/** Blink ResolveGridPosition for a definite position on one side. */
function resolvePosition(axis: AxisLines, pos: Position, start: boolean): number {
  if (pos.kind === 'explicit') {
    if (pos.name !== null) {
      const c = collectionOf(axis, pos.name);
      return pos.n > 0 ? lookAhead(0, pos.n, c) : lookBack(axis.explicitCount, -pos.n, c);
    }
    return pos.n > 0 ? pos.n - 1 : axis.explicitCount - (-pos.n - 1);
  }
  if (pos.kind === 'area') {
    const implicit = collectionOf(axis, serializeIdentifier(`${cssIdent.decode(pos.name)}${start ? '-start' : '-end'}`));
    if (implicit.lines.length > 0) return implicit.lines[0] as number;
    const explicit = collectionOf(axis, pos.name);
    if (explicit.lines.length > 0) return explicit.lines[0] as number;
    return axis.explicitCount + 1;
  }
  throw new Error(`a ${pos.kind} position resolves against the opposite position`);
}

/** Blink ResolveGridPositionAgainstOppositePosition for auto and span positions. */
function againstOpposite(axis: AxisLines, opposite: number, pos: Position, start: boolean): [number, number] {
  if (pos.kind === 'auto') return start ? [opposite - 1, opposite] : [opposite, opposite + 1];
  if (pos.kind !== 'span') throw new Error('only auto and span resolve against the opposite position');
  if (pos.name !== null) {
    const c = collectionOf(axis, pos.name);
    return start ? [lookBack(opposite - 1, pos.n, c), opposite] : [opposite, lookAhead(opposite + 1, pos.n, c)];
  }
  return start ? [opposite - pos.n, opposite] : [opposite, opposite + pos.n];
}

const clampLine = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/** Blink GridSpan::UntranslatedDefiniteGridSpan: lines clamped to kGridMaxTracks. */
function definite(start: number, end: number): GridSpan {
  const s = clampLine(start, -GRID_MAX_TRACKS, GRID_MAX_TRACKS - 1);
  return { kind: 'definite', start: s, end: clampLine(end, s + 1, GRID_MAX_TRACKS) };
}

/** Blink GridLineResolver::ResolveGridPositionsFromStyle for one axis of an item. */
function resolveAxis(axis: AxisLines, startProp: Longhand, endProp: Longhand, get: Get): GridSpan {
  let initial = positionOf(startProp, get(startProp));
  let final = positionOf(endProp, get(endProp));
  if (initial.kind === 'span' && final.kind === 'span') final = { kind: 'auto' };
  if (initial.kind === 'auto' && final.kind === 'span' && final.name !== null) final = { kind: 'span', n: 1, name: null };
  if (final.kind === 'auto' && initial.kind === 'span' && initial.name !== null) initial = { kind: 'span', n: 1, name: null };
  const initialOpposite = initial.kind === 'auto' || initial.kind === 'span';
  const finalOpposite = final.kind === 'auto' || final.kind === 'span';
  if (initialOpposite && finalOpposite) {
    const span = initial.kind === 'auto' && final.kind === 'auto' ? 1 : initial.kind === 'span' ? initial.n : final.kind === 'span' ? final.n : 1;
    return { kind: 'auto', span: clampLine(span, 1, GRID_MAX_TRACKS) };
  }
  if (initialOpposite) {
    const end = resolvePosition(axis, final, false);
    const [s, e] = againstOpposite(axis, end, initial, true);
    return definite(s, e);
  }
  if (finalOpposite) {
    const start = resolvePosition(axis, initial, true);
    const [s, e] = againstOpposite(axis, start, final, false);
    return definite(s, e);
  }
  let start = resolvePosition(axis, initial, true);
  let end = resolvePosition(axis, final, false);
  if (end < start) [start, end] = [end, start];
  else if (end === start) end = start + 1;
  return definite(start, end);
}

/** css-grid-2 §8: an in-flow grid item's placement and justify-self. */
export function lowerGridItem(container: GridContainer, get: Get): GridItemStyle {
  return {
    column: resolveAxis(container.columns, 'grid-column-start', 'grid-column-end', get),
    row: resolveAxis(container.rows, 'grid-row-start', 'grid-row-end', get),
    justifySelf: selfAlign('justify-self', get('justify-self'), true),
  };
}

/** The placement of an anonymous grid item: automatic in both axes, justify-self auto. */
export const ANONYMOUS_GRID_ITEM: GridItemStyle = { column: { kind: 'auto', span: 1 }, row: { kind: 'auto', span: 1 }, justifySelf: 'auto' };
