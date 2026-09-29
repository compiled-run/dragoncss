// css-grid-2 grid layout, ported from Blink 145.0.7632.6 (third_party/blink/renderer/core/layout/grid): placement
// (grid_placement.cc), ranges and sets (grid_track_collection.cc), the track sizing algorithm (grid_track_sizing_algorithm.cc) and
// geometry, contributions and item placement (grid_layout_algorithm.cc). Chrome sizes runs of identical tracks as one set, so
// every share and alignment rounds per set (docs/research/grid-spike/blink-notes.md GR1-GR18). Written in logical inline/block
// terms for horizontal-tb: columns are the inline axis and rows the block axis; rtl mirrors the inline offsets at the end.
import type {
  Direction,
  GridContainerStyle,
  GridSelfAlign,
  GridSpan,
  LayoutBox,
  LayoutStyle,
  Percent,
  Px,
  TrackBreadth,
  TrackRepeater,
  TrackSize,
} from './input.ts';
import type { LU } from './units.ts';
import {
  add,
  clampNegativeToZero,
  divInt,
  doubleLeftover,
  doubleQuotient,
  doubleShare,
  doubleShareToLu,
  equalShare,
  flexSumAdd,
  flexSumSub,
  floatMul,
  floatNearlyEqual,
  frLeftover,
  frShareToLu,
  fromCssPx,
  intDiv,
  intMod,
  mightBeSaturated,
  mulInt,
  percentOf,
  rawOverFloat,
  rawTimesFloat,
  setFlexFactor,
  sub,
  weightedShare,
  ZERO,
} from './units.ts';
import type { Edges, Frag, HeightBasis, MinMax, OutOfFlow, Placed } from './box.ts';
import {
  blockMinMax,
  borderBoxFromSpecified,
  constrain,
  contentBox,
  inlineMinMax,
  isScrollContainer,
  resolveBorder,
  resolveInlineLength,
  resolveMargin,
  resolvePadding,
  sumEdges,
} from './box.ts';
import type { Ctx } from './block.ts';
import { directionOf, layoutContents } from './block.ts';
import { intrinsicContentInlineSize } from './intrinsic.ts';
import { isOutOfFlow, relativeOffset } from './position.ts';
import { unsupported } from './unsupported.ts';

/** Blink kIndefiniteSize: LayoutUnit(-1), an indefinite size or an infinite growth limit. */
const INDEFINITE: LU = -64 as LU;
/** Blink kNotFound for set indices. */
const NOT_FOUND = -1;
/** Blink kGridMaxTracks (core/style/grid_area.h). */
const GRID_MAX_TRACKS = 10000000;
/** A line past every real line (Blink's kNotFound as an unsigned line): auto-placement can place lines beyond kGridMaxTracks. */
const NO_LINE = 9007199254740991;
const LU_MAX: LU = 2147483647 as LU;

/**
 * Seeded grid engine errors, each a planted fault of docs/research/grid-spike/blink-notes.md in G1a's scope, so the G-P
 * differential test (packages/parity/test/grid-corpus.test.ts) proves it catches them. The product runs with NO_GRID_FAULTS.
 */
export type GridFaults = {
  /** autoPlacementNotDense: dense packing keeps the cursor like sparse packing. */
  readonly denseAsSparse: boolean;
  /** sparseCursorRewinds: sparse packing restarts the cursor for every item. */
  readonly sparseRewinds: boolean;
  /** implicitBeforeCyclesForward: implicit tracks before the explicit grid take grid-auto-* sizes forwards. */
  readonly implicitForward: boolean;
  /** shareRounded: an equal share of extra space rounds to the nearest unit instead of truncating. */
  readonly shareRounded: boolean;
  /** gutterNotInSpannedSize: a spanning item's spanned size leaves out the gutters it crosses. */
  readonly gutterNotInSpan: boolean;
  /** flexSpanWeightedAsEqual: an item spanning flexible tracks shares its space equally, not by flex factor. */
  readonly flexSpanEqual: boolean;
  /** spanGroupingFlat: every non-flexible item forms one group, whatever its span. */
  readonly spanGroupingFlat: boolean;
  /** maximizeIgnoresGrowthLimit: maximize shares the free space equally with no growth limits. */
  readonly maximizeIgnoresLimit: boolean;
  /** flexSumBelowOneNotClamped: the flex factor sum stays below 1 when finding the fr size. */
  readonly flexSumBelowOne: boolean;
  /** frRestartMissing: flexible tracks whose base size exceeds their share stay flexible. */
  readonly frRestartMissing: boolean;
  /** frLeftoverFloat64: the fr share is computed in double. */
  readonly frFloat64: boolean;
  /** frLeftoverDropped: the fractional part of each fr share is dropped instead of carried. */
  readonly frLeftoverDropped: boolean;
  /** autoMinNotClamped: the automatic minimum is not clamped to the spanned fixed maximum. */
  readonly autoMinNotClamped: boolean;
  /** fitContentAsAuto: fit-content() tracks size as auto. */
  readonly fitContentAsAuto: boolean;
  /** stretchIgnoresContentAlignment: auto tracks stretch whatever the content alignment. */
  readonly stretchIgnoresAlignment: boolean;
  /** stretchIndefiniteIgnoresMinSize: an indefinite size stretches auto tracks by nothing, ignoring min-width/height. */
  readonly stretchIgnoresMinSize: boolean;
  /** percentGapNotReresolved and percentTrackNotReresolved: no second pass once the block size is resolved. */
  readonly percentNotReresolved: boolean;
  /** contentDistributionRounded: content distribution rounds its shares instead of truncating. */
  readonly distributionRounded: boolean;
  /** centerNegativeFloors: centering floors half a negative free space instead of truncating toward zero. */
  readonly centerFloors: boolean;
  /** Spec reading of Chrome deviation grid-maximize-no-max-redo (css-grid-2 §12.6): redo maximize against max-height. */
  readonly maximizeRedoSpec: boolean;
};

export const NO_GRID_FAULTS: GridFaults = {
  denseAsSparse: false,
  sparseRewinds: false,
  implicitForward: false,
  shareRounded: false,
  gutterNotInSpan: false,
  flexSpanEqual: false,
  spanGroupingFlat: false,
  maximizeIgnoresLimit: false,
  flexSumBelowOne: false,
  frRestartMissing: false,
  frFloat64: false,
  frLeftoverDropped: false,
  autoMinNotClamped: false,
  fitContentAsAuto: false,
  stretchIgnoresAlignment: false,
  stretchIgnoresMinSize: false,
  percentNotReresolved: false,
  distributionRounded: false,
  centerFloors: false,
  maximizeRedoSpec: false,
};

export type GridArgs = {
  readonly pad: Edges;
  readonly bor: Edges;
  readonly contentWidth: LU;
  readonly definiteInnerHeight: LU | null;
  readonly innerHeightMinMax: MinMax;
};

/** baseline: the container's first baseline from its border-box top, or null with no items. */
export type GridResult = { readonly contentHeight: LU; readonly placed: readonly Placed[]; readonly baseline: LU | null; readonly outOfFlow: readonly OutOfFlow[] };

type GridAxis = 'columns' | 'rows';
type GridSizing = 'layout' | 'min-content' | 'max-content';
type GridContributionType = 'intrinsic-minimums' | 'content-based-minimums' | 'max-content-minimums' | 'intrinsic-maximums' | 'max-content-maximums' | 'free-space';
type GridAxisEdge = 'start' | 'center' | 'end';
/** An item's alignment in one axis: the edge, whether an auto size stretches, and whether overflow is safe (auto margins only). */
type GridAlignment = { readonly edge: GridAxisEdge; readonly stretch: boolean; readonly safe: boolean };
type GridDependentItem = { readonly sets: GridSetIndices; readonly cached: LU };
type GridKeyedSet = { readonly s: GridSet; readonly i: number; readonly p: LU };
type GridIndexedSet = { readonly s: GridSet; readonly i: number };
type GridIndexedItem = { readonly item: GridItemData; readonly k: number };
type GridIndexedBox = { readonly b: LayoutBox; readonly i: number };

/** Blink TrackSpanProperties, for a range and for the tracks an item spans. */
type GridProps = {
  autoMin: boolean;
  fixedMax: boolean;
  fixedMin: boolean;
  flexible: boolean;
  intrinsic: boolean;
  nonDefinite: boolean;
  dependent: boolean;
};

/** Blink GridTrackSize: min and max breadths, or fit-content (min and max auto, with the limit). */
type GridTrack = { readonly fitContent: boolean; readonly min: TrackBreadth; readonly max: TrackBreadth; readonly limit: Px | Percent | null };

type GridSet = {
  readonly trackCount: number;
  readonly track: GridTrack;
  baseSize: LU;
  growthLimit: LU;
  plannedIncrease: LU;
  fitContentLimit: LU;
  itemIncurredIncrease: LU;
  infinitelyGrowable: boolean;
};

type GridRange = {
  readonly startLine: number;
  readonly trackCount: number;
  readonly beginSetIndex: number;
  readonly setCount: number;
  readonly repeaterIndex: number;
  readonly repeaterOffset: number;
  readonly implicit: boolean;
  props: GridProps;
};

type GridSetGeometry = { readonly offset: LU; readonly trackCount: number };

/** A GridSizingTrackCollection: ranges, the sets they hold, the gutter and the cached set geometry. */
type GridCollection = {
  readonly axis: GridAxis;
  readonly ranges: readonly GridRange[];
  sets: GridSet[];
  gutter: LU;
  geometry: GridSetGeometry[];
  lastIndefinite: number[];
  props: GridProps;
  readonly nonCollapsedTrackCount: number;
};

type GridLines = { readonly start: number; readonly end: number };
type GridSetIndices = { readonly begin: number; readonly end: number };

/** Blink GridItemData for one in-flow item, both axes. */
type GridItemData = {
  readonly box: LayoutBox;
  readonly index: number;
  column: GridLines;
  row: GridLines;
  columnSets: GridSetIndices;
  rowSets: GridSetIndices;
  columnProps: GridProps;
  rowProps: GridProps;
  readonly columnEdge: GridAxisEdge;
  readonly rowEdge: GridAxisEdge;
  readonly columnSafe: boolean;
  readonly rowSafe: boolean;
  readonly columnStretch: boolean;
  readonly rowStretch: boolean;
  sizingDependsOnBlockSize: boolean;
};

/** The grid container's content-box sizes: available (definite or INDEFINITE) and the min and max for an indefinite size. */
type GridAvailable = { inline: LU; block: LU; minInline: LU; minBlock: LU; maxInline: LU; maxBlock: LU };

type GridState = {
  readonly box: LayoutBox;
  readonly style: LayoutStyle;
  readonly grid: GridContainerStyle;
  readonly rtl: boolean;
  readonly bsp: Edges;
  readonly items: GridItemData[];
  readonly columns: GridCollection;
  readonly rows: GridCollection;
  readonly available: GridAvailable;
  readonly faults: GridFaults;
};

const NO_PROPS = (): GridProps => ({ autoMin: false, fixedMax: false, fixedMin: false, flexible: false, intrinsic: false, nonDefinite: false, dependent: false });

function orProps(a: GridProps, b: GridProps): GridProps {
  return {
    autoMin: a.autoMin || b.autoMin,
    fixedMax: a.fixedMax || b.fixedMax,
    fixedMin: a.fixedMin || b.fixedMin,
    flexible: a.flexible || b.flexible,
    intrinsic: a.intrinsic || b.intrinsic,
    nonDefinite: a.nonDefinite || b.nonDefinite,
    dependent: a.dependent || b.dependent,
  };
}

function maxN(a: number, b: number): number {
  return a > b ? a : b;
}

function minN(a: number, b: number): number {
  return a < b ? a : b;
}

function maxLu(a: LU, b: LU): LU {
  return a > b ? a : b;
}

function minLu(a: LU, b: LU): LU {
  return a < b ? a : b;
}

// ---- Track sizing functions (Blink GridTrackSize) --------------------------------------------------------------------------

function trackOf(t: TrackSize, fitContentAsAuto: boolean): GridTrack {
  if (t.kind === 'fit-content' && fitContentAsAuto) return { fitContent: false, min: { kind: 'auto' }, max: { kind: 'auto' }, limit: null };
  if (t.kind === 'breadth') return { fitContent: false, min: t.breadth, max: t.breadth, limit: null };
  if (t.kind === 'minmax') return { fitContent: false, min: t.min, max: t.max, limit: null };
  return { fitContent: true, min: { kind: 'auto' }, max: { kind: 'auto' }, limit: t.limit };
}

const isAuto = (b: TrackBreadth): boolean => b.kind === 'auto';
/** Length::HasOnlyFixedAndPercent. */
const isFixed = (b: TrackBreadth): boolean => b.kind === 'px' || b.kind === 'percent';
const isFlex = (b: TrackBreadth): boolean => b.kind === 'fr';
const isContent = (b: TrackBreadth): boolean => b.kind === 'min-content' || b.kind === 'max-content';
const minIntrinsic = (t: GridTrack): boolean => isContent(t.min) || isAuto(t.min) || t.fitContent;
const maxIntrinsic = (t: GridTrack): boolean => isContent(t.max) || isAuto(t.max) || t.fitContent;
const maxContentOrAutoMax = (t: GridTrack): boolean => t.max.kind === 'max-content' || isAuto(t.max);

function breadthEqual(a: TrackBreadth, b: TrackBreadth): boolean {
  if (a.kind === 'px' && b.kind === 'px') return a.value === b.value;
  if (a.kind === 'percent' && b.kind === 'percent') return a.value === b.value;
  if (a.kind === 'fr' && b.kind === 'fr') return a.value === b.value;
  return a.kind === b.kind;
}

/** GridTrackSize::IsDefinite: fixed and equal minimum and maximum. */
const trackDefinite = (t: GridTrack): boolean => isFixed(t.min) && isFixed(t.max) && breadthEqual(t.min, t.max);

function trackHasPercentage(t: GridTrack): boolean {
  if (t.fitContent) return t.limit !== null && t.limit.kind === 'percent';
  return t.min.kind === 'percent' || t.max.kind === 'percent';
}

/** Blink GridSet constructor: % breadths behave as auto against an indefinite size, and a flexible minimum is auto. */
function normalizeTrack(t: GridTrack, indefinite: boolean): GridTrack {
  if (t.fitContent) {
    if (indefinite && t.limit !== null && t.limit.kind === 'percent') return { fitContent: false, min: { kind: 'auto' }, max: { kind: 'max-content' }, limit: null };
    return t;
  }
  const min: TrackBreadth = (indefinite && t.min.kind === 'percent') || isFlex(t.min) ? { kind: 'auto' } : t.min;
  const max: TrackBreadth = indefinite && t.max.kind === 'percent' ? { kind: 'auto' } : t.max;
  return { fitContent: false, min, max, limit: null };
}

/** MinimumValueForLength for a fixed or % breadth. */
function breadthValue(b: Px | Percent, available: LU): LU {
  return b.kind === 'px' ? fromCssPx(b.value) : percentOf(available, b.value);
}

function fixedValue(b: TrackBreadth, available: LU): LU {
  if (b.kind === 'px' || b.kind === 'percent') return breadthValue(b, available);
  throw new Error(`a ${b.kind} breadth has no fixed value`);
}

function flexOf(t: GridTrack): number {
  return t.max.kind === 'fr' ? t.max.value : 0;
}

function setFlex(s: GridSet): number {
  return setFlexFactor(flexOf(s.track), s.trackCount);
}

// ---- Placement (Blink GridPlacement, css-grid-2 §8.5) -----------------------------------------------------------------------

type GridAxisPosition = { definite: boolean; start: number; end: number; readonly span: number };

function setPosition(p: GridAxisPosition, start: number, end: number): void {
  p.definite = true;
  p.start = start;
  p.end = end;
}

type GridPlacedItem = { majorStart: number; minorStart: number; majorEnd: number; minorEnd: number; next: number; prev: number };

type GridPosition = { major: number; minor: number };

const positionLess = (a: GridPosition, b: GridPosition): boolean => (a.major !== b.major ? a.major < b.major : a.minor < b.minor);
const positionLessEq = (a: GridPosition, b: GridPosition): boolean => (a.major === b.major ? a.minor <= b.minor : a.major < b.major);

type GridPlacedList = { items: GridPlacedItem[]; head: number; tail: number };
type GridIndexedPlaced = { readonly p: GridPlacedItem; readonly index: number };
/** Sparse packing's minor cursor for one major line (css-grid-2 §8.5 step 2). */
type GridMinorCursor = { readonly major: number; minor: number };

/** Blink AutoPlacementCursor. */
type GridCursor = { current: GridPosition; next: number; overlapping: number[]; shouldMoveToNextItemMajorEndLine: boolean };

function endOnPreviousMajorLine(p: GridPlacedItem): GridPosition {
  return { major: p.majorEnd - 1, minor: p.minorEnd };
}

/** The overlapping item whose end comes first (the front of Blink's heap ordered by End). */
function frontOverlapping(list: GridPlacedList, c: GridCursor): number {
  let best = -1;
  for (const i of c.overlapping) {
    if (best < 0) {
      best = i;
      continue;
    }
    const a = list.items[i] as GridPlacedItem;
    const b = list.items[best] as GridPlacedItem;
    if (positionLess({ major: a.majorEnd, minor: a.minorEnd }, { major: b.majorEnd, minor: b.minorEnd })) best = i;
  }
  return best;
}

function removeOverlapping(c: GridCursor, index: number): void {
  c.overlapping = c.overlapping.filter((i) => i !== index);
}

function updateItemsOverlappingMajorLine(list: GridPlacedList, c: GridCursor): void {
  while (c.overlapping.length > 0) {
    const front = frontOverlapping(list, c);
    const last = endOnPreviousMajorLine(list.items[front] as GridPlacedItem);
    if (positionLess(c.current, last)) break;
    if (c.current.major === last.major) c.shouldMoveToNextItemMajorEndLine = false;
    removeOverlapping(c, front);
  }
  while (c.next >= 0) {
    const n = list.items[c.next] as GridPlacedItem;
    if (!positionLessEq({ major: n.majorStart, minor: n.minorStart }, c.current)) break;
    const last = endOnPreviousMajorLine(n);
    if (c.current.major <= last.major) c.shouldMoveToNextItemMajorEndLine = false;
    if (positionLess(c.current, last)) c.overlapping.push(c.next);
    c.next = n.next;
  }
}

function moveToMinorLine(c: GridCursor, minor: number): void {
  if (minor < c.current.minor) c.current = { major: c.current.major + 1, minor: c.current.minor };
  c.current = { major: c.current.major, minor };
}

function moveToNextMajorLine(list: GridPlacedList, c: GridCursor, allowMinor: boolean): void {
  let major = c.current.major + 1;
  if (c.shouldMoveToNextItemMajorEndLine && c.overlapping.length > 0) major = (list.items[frontOverlapping(list, c)] as GridPlacedItem).majorEnd;
  c.current = { major, minor: allowMinor ? 0 : c.current.minor };
  c.shouldMoveToNextItemMajorEndLine = true;
}

type GridCursorMovement = 'auto' | 'force-major' | 'force-minor';

/** Blink AutoPlacementCursor::MoveCursorToFitGridSpan. */
function moveCursorToFitGridSpan(list: GridPlacedList, c: GridCursor, majorSpan: number, minorSpan: number, minorMaxEnd: number, movement: GridCursorMovement): void {
  const allowMinor = movement !== 'force-minor';
  const minorMaxStart = movement === 'force-major' ? minorMaxEnd : minorMaxEnd - minorSpan;
  let nextMinor = c.current.minor;
  const needsToMoveToNextMajorLine = (): boolean => nextMinor > minorMaxStart || (!allowMinor && nextMinor !== c.current.minor);
  const fits = (): boolean => {
    if (needsToMoveToNextMajorLine()) {
      moveToNextMajorLine(list, c, allowMinor);
      return false;
    }
    if (c.current.minor === nextMinor) return true;
    moveToMinorLine(c, nextMinor);
    return false;
  };
  if (c.current.minor > minorMaxStart) moveToNextMajorLine(list, c, allowMinor);
  for (;;) {
    updateItemsOverlappingMajorLine(list, c);
    nextMinor = c.current.minor;
    for (const i of c.overlapping) {
      const p = list.items[i] as GridPlacedItem;
      if (nextMinor < p.minorEnd && p.minorStart < nextMinor + minorSpan) {
        nextMinor = p.minorEnd;
        if (needsToMoveToNextMajorLine()) break;
      }
    }
    if (!fits()) continue;
    let upcoming = c.next;
    while (upcoming >= 0) {
      const p = list.items[upcoming] as GridPlacedItem;
      if (nextMinor < p.minorEnd && c.current.major < p.majorEnd && p.majorStart < c.current.major + majorSpan && p.minorStart < nextMinor + minorSpan) {
        nextMinor = p.minorEnd;
        if (needsToMoveToNextMajorLine()) break;
      }
      upcoming = p.next;
    }
    if (fits()) return;
  }
}

/** Inserts an item before the cursor's next item (Blink PlaceGridItemAtCursor) and moves the cursor past it. */
function placeAtCursor(list: GridPlacedList, c: GridCursor, p: GridPlacedItem): void {
  const index = list.items.length;
  const before = c.next;
  const after = before >= 0 ? (list.items[before] as GridPlacedItem).prev : list.tail;
  p.prev = after;
  p.next = before;
  list.items.push(p);
  if (after >= 0) {
    const a = list.items[after] as GridPlacedItem;
    a.next = index;
  } else list.head = index;
  if (before >= 0) {
    const b = list.items[before] as GridPlacedItem;
    b.prev = index;
  } else list.tail = index;
  c.next = index;
  moveToMinorLine(c, p.minorEnd);
  updateItemsOverlappingMajorLine(list, c);
}

function newCursor(list: GridPlacedList): GridCursor {
  return { current: { major: 0, minor: 0 }, next: list.head, overlapping: [], shouldMoveToNextItemMajorEndLine: true };
}

function clampSpan(s: GridSpan): GridAxisPosition {
  if (s.kind === 'auto') {
    const span = s.span < 1 ? 1 : s.span > GRID_MAX_TRACKS ? GRID_MAX_TRACKS : s.span;
    return { definite: false, start: 0, end: 0, span };
  }
  const start = s.start < -GRID_MAX_TRACKS ? -GRID_MAX_TRACKS : s.start > GRID_MAX_TRACKS - 1 ? GRID_MAX_TRACKS - 1 : s.start;
  const end = s.end < start + 1 ? start + 1 : s.end > GRID_MAX_TRACKS ? GRID_MAX_TRACKS : s.end;
  return { definite: true, start, end, span: end - start };
}

type GridPlacementResult = { readonly columns: GridLines[]; readonly rows: GridLines[]; readonly columnStartOffset: number; readonly rowStartOffset: number };

/** Blink GridPlacement::RunAutoPlacementAlgorithm: the translated (non-negative) lines of every item in both axes. */
function runPlacement(g: GridContainerStyle, boxes: readonly LayoutBox[], ctx: Ctx): GridPlacementResult {
  const columnMajor = g.autoFlow === 'column';
  const sparse = !g.dense;
  const cols: GridAxisPosition[] = [];
  const rows: GridAxisPosition[] = [];
  let columnStartOffset = 0;
  let rowStartOffset = 0;
  for (const b of boxes) {
    const gi = b.style.gridItem;
    if (gi === null) throw new Error(`${b.id} is an in-flow grid item with no gridItem; validateLayoutInput rejects this input`);
    const c = clampSpan(gi.column);
    const r = clampSpan(gi.row);
    if (c.definite) columnStartOffset = maxN(columnStartOffset, -c.start);
    if (r.definite) rowStartOffset = maxN(rowStartOffset, -r.start);
    cols.push(c);
    rows.push(r);
  }
  const translate = (p: GridAxisPosition, offset: number): GridAxisPosition => (p.definite ? { definite: true, start: p.start + offset, end: p.end + offset, span: p.span } : { definite: false, start: 0, end: 0, span: p.span });
  const tcols = cols.map((p) => translate(p, columnStartOffset));
  const trows = rows.map((p) => translate(p, rowStartOffset));
  const majors = columnMajor ? tcols : trows;
  const minors = columnMajor ? trows : tcols;
  const minorStartOffset = columnMajor ? rowStartOffset : columnStartOffset;
  const minorExplicit = columnMajor ? g.explicitRowCount : g.explicitColumnCount;
  let minorMaxEnd = minorStartOffset + minorExplicit;

  const list: GridPlacedList = { items: [], head: -1, tail: -1 };
  const nonAuto: GridIndexedPlaced[] = [];
  const locked: number[] = [];
  const notLocked: number[] = [];
  for (let i = 0; i < boxes.length; i++) {
    const major = majors[i] as GridAxisPosition;
    const minor = minors[i] as GridAxisPosition;
    minorMaxEnd = maxN(minorMaxEnd, minor.definite ? minor.end : minor.span);
    if (major.definite && minor.definite) nonAuto.push({ p: { majorStart: major.start, minorStart: minor.start, majorEnd: major.end, minorEnd: minor.end, next: -1, prev: -1 }, index: i });
    else if (!major.definite) notLocked.push(i);
    else locked.push(i);
  }
  if (locked.length > 0 || notLocked.length > 0) {
    const ordered = [...nonAuto].sort((a, b) => {
      if (a.p.majorStart !== b.p.majorStart) return a.p.majorStart - b.p.majorStart;
      if (a.p.minorStart !== b.p.minorStart) return a.p.minorStart - b.p.minorStart;
      return a.index - b.index;
    });
    for (const o of ordered) {
      const index = list.items.length;
      o.p.prev = list.tail;
      list.items.push(o.p);
      if (list.tail >= 0) {
        const t = list.items[list.tail] as GridPlacedItem;
        t.next = index;
      }
      else list.head = index;
      list.tail = index;
    }
    // Items locked to a major line (css-grid-2 §8.5 step 2); sparse packing keeps a minor cursor per major line.
    const minorCursors: GridMinorCursor[] = [];
    for (const i of locked) {
      const major = majors[i] as GridAxisPosition;
      const minor = minors[i] as GridAxisPosition;
      const c = newCursor(list);
      c.current = { major: major.start, minor: c.current.minor };
      if (sparse) {
        const at = minorCursors.find((m) => m.major === major.start);
        if (at !== undefined) moveToMinorLine(c, at.minor);
      }
      moveCursorToFitGridSpan(list, c, major.span, minor.span, minorMaxEnd, 'force-major');
      const minorEnd = c.current.minor + minor.span;
      if (sparse) {
        const at = minorCursors.find((m) => m.major === major.start);
        if (at === undefined) minorCursors.push({ major: major.start, minor: minorEnd });
        else at.minor = minorEnd;
      }
      minorMaxEnd = maxN(minorMaxEnd, minorEnd);
      setPosition(minor, c.current.minor, minorEnd);
      placeAtCursor(list, c, { majorStart: major.start, minorStart: c.current.minor, majorEnd: major.end, minorEnd, next: -1, prev: -1 });
    }
    // Items with an automatic major position (step 4); dense packing restarts the cursor for each one.
    let cursor = newCursor(list);
    for (const i of notLocked) {
      const major = majors[i] as GridAxisPosition;
      const minor = minors[i] as GridAxisPosition;
      if (minor.definite) {
        moveToMinorLine(cursor, minor.start);
        moveCursorToFitGridSpan(list, cursor, major.span, minor.span, minorMaxEnd, 'force-minor');
      } else {
        moveCursorToFitGridSpan(list, cursor, major.span, minor.span, minorMaxEnd, 'auto');
        setPosition(minor, cursor.current.minor, cursor.current.minor + minor.span);
      }
      setPosition(major, cursor.current.major, cursor.current.major + major.span);
      placeAtCursor(list, cursor, { majorStart: major.start, minorStart: minor.start, majorEnd: major.end, minorEnd: minor.end, next: -1, prev: -1 });
      if ((!sparse && !ctx.gridFaults.denseAsSparse) || (sparse && ctx.gridFaults.sparseRewinds)) cursor = newCursor(list);
    }
  }
  return {
    columns: (columnMajor ? majors : minors).map(toSpan),
    rows: (columnMajor ? minors : majors).map(toSpan),
    columnStartOffset,
    rowStartOffset,
  };
}

// ---- Ranges and sets (Blink GridRangeBuilder, GridSizingTrackCollection) ----------------------------------------------------

function toSpan(p: GridAxisPosition): GridLines {
  return { start: p.start, end: p.end };
}

function byLine(a: number, b: number): number {
  return a - b;
}

function repeaterTrackCount(r: TrackRepeater): number {
  return r.count * r.sizes.length;
}

/** Blink GridRangeBuilder::FinalizeRanges: ranges cut at every repeater edge and every item line. */
function buildRanges(explicit: readonly TrackRepeater[], implicitSize: number, startOffset: number, explicitCount: number, spans: readonly GridLines[], implicitForward: boolean): GridRange[] {
  const starts: number[] = [];
  const ends: number[] = [];
  let cur = startOffset;
  for (const r of explicit) {
    starts.push(cur);
    cur += repeaterTrackCount(r);
    ends.push(cur);
  }
  // A grid-template-areas grid larger than the template extends the explicit grid (css-grid-2 §7.3).
  const namedEnd = startOffset + explicitCount;
  const repeaterEnd = ends.length === 0 ? startOffset : (ends[ends.length - 1] as number);
  if (repeaterEnd < namedEnd) {
    starts.push(repeaterEnd);
    ends.push(namedEnd);
  }
  for (const s of spans) {
    starts.push(s.start);
    ends.push(s.end);
  }
  starts.sort(byLine);
  ends.sort(byLine);
  const count = starts.length;
  const ranges: GridRange[] = [];
  let currentExplicitGridLine = startOffset;
  let repeaterIndex = NOT_FOUND;
  let rangeStart = 0;
  let setIndex = 0;
  let nextRepeaterStart = explicit.length > 0 ? startOffset : NOT_FOUND;
  let si = 0;
  let ei = 0;
  for (;;) {
    while (si < count && rangeStart >= (starts[si] as number)) si++;
    while (ei < count && rangeStart >= (ends[ei] as number)) ei++;
    if (ei >= count) break;
    const nextStart = si < count ? (starts[si] as number) : NO_LINE;
    const nextEnd = ends[ei] as number;
    while (rangeStart === nextRepeaterStart) {
      currentExplicitGridLine = nextRepeaterStart;
      repeaterIndex++;
      if (repeaterIndex === explicit.length) {
        repeaterIndex = NOT_FOUND;
        break;
      }
      nextRepeaterStart += repeaterTrackCount(explicit[repeaterIndex] as TrackRepeater);
    }
    const trackCount = minN(nextStart, nextEnd) - rangeStart;
    let size = 1;
    let rangeRepeater = 0;
    let offset = 0;
    let implicit = false;
    if (repeaterIndex !== NOT_FOUND) {
      size = (explicit[repeaterIndex] as TrackRepeater).sizes.length;
      rangeRepeater = repeaterIndex;
      offset = intMod(rangeStart - currentExplicitGridLine, size);
    } else {
      implicit = true;
      size = implicitSize;
      offset = implicitForward ? intMod(rangeStart, size) : intMod(rangeStart + size - intMod(currentExplicitGridLine, size), size);
    }
    const setCount = minN(size, trackCount);
    ranges.push({ startLine: rangeStart, trackCount, beginSetIndex: setIndex, setCount, repeaterIndex: rangeRepeater, repeaterOffset: offset, implicit, props: NO_PROPS() });
    rangeStart += trackCount;
    setIndex += setCount;
  }
  return ranges;
}

function newCollection(axis: GridAxis, ranges: GridRange[]): GridCollection {
  let tracks = 0;
  for (const r of ranges) tracks += r.trackCount;
  return { axis, ranges, sets: [], gutter: ZERO, geometry: [], lastIndefinite: [], props: NO_PROPS(), nonCollapsedTrackCount: tracks };
}

function rangeIndexFromLine(c: GridCollection, line: number): number {
  let lower = 0;
  let upper = c.ranges.length;
  while (lower < upper) {
    const center = intDiv(lower + upper, 2);
    const r = c.ranges[center] as GridRange;
    if (line < r.startLine) upper = center;
    else if (line < r.startLine + r.trackCount) return center;
    else lower = center + 1;
  }
  return lower;
}

/** Blink GridItemData::ComputeSetIndices. */
function setIndicesOf(c: GridCollection, span: GridLines): GridSetIndices {
  const begin = c.ranges[rangeIndexFromLine(c, span.start)] as GridRange;
  const end = c.ranges[rangeIndexFromLine(c, span.end - 1)] as GridRange;
  return { begin: begin.beginSetIndex, end: end.beginSetIndex + end.setCount };
}

/** The union of the properties of the ranges an item spans (Blink CacheGridItemsProperties). */
function spanPropsOf(c: GridCollection, span: GridLines): GridProps {
  const first = rangeIndexFromLine(c, span.start);
  const last = rangeIndexFromLine(c, span.end - 1);
  let p = NO_PROPS();
  for (let i = first; i <= last; i++) p = orProps(p, (c.ranges[i] as GridRange).props);
  return p;
}

function gapValueOf(box: LayoutBox, v: LayoutStyle['rowGap'], available: LU): LU {
  if (v.kind === 'normal') return ZERO;
  if (v.kind === 'px') return fromCssPx(v.value);
  return percentOf(available === INDEFINITE ? ZERO : available, v.value);
}

/** Blink GridTrackSizingAlgorithm::CalculateGutterSize: an indefinite available size counts as 0 for a % gap. */
function gutterSize(box: LayoutBox, axis: GridAxis, available: LU): LU {
  return gapValueOf(box, axis === 'columns' ? box.style.columnGap : box.style.rowGap, available);
}

function templateOf(g: GridContainerStyle, axis: GridAxis): readonly TrackRepeater[] {
  return axis === 'columns' ? g.templateColumns : g.templateRows;
}

function autoTracksOf(g: GridContainerStyle, axis: GridAxis): readonly TrackSize[] {
  return axis === 'columns' ? g.autoColumns : g.autoRows;
}

/** Blink GridSizingTrackCollection::BuildSets and InitializeSets (css-grid-2 §11.4). */
function buildSets(grid: GridState, c: GridCollection, available: LU): void {
  c.gutter = gutterSize(grid.box, c.axis, available);
  const indefinite = available === INDEFINITE;
  const explicit = templateOf(grid.grid, c.axis);
  const implicitSizes = autoTracksOf(grid.grid, c.axis);
  c.sets = [];
  let all = NO_PROPS();
  for (const range of c.ranges) {
    let props = NO_PROPS();
    const sizes = range.implicit ? implicitSizes : (explicit[range.repeaterIndex] as TrackRepeater).sizes;
    const size = sizes.length;
    const floorCount = intDiv(range.trackCount, size);
    const remaining = intMod(range.trackCount, size);
    for (let i = 0; i < range.setCount; i++) {
      const trackCount = floorCount + (i < remaining ? 1 : 0);
      const definition = trackOf(sizes[intMod(range.repeaterOffset + i, size)] as TrackSize, grid.faults.fitContentAsAuto);
      if (trackHasPercentage(definition)) props.dependent = true;
      const track = normalizeTrack(definition, indefinite);
      c.sets.push({ trackCount, track, baseSize: ZERO, growthLimit: ZERO, plannedIncrease: ZERO, fitContentLimit: INDEFINITE, itemIncurredIncrease: ZERO, infinitelyGrowable: false });
      if (isAuto(track.min)) props.autoMin = true;
      if (isFixed(track.min)) props.fixedMin = true;
      if (isFixed(track.max)) props.fixedMax = true;
      if (isFlex(track.max)) {
        props.flexible = true;
        props.dependent = true;
      }
      if (minIntrinsic(track) || maxIntrinsic(track)) props.intrinsic = true;
      if (!trackDefinite(track)) props.nonDefinite = true;
    }
    range.props = props;
    all = orProps(all, props);
  }
  c.props = all;
  for (const s of c.sets) {
    const t = s.track;
    if (t.fitContent && t.limit !== null) s.fitContentLimit = mulInt(breadthValue(t.limit, available), s.trackCount);
    s.growthLimit = isFixed(t.max) ? mulInt(fixedValue(t.max, available), s.trackCount) : INDEFINITE;
    initBaseSize(s, isFixed(t.min) ? mulInt(fixedValue(t.min, available), s.trackCount) : ZERO);
  }
}

function initBaseSize(s: GridSet, v: LU): void {
  s.baseSize = v;
  ensureGrowthLimitNotLessThanBase(s);
}

function ensureGrowthLimitNotLessThanBase(s: GridSet): void {
  if (s.growthLimit !== INDEFINITE && s.growthLimit < s.baseSize) s.growthLimit = s.baseSize;
}

function increaseBaseSize(s: GridSet, v: LU): void {
  s.baseSize = v;
  ensureGrowthLimitNotLessThanBase(s);
}

function definiteGrowthLimit(s: GridSet): LU {
  return s.growthLimit === INDEFINITE ? s.baseSize : s.growthLimit;
}

/** Blink GridSizingTrackCollection::TotalTrackSize. */
function totalTrackSize(c: GridCollection): LU {
  if (c.sets.length === 0) return ZERO;
  let total = ZERO;
  for (const s of c.sets) total = add(total, add(s.baseSize, mulInt(c.gutter, s.trackCount)));
  return sub(total, c.gutter);
}

function cacheInitializedGeometry(c: GridCollection, first: LU): void {
  const lastIndefinite: number[] = [NOT_FOUND];
  const geometry: GridSetGeometry[] = [{ offset: first, trackCount: 0 }];
  let offset = first;
  for (const s of c.sets) {
    if (s.growthLimit === INDEFINITE) lastIndefinite.push(lastIndefinite.length - 1);
    else {
      offset = add(offset, add(s.growthLimit, mulInt(c.gutter, s.trackCount)));
      lastIndefinite.push(lastIndefinite[lastIndefinite.length - 1] as number);
    }
    geometry.push({ offset, trackCount: s.trackCount });
  }
  c.lastIndefinite = lastIndefinite;
  c.geometry = geometry;
}

function finalizeGeometry(c: GridCollection, first: LU, gutter: LU): void {
  c.gutter = gutter;
  c.lastIndefinite = [];
  const geometry: GridSetGeometry[] = [{ offset: first, trackCount: 0 }];
  let offset = first;
  for (const s of c.sets) {
    offset = add(offset, add(s.baseSize, mulInt(gutter, s.trackCount)));
    geometry.push({ offset, trackCount: s.trackCount });
  }
  c.geometry = geometry;
}

function setOffset(c: GridCollection, index: number): LU {
  return (c.geometry[index] as GridSetGeometry).offset;
}

/** Blink GridLayoutTrackCollection::CalculateSetSpanSize; INDEFINITE when the span crosses a set of unknown size. */
function setSpanSize(c: GridCollection, begin: number, end: number): LU {
  if (begin === end) return ZERO;
  if (c.lastIndefinite.length > 0) {
    const last = c.lastIndefinite[end] as number;
    if (last !== NOT_FOUND && begin <= last) return INDEFINITE;
  }
  return clampNegativeToZero(sub(sub(setOffset(c, end), c.gutter), setOffset(c, begin)));
}

function fullSpanSize(c: GridCollection): LU {
  return setSpanSize(c, 0, c.sets.length);
}

/** Blink GridItemData::CalculateAvailableSize. */
function areaSize(c: GridCollection, sets: GridSetIndices): LU {
  const v = setSpanSize(c, sets.begin, sets.end);
  return mightBeSaturated(v) ? ZERO : v;
}

// ---- Content alignment (Blink ComputeFirstSetGeometry, css-align-3 §5) -------------------------------------------------------

type GridFirstSet = { readonly gutter: LU; readonly start: LU };

function firstSetGeometry(grid: GridState, c: GridCollection, available: LU): GridFirstSet {
  const columns = c.axis === 'columns';
  const start = columns ? grid.bsp.left : grid.bsp.top;
  const plain: GridFirstSet = { gutter: c.gutter, start };
  if (available === INDEFINITE) return plain;
  const value = columns ? grid.style.justifyContent : grid.style.alignContent;
  const free = (): LU => sub(available, totalTrackSize(c));
  const count = c.nonCollapsedTrackCount;
  switch (value) {
    case 'space-between': {
      const f = free();
      if (count < 2 || f < 0) return plain;
      return { gutter: add(c.gutter, grid.faults.distributionRounded ? divRound(f, count - 1) : divInt(f, count - 1)), start };
    }
    case 'space-around': {
      const f = free();
      if (f < 0) return plain;
      if (count < 1) return { gutter: c.gutter, start: add(start, divInt(f, 2)) };
      const share = divInt(f, count);
      return { gutter: add(c.gutter, share), start: add(start, divInt(share, 2)) };
    }
    case 'space-evenly': {
      const f = free();
      if (f < 0) return plain;
      const share = divInt(f, count + 1);
      return { gutter: add(c.gutter, share), start: add(start, share) };
    }
    case 'left':
      return grid.rtl ? { gutter: c.gutter, start: add(start, free()) } : plain;
    case 'right':
      return grid.rtl ? plain : { gutter: c.gutter, start: add(start, free()) };
    case 'center':
      return { gutter: c.gutter, start: add(start, divInt(free(), 2)) };
    case 'end':
    case 'flex-end':
      return { gutter: c.gutter, start: add(start, free()) };
    default:
      return plain;
  }
}

/** Planted fault distributionRounded: a quotient rounded to the nearest unit. */
function divRound(v: LU, n: number): LU {
  return divInt(add(v, intDiv(n, 2) as LU), n);
}

/** css-align-3 §5.1: StretchAutoTracks runs for stretch, or for the default distribution with position normal. */
function stretchesAutoTracks(grid: GridState, axis: GridAxis): boolean {
  const v = axis === 'columns' ? grid.style.justifyContent : grid.style.alignContent;
  return v === 'normal' || v === 'stretch';
}

// ---- The track sizing algorithm (Blink GridTrackSizingAlgorithm, css-grid-2 §12) ----------------------------------------

type GridContribution = (type: GridContributionType, item: GridItemData) => LU;

function affectedSize(s: GridSet, type: GridContributionType): LU {
  if (type === 'intrinsic-minimums' || type === 'content-based-minimums' || type === 'max-content-minimums') return s.baseSize;
  return definiteGrowthLimit(s);
}

function growAffectedSize(type: GridContributionType, s: GridSet): void {
  s.infinitelyGrowable = false;
  const planned = s.plannedIncrease;
  if (planned === INDEFINITE) return;
  if (type === 'intrinsic-minimums' || type === 'content-based-minimums' || type === 'max-content-minimums') {
    increaseBaseSize(s, add(s.baseSize, planned));
    return;
  }
  if (type === 'intrinsic-maximums') s.infinitelyGrowable = s.growthLimit === INDEFINITE;
  s.growthLimit = add(definiteGrowthLimit(s), planned);
}

function contributionApplies(s: GridSet, type: GridContributionType): boolean {
  const t = s.track;
  switch (type) {
    case 'intrinsic-minimums':
      return minIntrinsic(t);
    case 'content-based-minimums':
      return isContent(t.min);
    case 'max-content-minimums':
      return t.min.kind === 'max-content';
    case 'intrinsic-maximums':
      return maxIntrinsic(t);
    case 'max-content-maximums':
      return maxContentOrAutoMax(t);
    case 'free-space':
      return true;
  }
}

function growsBeyondLimit(s: GridSet, type: GridContributionType): boolean {
  if (type === 'intrinsic-minimums' || type === 'content-based-minimums') return maxIntrinsic(s.track);
  if (type === 'max-content-minimums') return maxContentOrAutoMax(s.track);
  return false;
}

const forGrowthLimits = (type: GridContributionType): boolean => type === 'intrinsic-maximums' || type === 'max-content-maximums';

/** Blink GrowthPotentialForSet; INDEFINITE is infinite. */
function growthPotential(s: GridSet, type: GridContributionType, enforceInfinitelyGrowable: boolean): LU {
  if (type === 'intrinsic-minimums' || type === 'content-based-minimums' || type === 'max-content-minimums') {
    if (s.growthLimit === INDEFINITE) return INDEFINITE;
    return sub(s.growthLimit, add(s.baseSize, s.itemIncurredIncrease));
  }
  if (type === 'free-space') return sub(s.growthLimit, s.baseSize);
  if (enforceInfinitelyGrowable && s.growthLimit !== INDEFINITE && !s.infinitelyGrowable) return ZERO;
  if (s.fitContentLimit !== INDEFINITE) return clampNegativeToZero(sub(sub(s.fitContentLimit, definiteGrowthLimit(s)), s.itemIncurredIncrease));
  return INDEFINITE;
}

/**
 * Blink DistributeExtraSpaceToSets (css-grid-2 §12.5.1): equal shares in unsigned 32-bit arithmetic, or float shares weighted by
 * flex factor, up to each set's limit, then beyond limits. A set whose ratio is all that remains takes all the space left.
 */
function distributeExtraSpace(ctx: Ctx, extraSpace: LU, flexSum: number, equal: boolean, type: GridContributionType, toGrow: GridSet[], beyond: GridSet[] | null, beyondIsToGrow: boolean): GridSet[] {
  let extra = extraSpace;
  if (extra === INDEFINITE) {
    for (const s of toGrow) s.itemIncurredIncrease = growthPotential(s, type, true);
    return toGrow;
  }
  let growable = 0;
  for (const s of toGrow) {
    s.itemIncurredIncrease = ZERO;
    if (growthPotential(s, type, true) !== ZERO) growable += s.trackCount;
  }
  let ratioSum = equal ? growable : flexSum;
  let sets = toGrow;
  // GR6: std::sort by growth potential (infinite last); ties keep list order, as libc++'s insertion sort does up to 30 sets.
  if ((growable > 0 || forGrowthLimits(type)) && floatNearlyEqual(flexSum, 0)) {
    const keyed = sets.map((s, i): GridKeyedSet => ({ s, i, p: growthPotential(s, type, false) }));
    keyed.sort((a, b) => {
      const aInf = a.p === INDEFINITE;
      const bInf = b.p === INDEFINITE;
      if (aInf !== bInf) return aInf ? 1 : -1;
      if (!aInf && a.p !== b.p) return a.p - b.p;
      return a.i - b.i;
    });
    sets = keyed.map((k) => k.s);
  }
  const share = (s: GridSet, potential: LU): LU => {
    if (potential === ZERO) return ZERO;
    let count = s.trackCount;
    let ratio = equal ? count : setFlex(s);
    if (ratio > ratioSum) ratio = ratioSum;
    let result: LU;
    const same = equal ? ratio === ratioSum : floatNearlyEqual(ratio, ratioSum);
    if (same) {
      count = growable;
      result = extra;
    } else if (equal) {
      result = ctx.gridFaults.shareRounded ? roundedShare(extra, ratio, ratioSum) : equalShare(extra, ratio, ratioSum);
    } else {
      result = weightedShare(extra, ratio, ratioSum);
    }
    if (potential !== INDEFINITE) result = minLu(result, potential);
    growable -= count;
    ratioSum = equal ? ratioSum - ratio : flexSumSub(ratioSum, ratio);
    extra = sub(extra, result);
    return result;
  };
  for (const s of sets) {
    if (growable === 0) break;
    s.itemIncurredIncrease = share(s, growthPotential(s, type, true));
  }
  if (beyond !== null && extra !== ZERO) {
    const beyondSets = beyondIsToGrow ? sets : beyond;
    const beyondPotential = (s: GridSet): LU => (forGrowthLimits(type) ? growthPotential(s, type, false) : INDEFINITE);
    growable = 0;
    for (const s of beyondSets) if (beyondPotential(s) !== ZERO) growable += s.trackCount;
    ratioSum = growable;
    for (const s of beyondSets) {
      if (growable === 0) break;
      s.itemIncurredIncrease = add(s.itemIncurredIncrease, share(s, beyondPotential(s)));
    }
  }
  return sets;
}

/** Planted fault gridShareRounded: the equal share rounded to the nearest LayoutUnit instead of truncated. */
function roundedShare(extra: LU, ratio: number, ratioSum: number): LU {
  const truncated = equalShare(extra, ratio, ratioSum);
  const twice = equalShare(extra, ratio * 2, ratioSum);
  return add(truncated, sub(twice, mulInt(truncated, 2)));
}

function setsOf(c: GridCollection, sets: GridSetIndices): GridSet[] {
  const out: GridSet[] = [];
  for (let i = sets.begin; i < sets.end; i++) out.push(c.sets[i] as GridSet);
  return out;
}

const itemSets = (item: GridItemData, axis: GridAxis): GridSetIndices => (axis === 'columns' ? item.columnSets : item.rowSets);
const itemProps = (item: GridItemData, axis: GridAxis): GridProps => (axis === 'columns' ? item.columnProps : item.rowProps);
const itemSpanSize = (item: GridItemData, axis: GridAxis): number => (axis === 'columns' ? item.column.end - item.column.start : item.row.end - item.row.start);

/** Blink IncreaseTrackSizesToAccommodateGridItems (css-grid-2 §12.5 step 3, §12.5.1). */
function accommodateItems(ctx: Ctx, c: GridCollection, group: readonly GridItemData[], type: GridContributionType, spansFlex: boolean, contribution: GridContribution): void {
  for (const s of c.sets) s.plannedIncrease = INDEFINITE;
  for (const item of group) {
    const toGrow: GridSet[] = [];
    const beyond: GridSet[] = [];
    let flexSum = 0;
    let spanned = mulInt(c.gutter, itemSpanSize(item, c.axis) - 1);
    if (ctx.gridFaults.gutterNotInSpan) spanned = ZERO;
    for (const s of setsOf(c, itemSets(item, c.axis))) {
      spanned = add(spanned, affectedSize(s, type));
      if (spansFlex && !isFlex(s.track.max)) continue;
      if (contributionApplies(s, type)) {
        if (s.plannedIncrease === INDEFINITE) s.plannedIncrease = ZERO;
        if (spansFlex) flexSum = flexSumAdd(flexSum, setFlex(s));
        toGrow.push(s);
        if (growsBeyondLimit(s, type)) beyond.push(s);
      }
    }
    if (toGrow.length === 0) continue;
    const extra = clampNegativeToZero(sub(contribution(type, item), spanned));
    if (extra === ZERO) continue;
    if (!spansFlex || floatNearlyEqual(flexSum, 0)) distributeExtraSpace(ctx, extra, 0, true, type, toGrow, beyond.length === 0 ? toGrow : beyond, beyond.length === 0);
    else distributeExtraSpace(ctx, extra, ctx.gridFaults.flexSpanEqual ? 0 : flexSum, ctx.gridFaults.flexSpanEqual, type, toGrow, null, false);
    for (const s of toGrow) s.plannedIncrease = maxLu(s.itemIncurredIncrease, s.plannedIncrease);
  }
  for (const s of c.sets) growAffectedSize(type, s);
}

/** Blink ResolveIntrinsicTrackSizes (css-grid-2 §12.5): span groups in increasing size, then every item spanning a flexible track. */
function resolveIntrinsicTrackSizes(ctx: Ctx, c: GridCollection, items: readonly GridItemData[], contribution: GridContribution): void {
  const considered = items.filter((i) => itemProps(i, c.axis).intrinsic);
  const flexible = (i: GridItemData): boolean => itemProps(i, c.axis).flexible;
  const ordered = considered.map((item, k): GridIndexedItem => ({ item, k })).sort((a, b) => {
    const fa = flexible(a.item);
    const fb = flexible(b.item);
    if (fa !== fb) return fa ? 1 : -1;
    if (!fa && !ctx.gridFaults.spanGroupingFlat) {
      const d = itemSpanSize(a.item, c.axis) - itemSpanSize(b.item, c.axis);
      if (d !== 0) return d;
    }
    return a.k - b.k;
  }).map((e) => e.item);
  let at = 0;
  while (at < ordered.length && !flexible(ordered[at] as GridItemData)) {
    const span = itemSpanSize(ordered[at] as GridItemData, c.axis);
    let end = at + 1;
    while (end < ordered.length && !flexible(ordered[end] as GridItemData) && (ctx.gridFaults.spanGroupingFlat || itemSpanSize(ordered[end] as GridItemData, c.axis) === span)) end++;
    const group: GridItemData[] = [];
    for (let k = at; k < end; k++) group.push(ordered[k] as GridItemData);
    accommodateItems(ctx, c, group, 'intrinsic-minimums', false, contribution);
    accommodateItems(ctx, c, group, 'content-based-minimums', false, contribution);
    accommodateItems(ctx, c, group, 'max-content-minimums', false, contribution);
    accommodateItems(ctx, c, group, 'intrinsic-maximums', false, contribution);
    accommodateItems(ctx, c, group, 'max-content-maximums', false, contribution);
    at = end;
  }
  if (at < ordered.length) {
    const group: GridItemData[] = [];
    for (let k = at; k < ordered.length; k++) group.push(ordered[k] as GridItemData);
    accommodateItems(ctx, c, group, 'intrinsic-minimums', true, contribution);
    accommodateItems(ctx, c, group, 'content-based-minimums', true, contribution);
    accommodateItems(ctx, c, group, 'max-content-minimums', true, contribution);
  }
}

/** Blink DetermineFreeSpace (GR13). */
function determineFreeSpace(c: GridCollection, available: GridAvailable, constraint: GridSizing): LU {
  const mode: GridSizing = c.axis === 'columns' ? constraint : 'layout';
  if (mode === 'max-content') return INDEFINITE;
  if (mode === 'min-content') return ZERO;
  const a = c.axis === 'columns' ? available.inline : available.block;
  if (a === INDEFINITE) return INDEFINITE;
  return clampNegativeToZero(sub(a, totalTrackSize(c)));
}

/** Blink MaximizeTracks (css-grid-2 §12.6, GR10): no redo against max-width or max-height (Chrome deviation grid-maximize-no-max-redo). */
function maximizeTracks(ctx: Ctx, c: GridCollection, available: GridAvailable, constraint: GridSizing): void {
  const free = determineFreeSpace(c, available, constraint);
  if (free === ZERO) return;
  if (ctx.gridFaults.maximizeIgnoresLimit && free !== INDEFINITE) {
    let tracks = 0;
    for (const s of c.sets) tracks += s.trackCount;
    for (const s of c.sets) increaseBaseSize(s, add(s.baseSize, equalShare(free, s.trackCount, tracks)));
    return;
  }
  const before = c.sets.map((s) => s.baseSize);
  const sets = distributeExtraSpace(ctx, free, 0, true, 'free-space', [...c.sets], null, false);
  for (const s of sets) increaseBaseSize(s, add(s.baseSize, s.itemIncurredIncrease));
  // Spec reading of grid-maximize-no-max-redo: an indefinite block size that maximize would take past max-height is redone with
  // the free space the max-height leaves.
  if (ctx.gridFaults.maximizeRedoSpec && free === INDEFINITE && c.axis === 'rows' && available.maxBlock !== LU_MAX && totalTrackSize(c) > available.maxBlock) {
    c.sets.forEach((s, i) => {
      s.baseSize = before[i] as LU;
    });
    const room = clampNegativeToZero(sub(available.maxBlock, totalTrackSize(c)));
    if (room === ZERO) return;
    const redone = distributeExtraSpace(ctx, room, 0, true, 'free-space', [...c.sets], null, false);
    for (const s of redone) increaseBaseSize(s, add(s.baseSize, s.itemIncurredIncrease));
  }
}

/** Blink StretchAutoTracks (css-grid-2 §12.8, GR11). */
function stretchAutoTracks(ctx: Ctx, grid: GridState, c: GridCollection, available: GridAvailable, constraint: GridSizing): void {
  if (!stretchesAutoTracks(grid, c.axis) && !ctx.gridFaults.stretchIgnoresAlignment) return;
  const toGrow = c.sets.filter((s) => isAuto(s.track.max) && !s.track.fitContent);
  if (toGrow.length === 0) return;
  let free = determineFreeSpace(c, available, constraint);
  if (free === INDEFINITE) free = ctx.gridFaults.stretchIgnoresMinSize ? ZERO : sub(c.axis === 'columns' ? available.minInline : available.minBlock, totalTrackSize(c));
  if (free <= 0) return;
  const sets = distributeExtraSpace(ctx, free, 0, true, 'free-space', toGrow, toGrow, true);
  for (const s of sets) increaseBaseSize(s, add(s.baseSize, s.itemIncurredIncrease));
}

/** Blink ExpandFlexibleTracks' FindFrSize (css-grid-2 §12.7.1), in float32 (GR12). */
function findFrSize(ctx: Ctx, c: GridCollection, sets: readonly GridSet[], space: LU): number {
  let leftover = space;
  let flexSum = 0;
  let tracks = 0;
  const flexible: GridSet[] = [];
  for (const s of sets) {
    if (isFlex(s.track.max) && !floatNearlyEqual(setFlex(s), 0)) {
      flexSum = flexSumAdd(flexSum, setFlex(s));
      flexible.push(s);
    } else {
      leftover = sub(leftover, s.baseSize);
    }
    tracks += s.trackCount;
  }
  leftover = sub(leftover, mulInt(c.gutter, tracks - 1));
  if (leftover < 0 || flexible.length === 0) return 0;
  const ordered = flexible.map((s, i): GridIndexedSet => ({ s, i })).sort((a, b) => {
    const l = rawTimesFloat(a.s.baseSize, setFlex(b.s));
    const r = rawTimesFloat(b.s.baseSize, setFlex(a.s));
    if (l !== r) return l > r ? -1 : 1;
    return a.i - b.i;
  }).map((e) => e.s);
  let current = 0;
  while (leftover > 0 && current < ordered.length) {
    if (!ctx.gridFaults.flexSumBelowOne && flexSum < 1) flexSum = 1;
    let next = current;
    while (next < ordered.length && rawTimesFloat(leftover, setFlex(ordered[next] as GridSet)) < rawTimesFloat((ordered[next] as GridSet).baseSize, flexSum)) next++;
    if (current === next || ctx.gridFaults.frRestartMissing) return ctx.gridFaults.frFloat64 ? doubleQuotient(leftover, flexSum) : rawOverFloat(leftover, flexSum);
    for (let k = current; k < next; k++) {
      flexSum = flexSumSub(flexSum, setFlex(ordered[k] as GridSet));
      leftover = sub(leftover, (ordered[k] as GridSet).baseSize);
    }
    current = next;
  }
  return 0;
}

/** Blink ExpandFlexibleTracks (css-grid-2 §12.7); the float leftover carries from set to set (GR12). */
function expandFlexibleTracks(ctx: Ctx, c: GridCollection, items: readonly GridItemData[], available: GridAvailable, constraint: GridSizing, contribution: GridContribution): void {
  const free = determineFreeSpace(c, available, constraint);
  if (free === ZERO) return;
  let fr = 0;
  if (free !== INDEFINITE) {
    fr = findFrSize(ctx, c, c.sets, c.axis === 'columns' ? available.inline : available.block);
  } else {
    for (const item of items) {
      if (!itemProps(item, c.axis).flexible) continue;
      const size = contribution('max-content-maximums', item);
      const f = findFrSize(ctx, c, setsOf(c, itemSets(item, c.axis)), size);
      if (f > fr) fr = f;
    }
    for (const s of c.sets) {
      if (!isFlex(s.track.max)) continue;
      const ff = setFlex(s);
      const f = rawOverFloat(s.baseSize, ff > s.trackCount ? ff : s.trackCount);
      if (f > fr) fr = f;
    }
  }
  let leftover = 0;
  for (const s of c.sets) {
    if (!isFlex(s.track.max)) continue;
    const share = ctx.gridFaults.frFloat64 ? doubleShare(fr, setFlex(s), leftover) : flexSumAdd(floatMul(fr, setFlex(s)), leftover);
    const expanded = ctx.gridFaults.frFloat64 ? doubleShareToLu(share) : frShareToLu(share);
    if (!mightBeSaturated(expanded) && expanded >= s.baseSize) {
      increaseBaseSize(s, expanded);
      leftover = ctx.gridFaults.frLeftoverDropped ? 0 : ctx.gridFaults.frFloat64 ? doubleLeftover(share, expanded) : frLeftover(share, expanded);
    }
  }
}

/** Blink GridTrackSizingAlgorithm::ComputeUsedTrackSizes (css-grid-2 §12.3). */
function computeUsedTrackSizes(ctx: Ctx, grid: GridState, c: GridCollection, available: GridAvailable, constraint: GridSizing, contribution: GridContribution): void {
  if (c.props.intrinsic) resolveIntrinsicTrackSizes(ctx, c, grid.items, contribution);
  for (const s of c.sets) if (s.growthLimit === INDEFINITE) s.growthLimit = s.baseSize;
  maximizeTracks(ctx, c, available, constraint);
  if (c.props.flexible) expandFlexibleTracks(ctx, c, grid.items, available, constraint, contribution);
  stretchAutoTracks(ctx, grid, c, available, constraint);
}

// ---- Items: alignment, sizes and contributions (Blink GridItemData, ContributionSizeForGridItem) ------------------------------

function selfAlignOf(container: GridContainerStyle, box: LayoutBox, axis: GridAxis, containerStyle: LayoutStyle): GridSelfAlign {
  const gi = box.style.gridItem;
  if (axis === 'columns') {
    const own = gi === null ? 'auto' : gi.justifySelf;
    return own === 'auto' ? container.justifyItems : own;
  }
  const a = box.style.alignSelf === 'auto' ? containerStyle.alignItems : box.style.alignSelf;
  if (a === 'baseline') unsupported('grid-baseline', box.id, 'css-grid-2 §11.6', 'baseline self-alignment in a grid container (not yet supported)');
  return a;
}

/** Blink AxisEdgeFromItemPosition: auto margins win, then the self position; normal and stretch stretch an auto size. */
function axisEdge(ctx: Ctx, grid: LayoutBox, box: LayoutBox, axis: GridAxis, align: GridSelfAlign): GridAlignment {
  const s = box.style;
  const rtl = directionOf(ctx, grid) === 'rtl';
  const startMargin = axis === 'columns' ? (rtl ? s.marginRight : s.marginLeft) : s.marginTop;
  const endMargin = axis === 'columns' ? (rtl ? s.marginLeft : s.marginRight) : s.marginBottom;
  const startAuto = startMargin.kind === 'auto';
  const endAuto = endMargin.kind === 'auto';
  // Blink AxisEdgeFromItemPosition: auto margin alignment is always safe.
  if (startAuto && endAuto) return { edge: 'center', stretch: false, safe: true };
  if (startAuto) return { edge: 'end', stretch: false, safe: true };
  if (endAuto) return { edge: 'start', stretch: false, safe: true };
  const sameDirection = directionOf(ctx, box) === directionOf(ctx, grid) || axis === 'rows';
  switch (align) {
    case 'normal':
    case 'stretch':
      return { edge: 'start', stretch: true, safe: false };
    case 'start':
    case 'flex-start':
      return { edge: 'start', stretch: false, safe: false };
    case 'end':
    case 'flex-end':
      return { edge: 'end', stretch: false, safe: false };
    case 'center':
      return { edge: 'center', stretch: false, safe: false };
    case 'self-start':
      return { edge: sameDirection ? 'start' : 'end', stretch: false, safe: false };
    case 'self-end':
      return { edge: sameDirection ? 'end' : 'start', stretch: false, safe: false };
    case 'left':
      return { edge: rtl ? 'end' : 'start', stretch: false, safe: false };
    case 'right':
      return { edge: rtl ? 'start' : 'end', stretch: false, safe: false };
  }
}

/** Margins resolved against a percentage basis, by logical side; auto margins are zero here. */
type GridMargins = { readonly inlineStart: LU; readonly inlineEnd: LU; readonly blockStart: LU; readonly blockEnd: LU };

function marginsOf(box: LayoutBox, basis: LU, rtl: boolean): GridMargins {
  const s = box.style;
  const left = resolveMargin(s.marginLeft, basis).value;
  const right = resolveMargin(s.marginRight, basis).value;
  return {
    inlineStart: rtl ? right : left,
    inlineEnd: rtl ? left : right,
    blockStart: resolveMargin(s.marginTop, basis).value,
    blockEnd: resolveMargin(s.marginBottom, basis).value,
  };
}

/** The item's border-box inline size in its grid area (Blink ComputeInlineSizeForFragment with the area as available size). */
function itemInlineSize(ctx: Ctx, item: GridItemData, areaInline: LU, margins: GridMargins): LU {
  const s = item.box.style;
  const pad = resolvePadding(s, areaInline);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const specified = resolveInlineLength(s.width, areaInline);
  const available = sub(sub(areaInline, margins.inlineStart), margins.inlineEnd);
  let raw: LU;
  if (specified !== null) raw = borderBoxFromSpecified(specified, hbp, s.boxSizing);
  else if (item.columnStretch) raw = maxLu(hbp, available);
  else {
    const minC = add(intrinsicContentInlineSize(ctx, item.box, 'min'), hbp);
    const maxC = add(intrinsicContentInlineSize(ctx, item.box, 'max'), hbp);
    raw = minLu(maxC, maxLu(minC, clampNegativeToZero(available)));
  }
  return constrain(raw, inlineMinMax(s, areaInline, hbp));
}

type GridItemLayout = { readonly frag: Frag; readonly margins: GridMargins };

/**
 * Lays out an item in a grid area of the given inline size and block size (INDEFINITE while measuring rows): percentages resolve
 * against the area, and an auto height stretches to a definite area when the item stretches in the block axis.
 */
function layoutItem(ctx: Ctx, grid: GridState, item: GridItemData, areaInline: LU, areaBlock: LU): GridItemLayout {
  const s = item.box.style;
  const margins = marginsOf(item.box, areaInline, grid.rtl);
  const width = itemInlineSize(ctx, item, areaInline, margins);
  const basis: HeightBasis = areaBlock === INDEFINITE ? { kind: 'indefinite' } : { kind: 'definite', value: areaBlock };
  let forced: LU | null = null;
  if (areaBlock !== INDEFINITE && item.rowStretch && s.height.kind === 'auto') {
    const pad = resolvePadding(s, areaInline);
    const bor = resolveBorder(s, ctx.devicePixelRatio);
    const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
    const stretched = maxLu(vbp, sub(sub(areaBlock, margins.blockStart), margins.blockEnd));
    forced = constrain(stretched, blockMinMax(item.box, basis, vbp));
  }
  const r = layoutContents(ctx, item.box, {
    cbInline: areaInline,
    borderBoxWidth: width,
    forcedBorderBoxHeight: forced,
    forcedHeightDefinite: true,
    heightBasis: basis,
    formattingContextRoot: true,
  });
  return { frag: r.frag, margins };
}

/** css-sizing-3 §5.2 for a grid item as its own formatting context: its min- or max-content inline contribution without margins. */
function inlineContributionOf(ctx: Ctx, box: LayoutBox, kind: 'min' | 'max'): LU {
  const s = box.style;
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const padPx = (v: typeof s.paddingLeft): LU => (v.kind === 'px' ? fromCssPx(v.value) : ZERO);
  const bp = sumEdges(bor.left, bor.right, padPx(s.paddingLeft), padPx(s.paddingRight));
  let size: LU;
  if (s.width.kind === 'px') size = borderBoxFromSpecified(fromCssPx(s.width.value), bp, s.boxSizing);
  else size = add(intrinsicContentInlineSize(ctx, box, kind), bp);
  if (s.maxWidth.kind === 'px') size = minLu(size, borderBoxFromSpecified(fromCssPx(s.maxWidth.value), bp, s.boxSizing));
  const minWidth = s.minWidth.kind === 'px' ? borderBoxFromSpecified(fromCssPx(s.minWidth.value), bp, s.boxSizing) : bp;
  return maxLu(size, minWidth);
}

/** The border and padding of an item in one axis, with % padding against the given basis (0 when indefinite). */
function borderPaddingOf(ctx: Ctx, box: LayoutBox, axis: GridAxis, basis: LU): LU {
  const s = box.style;
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const pad = resolvePadding(s, basis === INDEFINITE ? ZERO : basis);
  return axis === 'columns' ? sumEdges(bor.left, bor.right, pad.left, pad.right) : sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
}

/**
 * Blink ResolveMinInlineLength / ResolveInitialMinBlockLength in the measure space, whose % basis in the measured axis is
 * indefinite: a px minimum in border-box terms, or the border and padding for auto and %.
 */
function specifiedMinimum(ctx: Ctx, box: LayoutBox, axis: GridAxis): LU {
  const s = box.style;
  const v = axis === 'columns' ? s.minWidth : s.minHeight;
  const bp = borderPaddingOf(ctx, box, axis, INDEFINITE);
  return v.kind === 'px' ? borderBoxFromSpecified(fromCssPx(v.value), bp, s.boxSizing) : bp;
}

/**
 * An item's min- or max-content contribution without margins: in the column axis its inline contribution (flagging an item whose
 * size depends on the block size, as Blink's is_sizing_dependent_on_block_size), in the row axis its block size when laid out in
 * its column area with an indefinite block size.
 */
function contentContribution(ctx: Ctx, grid: GridState, item: GridItemData, columns: boolean, kind: 'min' | 'max'): LU {
  if (columns) {
    const s = item.box.style;
    if (s.height.kind === 'percent' || s.minHeight.kind === 'percent' || s.maxHeight.kind === 'percent' || (s.height.kind === 'auto' && item.rowStretch)) item.sizingDependsOnBlockSize = true;
    return inlineContributionOf(ctx, item.box, kind);
  }
  return layoutItem(ctx, grid, item, areaSize(grid.columns, item.columnSets), INDEFINITE).frag.height;
}

/** Blink GridLayoutAlgorithm::ContributionSizeForGridItem (css-grid-2 §12.5, GR16) in one axis. */
function contributionFor(ctx: Ctx, grid: GridState, c: GridCollection, type: GridContributionType, item: GridItemData): LU {
  if (type === 'free-space') throw new Error('free-space is not an item contribution');
  const s = item.box.style;
  const columns = c.axis === 'columns';
  // Columns are measured with an indefinite inline size: % margins resolve against LayoutUnit(-1), as Blink's measure space does.
  const basis = columns ? INDEFINITE : areaSize(grid.columns, item.columnSets);
  const m = marginsOf(item.box, basis, grid.rtl);
  const marginSum = columns ? add(m.inlineStart, m.inlineEnd) : add(m.blockStart, m.blockEnd);
  let contribution: LU;
  if (type === 'content-based-minimums' || type === 'intrinsic-maximums') {
    contribution = contentContribution(ctx, grid, item, columns, 'min');
  } else if (type === 'max-content-minimums' || type === 'max-content-maximums') {
    contribution = contentContribution(ctx, grid, item, columns, 'max');
  } else {
    // css-grid-2 §6.6: the automatic minimum applies to an item spanning an auto minimum and, when it spans several tracks, no
    // flexible one; it is clamped to the spanned fixed maximum, never below margins, border and padding.
    const props = itemProps(item, c.axis);
    const special = !props.autoMin || (props.flexible && itemSpanSize(item, c.axis) > 1);
    const main = columns ? s.width : s.height;
    const minLength = columns ? s.minWidth : s.minHeight;
    const minContent = contentContribution(ctx, grid, item, columns, 'min');
    if (main.kind === 'px') contribution = minContent;
    else if (minLength.kind !== 'auto' || isScrollContainer(s) || special) contribution = specifiedMinimum(ctx, item.box, c.axis);
    else {
      contribution = minContent;
      const sets = itemSets(item, c.axis);
      const spannedMax = setSpanSize(c, sets.begin, sets.end);
      if (spannedMax !== INDEFINITE && !ctx.gridFaults.autoMinNotClamped) {
        const bp = borderPaddingOf(ctx, item.box, c.axis, basis);
        const limit = maxLu(spannedMax, add(marginSum, bp));
        contribution = sub(minLu(add(contribution, marginSum), limit), marginSum);
      }
    }
  }
  return clampNegativeToZero(add(contribution, marginSum));
}

// ---- Geometry (Blink ComputeGridGeometry, GR15) --------------------------------------------------------------------------

function initializeTrackSizes(ctx: Ctx, grid: GridState, axis: GridAxis): void {
  const c = axis === 'columns' ? grid.columns : grid.rows;
  const available = axis === 'columns' ? grid.available.inline : grid.available.block;
  buildSets(grid, c, available);
  for (const item of grid.items) {
    const span = axis === 'columns' ? item.column : item.row;
    const sets = setIndicesOf(c, span);
    const props = spanPropsOf(c, span);
    if (axis === 'columns') {
      item.columnSets = sets;
      item.columnProps = props;
    } else {
      item.rowSets = sets;
      item.rowProps = props;
    }
  }
  if (!c.props.nonDefinite) {
    const first = firstSetGeometry(grid, c, available);
    finalizeGeometry(c, first.start, first.gutter);
  } else {
    cacheInitializedGeometry(c, axis === 'columns' ? grid.bsp.left : grid.bsp.top);
  }
}

/** Blink CompleteTrackSizingAlgorithm; returns whether a row pass changed the block size of an item whose contribution depends on it. */
function completeTrackSizing(ctx: Ctx, grid: GridState, axis: GridAxis, constraint: GridSizing, checkDependent: boolean): boolean {
  const c = axis === 'columns' ? grid.columns : grid.rows;
  if (!c.props.nonDefinite) return false;
  const available = axis === 'columns' ? grid.available.inline : grid.available.block;
  buildSets(grid, c, available);
  computeUsedTrackSizes(ctx, grid, c, grid.available, constraint, (type, item) => contributionFor(ctx, grid, c, type, item));
  const dependent: GridDependentItem[] = [];
  if (checkDependent && axis === 'rows') {
    for (const item of grid.items) if (item.sizingDependsOnBlockSize) dependent.push({ sets: item.rowSets, cached: setSpanSize(c, item.rowSets.begin, item.rowSets.end) });
  }
  const first = firstSetGeometry(grid, c, available);
  finalizeGeometry(c, first.start, first.gutter);
  for (const d of dependent) if (setSpanSize(c, d.sets.begin, d.sets.end) !== d.cached) return true;
  return false;
}

/** The logical border+padding of the container: inline start is the right side in rtl. */
function logicalBsp(pad: Edges, bor: Edges, rtl: boolean): Edges {
  const left = add(bor.left, pad.left);
  const right = add(bor.right, pad.right);
  return { top: add(bor.top, pad.top), right: rtl ? left : right, bottom: add(bor.bottom, pad.bottom), left: rtl ? right : left };
}

/** Builds the items, their placement and the two track collections of a grid container. */
function buildGrid(ctx: Ctx, box: LayoutBox, pad: Edges, bor: Edges, available: GridAvailable): GridState {
  const s = box.style;
  const g = s.grid;
  if (g === null) throw new Error(`${box.id} is display: grid with no grid style; validateLayoutInput rejects this input`);
  const inFlow: LayoutBox[] = [];
  for (const k of box.children) {
    if (k.kind === 'text') throw new Error(`${k.id} is text directly in grid container ${box.id}; validateLayoutInput rejects this input`);
    if (isOutOfFlow(ctx, k)) unsupported('grid-abspos', k.id, 'css-grid-2 §9', 'an absolutely positioned child of a grid container (not yet supported)');
    inFlow.push(k);
  }
  // css-grid-2 §8.5 with css-flexbox-1 §5.4: order-modified document order, stable.
  const ordered = inFlow.map((b, i): GridIndexedBox => ({ b, i })).sort((x, y) => (x.b.style.order !== y.b.style.order && !ctx.faults.ignoreOrder ? x.b.style.order - y.b.style.order : x.i - y.i)).map((e) => e.b);
  const placement = runPlacement(g, ordered, ctx);
  const rtl = directionOf(ctx, box) === 'rtl';
  const items: GridItemData[] = ordered.map((b, i): GridItemData => {
    const columnAlign = axisEdge(ctx, box, b, 'columns', selfAlignOf(g, b, 'columns', s));
    const rowAlign = axisEdge(ctx, box, b, 'rows', selfAlignOf(g, b, 'rows', s));
    return {
      box: b,
      index: i,
      column: placement.columns[i] as GridLines,
      row: placement.rows[i] as GridLines,
      columnSets: { begin: 0, end: 0 },
      rowSets: { begin: 0, end: 0 },
      columnProps: NO_PROPS(),
      rowProps: NO_PROPS(),
      columnEdge: columnAlign.edge,
      rowEdge: rowAlign.edge,
      columnSafe: columnAlign.safe,
      rowSafe: rowAlign.safe,
      columnStretch: columnAlign.stretch,
      rowStretch: rowAlign.stretch,
      sizingDependsOnBlockSize: false,
    };
  });
  const columnsRanges = buildRanges(g.templateColumns, g.autoColumns.length, placement.columnStartOffset, g.explicitColumnCount, items.map((i) => i.column), ctx.gridFaults.implicitForward);
  const rowsRanges = buildRanges(g.templateRows, g.autoRows.length, placement.rowStartOffset, g.explicitRowCount, items.map((i) => i.row), ctx.gridFaults.implicitForward);
  return { box, style: s, grid: g, rtl, bsp: logicalBsp(pad, bor, rtl), items, columns: newCollection('columns', columnsRanges), rows: newCollection('rows', rowsRanges), available, faults: ctx.gridFaults };
}

function availableFrom(inline: LU | null, block: LU | null, blockMinMax: MinMax, inlineMinMax: MinMax): GridAvailable {
  return {
    inline: inline === null ? INDEFINITE : inline,
    block: block === null ? INDEFINITE : block,
    minInline: inline === null ? inlineMinMax.min : inline,
    maxInline: inline === null ? (inlineMinMax.max === null ? LU_MAX : inlineMinMax.max) : inline,
    minBlock: block === null ? blockMinMax.min : block,
    maxBlock: block === null ? (blockMinMax.max === null ? LU_MAX : blockMinMax.max) : block,
  };
}

// css-grid-2 §12: lays out a grid container's items; offsets are relative to its border box.
export function layoutGridContainer(ctx: Ctx, box: LayoutBox, a: GridArgs): GridResult {
  const s = box.style;
  const available = availableFrom(a.contentWidth, a.definiteInnerHeight, a.innerHeightMinMax, { min: ZERO, max: null });
  const grid = buildGrid(ctx, box, a.pad, a.bor, available);
  initializeTrackSizes(ctx, grid, 'columns');
  initializeTrackSizes(ctx, grid, 'rows');
  completeTrackSizing(ctx, grid, 'columns', 'layout', false);
  let again = completeTrackSizing(ctx, grid, 'rows', 'layout', true);
  const rowsSpan = fullSpanSize(grid.rows);
  const intrinsicContent = rowsSpan === INDEFINITE ? ZERO : rowsSpan;
  if (available.block === INDEFINITE) {
    const vbp = add(grid.bsp.top, grid.bsp.bottom);
    const minMaxBorder: MinMax = { min: add(a.innerHeightMinMax.min, vbp), max: a.innerHeightMinMax.max === null ? null : add(a.innerHeightMinMax.max, vbp) };
    const blockSize = constrain(add(intrinsicContent, vbp), minMaxBorder);
    const resolved = clampNegativeToZero(sub(blockSize, vbp));
    available.block = resolved;
    available.minBlock = resolved;
    available.maxBlock = resolved;
    const rowGapPercent = s.rowGap.kind === 'percent' && !ctx.gridFaults.percentNotReresolved;
    again = again || rowGapPercent || (grid.rows.props.dependent && !ctx.gridFaults.percentNotReresolved);
    if (!again && s.alignContent !== 'normal') {
      const first = firstSetGeometry(grid, grid.rows, available.block);
      finalizeGeometry(grid.rows, first.start, first.gutter);
    }
  }
  if (again) {
    initializeTrackSizes(ctx, grid, 'columns');
    completeTrackSizing(ctx, grid, 'columns', 'layout', false);
    initializeTrackSizes(ctx, grid, 'rows');
    completeTrackSizing(ctx, grid, 'rows', 'layout', false);
  }
  return placeItems(ctx, grid, a, intrinsicContent);
}

/** Blink PlaceGridItems and GridBaselineAccumulator (first baseline only; no item is baseline-aligned). */
function placeItems(ctx: Ctx, grid: GridState, a: GridArgs, intrinsicContent: LU): GridResult {
  const placed: Placed[] = [];
  const borderBoxWidth = add(a.contentWidth, add(add(a.pad.left, a.pad.right), add(a.bor.left, a.bor.right)));
  let baseline: LU | null = null;
  let baselineRow = 0;
  let baselineColumn = 0;
  for (const item of grid.items) {
    const inlineOffset = setOffset(grid.columns, item.columnSets.begin);
    const blockOffset = setOffset(grid.rows, item.rowSets.begin);
    const areaInline = areaSize(grid.columns, item.columnSets);
    const areaBlock = areaSize(grid.rows, item.rowSets);
    const r = layoutItem(ctx, grid, item, areaInline, areaBlock);
    const m = r.margins;
    const x = add(inlineOffset, alignmentOffset(ctx, areaInline, r.frag.width, m.inlineStart, m.inlineEnd, item.columnEdge, item.columnSafe));
    const y = add(blockOffset, alignmentOffset(ctx, areaBlock, r.frag.height, m.blockStart, m.blockEnd, item.rowEdge, item.rowSafe));
    const physicalX = grid.rtl ? sub(sub(borderBoxWidth, x), r.frag.width) : x;
    // css-grid-2 §9: relative offsets resolve against the grid area.
    const offset = relativeOffset(item.box, areaInline, { kind: 'definite', value: areaBlock }, directionOf(ctx, grid.box));
    placed.push({ frag: r.frag, x: add(physicalX, offset.dx), y: add(y, offset.dy) });
    const before = baseline === null || item.row.start < baselineRow || (item.row.start === baselineRow && item.column.start < baselineColumn);
    if (before) {
      baseline = add(y, r.frag.baseline === null ? r.frag.height : r.frag.baseline);
      baselineRow = item.row.start;
      baselineColumn = item.column.start;
    }
  }
  return { contentHeight: intrinsicContent, placed, baseline, outOfFlow: [] };
}

/** Blink AlignmentOffset (layout_utils.cc): unsafe unless auto margins align (Chrome deviation grid-default-self-overflow-unsafe). */
function alignmentOffset(ctx: Ctx, container: LU, size: LU, marginStart: LU, marginEnd: LU, edge: GridAxisEdge, safe: boolean): LU {
  const overflow = sub(sub(sub(container, size), marginStart), marginEnd);
  const free = safe ? clampNegativeToZero(overflow) : overflow;
  if (edge === 'start') return marginStart;
  if (edge === 'center') return add(marginStart, ctx.gridFaults.centerFloors ? floorHalf(free) : divInt(free, 2));
  return add(marginStart, free);
}

/** Planted fault gridCenterFloors: half the free space rounded toward negative infinity. */
function floorHalf(v: LU): LU {
  const t = divInt(v, 2);
  return mulInt(t, 2) === v || v >= 0 ? t : sub(t, 1 as LU);
}

// ---- Intrinsic inline sizes (Blink GridLayoutAlgorithm::ComputeMinMaxSizes, GR18) ------------------------------------------

/** css-grid-2 §12.1 with css-sizing-3 §5: the grid container's min- or max-content inline size, content box. */
export function gridIntrinsicContentInlineSize(ctx: Ctx, box: LayoutBox, kind: 'min' | 'max'): LU {
  const s = box.style;
  const pad = resolvePadding(s, ZERO);
  const bor = resolveBorder(s, ctx.devicePixelRatio);
  const vbp = sumEdges(bor.top, bor.bottom, pad.top, pad.bottom);
  const hbp = sumEdges(bor.left, bor.right, pad.left, pad.right);
  const height = s.height.kind === 'px' ? contentBox(borderBoxFromSpecified(fromCssPx(s.height.value), vbp, s.boxSizing), vbp) : null;
  const blockMm: MinMax = {
    min: s.minHeight.kind === 'px' ? contentBox(borderBoxFromSpecified(fromCssPx(s.minHeight.value), vbp, s.boxSizing), vbp) : ZERO,
    max: s.maxHeight.kind === 'px' ? contentBox(borderBoxFromSpecified(fromCssPx(s.maxHeight.value), vbp, s.boxSizing), vbp) : null,
  };
  const inlineMm: MinMax = {
    min: s.minWidth.kind === 'px' ? contentBox(borderBoxFromSpecified(fromCssPx(s.minWidth.value), hbp, s.boxSizing), hbp) : ZERO,
    max: s.maxWidth.kind === 'px' ? contentBox(borderBoxFromSpecified(fromCssPx(s.maxWidth.value), hbp, s.boxSizing), hbp) : null,
  };
  const available = availableFrom(null, height, blockMm, inlineMm);
  const grid = buildGrid(ctx, box, pad, bor, available);
  const constraint: GridSizing = kind === 'min' ? 'min-content' : 'max-content';
  initializeTrackSizes(ctx, grid, 'columns');
  initializeTrackSizes(ctx, grid, 'rows');
  const again = completeTrackSizing(ctx, grid, 'columns', constraint, false);
  if (again || grid.items.some((i) => i.sizingDependsOnBlockSize)) {
    const more = completeTrackSizing(ctx, grid, 'rows', constraint, !again);
    if (more || again) {
      initializeTrackSizes(ctx, grid, 'columns');
      completeTrackSizing(ctx, grid, 'columns', constraint, false);
    }
  }
  const span = fullSpanSize(grid.columns);
  return span === INDEFINITE ? ZERO : span;
}

export type { Direction };
