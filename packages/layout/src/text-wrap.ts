// css-text-4 §5.1 text-wrap-style: balance and pretty, the score pass of Blink 145's line breaker
// (third_party/blink/renderer/core/layout/inline/score_line_breaker.cc ScoreLineBreaker::Optimize, ComputeScores and
// ComputeBreakPoints), over the break candidates inline.ts builds from the greedy lines (line_break_candidate.cc). Blink keeps every
// score in float, so each step is rounded to float here. Text is never justified here (inline.ts refuses text-align: justify with a
// text-wrap-style other than auto), so the justified branches of ComputeScores and SetupParameters are not ported.

/**
 * One break candidate (line_break_candidate.h LineBreakCandidate): the item the next line would start at (offset), the position
 * there when the line does not break (posNoBreak), the position of the line's end without its trailing spaces when it does
 * (posIfBreak), both in float px from the first candidate, and the penalty of breaking there.
 */
export type WrapCandidate = { readonly offset: number; readonly posNoBreak: number; readonly posIfBreak: number; readonly penalty: number };

/** ScoreLineBreaker::kScoreInfinity, std::numeric_limits<float>::max(). */
const SCORE_INFINITY = 3.4028234663852886e38;
/** ScoreLineBreaker::kScoreOverfull, 1e12f: the float nearest 1e12. */
const SCORE_OVERFULL = 999999995904;
/** ScoreLineBreaker::kLastLinePenaltyMultiplier. */
const LAST_LINE_PENALTY_MULTIPLIER = 4;
/** Optimize: kOrphansPenalty, scaled by the zoom. */
const ORPHANS_PENALTY = 10000;
/** Optimize: kMinCandidates, besides the two sentinels. */
const MIN_CANDIDATES = 3;

/**
 * ScoreLineBreaker::SetupParameters without justification: the line penalty, twice the hyphen penalty, which is twice the available
 * width times the block's computed font size, unzoomed once. available is line_widths_.Default() clamped to zero, in float px.
 */
export function linePenaltyOf(available: number, fontSize: number, zoom: number): number {
  const widthTimesFontSize = Math.fround(Math.fround(Math.fround(available) * Math.fround(fontSize)) / Math.fround(zoom));
  const hyphenPenalty = Math.fround(widthTimesFontSize * 2);
  return Math.fround(hyphenPenalty * 2);
}

/**
 * ScoreLineBreaker::Optimize from ComputeCandidates on: the candidate indices each line of the paragraph ends at, in order (the last
 * is the final candidate), or null where Blink does not optimize: fewer than three break opportunities. The orphans penalty is
 * added to the last opportunity (no candidate here is hyphenated). availableToFit is AvailableWidthToFit, the available width plus
 * one LayoutUnit, in float px; balanced is is_balanced_ (text-wrap-style: balance).
 */
export function scoreBreakPoints(candidates: readonly WrapCandidate[], availableToFit: number, linePenalty: number, zoom: number, balanced: boolean): number[] | null {
  const n = candidates.length;
  if (n < MIN_CANDIDATES + 2) return null;
  const orphans = Math.fround(ORPHANS_PENALTY * Math.fround(zoom));
  const penalties: number[] = [];
  for (let k = 0; k < n; k++) {
    const penalty = Math.fround((candidates[k] as WrapCandidate).penalty);
    penalties.push(k === n - 2 ? Math.fround(penalty + orphans) : penalty);
  }
  // ComputeScores: a dynamic program over line ends, each end's best score over every line start since the last overfull one.
  const scores: number[] = [0];
  const prevs: number[] = [0];
  let active = 0;
  const fit = Math.fround(availableToFit);
  for (let end = 1; end < n; end++) {
    const endCandidate = candidates[end] as WrapCandidate;
    const last = end === n - 1;
    let best = SCORE_INFINITY;
    let bestPrev = 0;
    const startEdge = Math.fround(Math.fround(endCandidate.posIfBreak) - fit);
    let bestHope = 0;
    for (let start = active; start < end; start++) {
      const startScore = scores[start] as number;
      if (Math.fround(startScore + bestHope) >= best) continue;
      const delta = Math.fround(Math.fround((candidates[start] as WrapCandidate).posNoBreak) - startEdge);
      let widthScore = 0;
      let additional = 0;
      if (delta < 0) widthScore = SCORE_OVERFULL;
      else if (last && !balanced) additional = Math.fround(LAST_LINE_PENALTY_MULTIPLIER * (penalties[start] as number));
      else widthScore = Math.fround(Math.fround(delta * delta) / Math.fround(zoom));
      if (delta < 0) active = start + 1;
      else bestHope = widthScore;
      const score = Math.fround(Math.fround(startScore + widthScore) + additional);
      if (score <= best) {
        best = score;
        bestPrev = start;
      }
    }
    scores.push(Math.fround(Math.fround(best + (penalties[end] as number)) + Math.fround(linePenalty)));
    prevs.push(bestPrev);
  }
  // ComputeBreakPoints: back from the last candidate along the best previous breaks.
  const reversed: number[] = [];
  let i = n - 1;
  while (i > 0) {
    reversed.push(i);
    i = prevs[i] as number;
  }
  const out: number[] = [];
  for (let k = reversed.length - 1; k >= 0; k--) out.push(reversed[k] as number);
  return out;
}
