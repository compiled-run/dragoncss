// Greedy line fitting (docs/decisions.md, "Text strategy"): given the break opportunities (linebreak.ts) and the platform's glyph
// advances, choose the breaks the way Blink's LineBreaker does for white-space: normal text:
// - a line fits when its width, rounded up to a LayoutUnit (1/64 px), is at most the available width plus one LayoutUnit
//   (NGLineBreaker: the line's snapped width against AvailableWidthToFit, which adds LayoutUnit::Epsilon);
// - a word that does not fit on an empty line overflows; it is never broken inside (overflow-wrap: normal);
// - spaces that end a line hang: they do not count toward its width (css-text-3 §4.1.3);
// - a line that ends at a soft-hyphen opportunity shows a hyphen, whose advance counts toward its width.
// Pure: every input is an argument; there is no measuring callback (the advances are precomputed per code point).
import type { BreakOpportunity } from './linebreak.ts';
import type { LU } from './units.ts';
import { add, fromPxCeil, fromRaw } from './units.ts';

/** One line: code points [start, end); [start, visibleEnd) is what it shows (end minus the spaces that hang). */
export type FitLine = {
  readonly start: number;
  readonly end: number;
  readonly visibleEnd: number;
  /** The advance of [start, visibleEnd), plus the hyphen advance when hyphenated. */
  readonly width: number;
  /** The line ends at a soft-hyphen opportunity and shows a hyphen. */
  readonly hyphenated: boolean;
  /** The line is wider than the available width (an unbreakable word). */
  readonly overflows: boolean;
};

export type FitResult = { readonly ok: true; readonly lines: readonly FitLine[] } | { readonly ok: false; readonly reason: string };

/** Planted faults for the oracle tests. */
export type FitFaults = {
  /** Compare the rounded width with the available width without Blink's 1/64 px epsilon. */
  readonly noEpsilon: boolean;
  /** Break an overflowing word at the last code point that fits, as native engines do, instead of letting it overflow. */
  readonly breakInsideWord: boolean;
};

export const NO_FIT_FAULTS: FitFaults = { noEpsilon: false, breakInsideWord: false };

/** Spaces that hang at the end of a line: U+0020 and U+3000 (other space separators are refused by linebreak.ts). */
export function isHangingSpace(cp: number): boolean {
  return cp === 0x20 || cp === 0x3000;
}

/** LayoutUnit::Epsilon: one raw LayoutUnit, 1/64 px. */
const EPSILON: LU = fromRaw(1);

/** Blink's fit test: LayoutUnit::FromFloatCeil(width) is at most the available width plus LayoutUnit::Epsilon. */
export function fitsAvailable(width: number, available: LU, faults: FitFaults): boolean {
  const snapped = fromPxCeil(width);
  return faults.noEpsilon ? snapped <= available : snapped <= add(available, EPSILON);
}

function visibleEndOf(text: readonly number[], start: number, end: number): number {
  let e = end;
  while (e > start && isHangingSpace(text[e - 1] as number)) e--;
  return e;
}

function sumAdvances(advances: readonly number[], start: number, end: number): number {
  let w = 0;
  for (let i = start; i < end; i++) w += advances[i] as number;
  return w;
}

function lineOf(text: readonly number[], advances: readonly number[], start: number, end: number, hyphenated: boolean, hyphenAdvance: number, available: LU, faults: FitFaults): FitLine {
  const visibleEnd = visibleEndOf(text, start, end);
  const width = sumAdvances(advances, start, visibleEnd) + (hyphenated ? hyphenAdvance : 0);
  return { start, end, visibleEnd, width, hyphenated, overflows: !fitsAvailable(width, available, faults) };
}

/** Greedy line breaking with a planted fault set. */
export function fitLinesWith(
  text: readonly number[],
  advances: readonly number[],
  opportunities: readonly BreakOpportunity[],
  available: LU,
  hyphenAdvance: number,
  faults: FitFaults,
): FitResult {
  if (advances.length !== text.length) return { ok: false, reason: `${advances.length} advances for ${text.length} code points` };
  let prev = 0;
  for (const o of opportunities) {
    if (o.position <= prev || o.position >= text.length) return { ok: false, reason: `opportunity ${o.position} is out of order or out of range` };
    prev = o.position;
  }
  const lines: FitLine[] = [];
  let start = 0;
  while (start < text.length) {
    // The candidate ends after start: every later opportunity, then the end of the text.
    let bestEnd = -1;
    let bestHyphen = false;
    let overflowEnd = -1;
    let overflowHyphen = false;
    let k = 0;
    while (k < opportunities.length && (opportunities[k] as BreakOpportunity).position <= start) k++;
    let done = false;
    while (!done) {
      const atEnd = k >= opportunities.length;
      const end = atEnd ? text.length : (opportunities[k] as BreakOpportunity).position;
      const hyphen = !atEnd && (opportunities[k] as BreakOpportunity).kind === 'soft-hyphen';
      const visibleEnd = visibleEndOf(text, start, end);
      const width = sumAdvances(advances, start, visibleEnd) + (hyphen ? hyphenAdvance : 0);
      if (fitsAvailable(width, available, faults)) {
        bestEnd = end;
        bestHyphen = hyphen;
        if (atEnd) done = true;
      } else {
        if (bestEnd < 0) {
          overflowEnd = end;
          overflowHyphen = hyphen;
        }
        done = true;
      }
      k++;
    }
    if (bestEnd < 0 && faults.breakInsideWord) {
      // Fault: break the overflowing word after the last code point that fits (at least one code point per line).
      let cut = start + 1;
      while (cut + 1 < overflowEnd && fitsAvailable(sumAdvances(advances, start, cut + 1), available, faults)) cut++;
      lines.push(lineOf(text, advances, start, cut, false, hyphenAdvance, available, faults));
      start = cut;
    } else if (bestEnd < 0) {
      lines.push(lineOf(text, advances, start, overflowEnd, overflowHyphen, hyphenAdvance, available, faults));
      start = overflowEnd;
    } else {
      lines.push(lineOf(text, advances, start, bestEnd, bestHyphen, hyphenAdvance, available, faults));
      start = bestEnd;
    }
  }
  return { ok: true, lines };
}

/**
 * Greedy line breaking: text is the run's code points, advances the platform's advance of each code point (a ligature's advance
 * on its first code point, 0 on the rest; U+00AD 0), opportunities from lineBreakOpportunities, available the line width,
 * hyphenAdvance the advance of the hyphen glyph shown at a soft-hyphen break.
 */
export function fitLines(text: readonly number[], advances: readonly number[], opportunities: readonly BreakOpportunity[], available: LU, hyphenAdvance: number): FitResult {
  return fitLinesWith(text, advances, opportunities, available, hyphenAdvance, NO_FIT_FAULTS);
}

/** The code point indices where lines after the first start. */
export function lineBreaks(lines: readonly FitLine[]): readonly number[] {
  return lines.slice(1).map((l) => l.start);
}
