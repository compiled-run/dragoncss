// css-multicol-1 for a multi-column container whose content is one inline formatting context, ported from Blink 145:
// column_layout_algorithm.cc (column geometry, ResolveColumnAutoBlockSize and the LayoutLine stretch loop), length_utils.cc
// (ResolveUsedColumnCount), layout_unit_diffuser.h (column offsets) and, for breaks between lines, block_layout_algorithm.cc
// (BreakBeforeChildIfNeeded and FinalizeForFragmentation) with fragmentation_utils.cc (MovePastBreakpoint, space shortage).
import type { GapValue, MulticolStyle } from './input.ts';
import type { LU } from './units.ts';
import { add, clampNegativeToZero, computedPixelSize, divInt, divLu, fromCssPx, fromPxCeil, fromRaw, intDiv, intMod, LU_PER_PX, max, sub, toFloat, ZERO } from './units.ts';

/** The orphans and widows initial values (css-break-3 §4.2), the only ones the engine takes. */
const ORPHANS = 2;
const WIDOWS = 2;

/** The used column geometry of a multicol container: the used column count, one column's inline size, and the inline stride. */
export type ColumnGeometry = { readonly count: number; readonly width: LU; readonly stride: LU };

/** Lines split into columns: the first line of each column, and the column block size every column has. */
export type ColumnBreaks = { readonly starts: readonly number[]; readonly height: LU };

/**
 * CombinedColumnGapSize: gapCount column gaps together, a px gap times the count in float (Length::Multiplied), normal the
 * container's computed font size each, as one LayoutUnit. ResolveUsedColumnGap takes normal as ComputedPixelSize, the size
 * rounded to a whole px (measured at DPR 2.625: 10px Ahem zooms to 26.25px and its columns are 26px apart). The caller refuses a
 * percentage or calculated gap.
 */
export function combinedColumnGap(gap: GapValue, fontSize: number, gapCount: number): LU {
  if (gapCount < 1) return ZERO;
  const one = gap.kind === 'px' ? gap.value : computedPixelSize(fontSize);
  return fromCssPx(Math.fround(Math.fround(one) * gapCount));
}

/** ResolveUsedColumnCount: column-count alone, or as many column-width columns with their gaps as fit, at least one. */
export function usedColumnCount(m: MulticolStyle, gap: LU, available: LU): number {
  if (m.width.kind === 'auto') return m.count;
  const width = max(fromRaw(LU_PER_PX), fromCssPx(m.width.value));
  // LayoutUnit::ToInt truncates the quotient's raw value toward zero.
  const quotient = intDiv(divLu(add(available, gap), add(width, gap)), LU_PER_PX);
  const fromWidth = quotient < 1 ? 1 : quotient;
  if (m.count === 0) return fromWidth;
  return m.count < fromWidth ? m.count : fromWidth;
}

/** ColumnLayoutAlgorithm::Layout: the column inline size is the content box less count - 1 gaps over count; the stride adds count gaps. */
export function columnGeometry(m: MulticolStyle, gap: GapValue, fontSize: number, available: LU): ColumnGeometry {
  const count = usedColumnCount(m, combinedColumnGap(gap, fontSize, 1), available);
  const combined = clampNegativeToZero(sub(available, combinedColumnGap(gap, fontSize, count - 1)));
  return { count, width: divInt(combined, count), stride: add(combined, combinedColumnGap(gap, fontSize, count)) };
}

/**
 * The inline offset of each of n columns from the content box's inline start: LayoutUnitDiffuser spreads the stride's raw
 * remainder over count columns (Bresenham), and starts again for each further count columns.
 */
export function columnOffsets(g: ColumnGeometry, n: number): LU[] {
  const out: LU[] = [];
  const base = divInt(g.stride, g.count);
  const remainder = intMod(g.stride, g.count);
  let offset = ZERO;
  let x = 0;
  let y = g.count;
  for (let k = 0; k < n; k++) {
    out.push(offset);
    if (intMod(k, g.count) === 0) {
      x = 0;
      y = g.count;
    }
    x += remainder * 2;
    if (x >= y) {
      y += g.count * 2;
      offset = add(offset, add(base, fromRaw(1)));
    } else offset = add(offset, base);
  }
  return out;
}

/** One column laid out from line start: the line it ends before, whether that break violates orphans or widows, its shortage (or -1). */
type ColumnResult = { readonly end: number; readonly violating: boolean; readonly shortage: LU };

/** UpdateMinimalSpaceShortage: the least positive shortage; -1 is none yet. */
function leastShortage(current: LU, next: LU): LU {
  if (next <= 0) return current;
  return current < 0 || next < current ? next : current;
}

/**
 * Lays one column of block size height out from line start (BlockLayoutAlgorithm in a column fragmentainer). A line at the
 * column's start is taken even when it overflows (MovePastBreakpoint refuses a break before it) and reports its shortage. At the
 * first line that does not fit, the shortage is reported; with fewer than orphans lines before it (max(orphans, widows) after the
 * first column) the column breaks there, violating orphans; else layout goes on until widows lines would follow the break, and
 * FinalizeForFragmentation breaks early at the right line, which is a perfect break.
 */
function layoutColumn(heights: readonly LU[], start: number, height: LU, first: boolean): ColumnResult {
  let offset = ZERO;
  let count = 0;
  let shortage = fromRaw(-1);
  let firstOverflowing = 0;
  let fitAll = false;
  let violating = false;
  let i = start;
  while (i < heights.length) {
    const h = heights[i] as LU;
    const left = sub(height, offset);
    if (count === 0 || (left >= 0 && h <= left)) {
      if (count === 0 && h > height) shortage = leastShortage(shortage, sub(h, height));
      offset = add(offset, h);
      count++;
      i++;
      continue;
    }
    if (firstOverflowing === 0) {
      shortage = leastShortage(shortage, sub(add(offset, h), height));
      firstOverflowing = count;
    }
    const minimum = first || WIDOWS < ORPHANS ? ORPHANS : WIDOWS;
    if (count < minimum) {
      violating = true;
    } else if (count - firstOverflowing + 1 < WIDOWS) {
      offset = add(offset, h);
      count++;
      i++;
      continue;
    }
    fitAll = true;
    break;
  }
  if (firstOverflowing > 0 && firstOverflowing < count) {
    const kept = count < ORPHANS ? count : ORPHANS;
    const line = fitAll ? firstOverflowing : count - WIDOWS > kept ? count - WIDOWS : kept;
    return { end: start + line, violating: false, shortage };
  }
  return { end: i, violating, shortage };
}

/**
 * ResolveColumnAutoBlockSize then LayoutLine, for lines without forced breaks: the columns start at the content's block size over
 * the column count (LayoutUnit::FromFloatCeil of the float quotient), at least the tallest line, and while a break violates orphans
 * or widows or more columns than count are needed, they stretch by the least space shortage of any column and are laid out again.
 */
export function balanceColumns(heights: readonly LU[], count: number): ColumnBreaks {
  let content = ZERO;
  // A line box is monolithic (PhysicalFragment::IsMonolithic), so the initial pass reports the tallest line as unbreakable.
  let tallest = ZERO;
  for (const h of heights) {
    content = add(content, h);
    tallest = max(tallest, h);
  }
  let height = tallest >= content ? tallest : max(fromPxCeil(Math.fround(toFloat(content) / Math.fround(count))), tallest);
  for (;;) {
    const starts: number[] = [0];
    let shortage = fromRaw(-1);
    let violating = false;
    let at = 0;
    for (;;) {
      const r = layoutColumn(heights, at, height, starts.length === 1);
      shortage = leastShortage(shortage, r.shortage);
      at = r.end;
      if (at >= heights.length) break;
      violating = violating || r.violating;
      starts.push(at);
    }
    if (!violating && starts.length <= count) return { starts, height };
    // A single column has no soft break to move; Blink gives up (used_column_count_ <= forced_break_count + 1).
    if (count <= 1 || shortage <= 0) return { starts, height };
    height = add(height, shortage);
  }
}
