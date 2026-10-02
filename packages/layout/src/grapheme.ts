// UAX #29 extended grapheme cluster boundaries (Unicode 16.0.0, the version of ICU 77 in Chrome 145), written from the
// specification's rules GB3 to GB999 over the generated properties (grapheme-data.ts). The break-character opportunities of
// overflow-wrap: anywhere and break-word (css-text-3 §5.5) are these boundaries.
import {
  GCB_CONTROL, GCB_CR, GCB_EXTEND, GCB_L, GCB_LF, GCB_LV, GCB_LVT, GCB_PREPEND, GCB_REGIONAL_INDICATOR, GCB_RUN_VALUES, GCB_SPACINGMARK,
  GCB_STARTS, GCB_T, GCB_V, GCB_ZWJ, INCB_CONSONANT, INCB_EXTEND, INCB_LINKER, INCB_RUN_VALUES, INCB_STARTS, PICT_ENDS, PICT_STARTS,
} from './grapheme-data.ts';

/** The index of the last start at or before cp (starts[0] is 0), by a power-of-two search. */
function runIndex(starts: readonly number[], cp: number): number {
  let step = 1;
  while (step * 2 <= starts.length) step = step * 2;
  let pos = 0;
  while (step >= 1) {
    if (pos + step < starts.length && (starts[pos + step] as number) <= cp) pos = pos + step;
    step = step / 2;
  }
  return pos;
}

/** The Grapheme_Cluster_Break value code of cp (grapheme-data.ts GCB_*). */
export function graphemeBreakProperty(cp: number): number {
  return GCB_RUN_VALUES[runIndex(GCB_STARTS, cp)] as number;
}

function incbOf(cp: number): number {
  return INCB_RUN_VALUES[runIndex(INCB_STARTS, cp)] as number;
}

function isPictographic(cp: number): boolean {
  if (cp < (PICT_STARTS[0] as number)) return false;
  const i = runIndex(PICT_STARTS, cp);
  return cp <= (PICT_ENDS[i] as number);
}

function isControlLike(p: number): boolean {
  return p === GCB_CONTROL || p === GCB_CR || p === GCB_LF;
}

// GB9c: \p{InCB=Consonant} [\p{InCB=Extend}\p{InCB=Linker}]* \p{InCB=Linker} [\p{InCB=Extend}\p{InCB=Linker}]* × \p{InCB=Consonant}.
function conjunctBefore(cps: readonly number[], i: number): boolean {
  let linker = false;
  for (let j = i - 1; j >= 0; j--) {
    const v = incbOf(cps[j] as number);
    if (v === INCB_LINKER) linker = true;
    else if (v === INCB_CONSONANT) return linker;
    else if (v !== INCB_EXTEND) return false;
  }
  return false;
}

// GB11: \p{Extended_Pictographic} Extend* ZWJ × \p{Extended_Pictographic}; cps[i - 1] is the ZWJ.
function pictographicZwjBefore(cps: readonly number[], i: number): boolean {
  for (let j = i - 2; j >= 0; j--) {
    const cp = cps[j] as number;
    if (graphemeBreakProperty(cp) === GCB_EXTEND) continue;
    return isPictographic(cp);
  }
  return false;
}

/**
 * Whether there is an extended grapheme cluster boundary before each code point of cps (index 0, start of text, is a boundary;
 * the end of text, also one, is not listed). Planted fault codePoints: every code point boundary is a grapheme boundary.
 */
export function graphemeBreaksWith(cps: readonly number[], codePoints: boolean): boolean[] {
  const out: boolean[] = [];
  // Whether an odd number of Regional_Indicator code points ends just before the current one.
  let riOdd = false;
  for (let i = 0; i < cps.length; i++) {
    const c = graphemeBreakProperty(cps[i] as number);
    if (i === 0 || codePoints) {
      out.push(true);
      riOdd = c === GCB_REGIONAL_INDICATOR;
      continue;
    }
    const p = graphemeBreakProperty(cps[i - 1] as number);
    let brk = true;
    if (p === GCB_CR && c === GCB_LF) brk = false; // GB3
    else if (isControlLike(p) || isControlLike(c)) brk = true; // GB4, GB5
    else if (p === GCB_L && (c === GCB_L || c === GCB_V || c === GCB_LV || c === GCB_LVT)) brk = false; // GB6
    else if ((p === GCB_LV || p === GCB_V) && (c === GCB_V || c === GCB_T)) brk = false; // GB7
    else if ((p === GCB_LVT || p === GCB_T) && c === GCB_T) brk = false; // GB8
    else if (c === GCB_EXTEND || c === GCB_ZWJ || c === GCB_SPACINGMARK) brk = false; // GB9, GB9a
    else if (p === GCB_PREPEND) brk = false; // GB9b
    else if (incbOf(cps[i] as number) === INCB_CONSONANT && conjunctBefore(cps, i)) brk = false; // GB9c
    else if (p === GCB_ZWJ && isPictographic(cps[i] as number) && pictographicZwjBefore(cps, i)) brk = false; // GB11
    else if (p === GCB_REGIONAL_INDICATOR && c === GCB_REGIONAL_INDICATOR && riOdd) brk = false; // GB12, GB13
    out.push(brk);
    riOdd = c === GCB_REGIONAL_INDICATOR ? !riOdd : false;
  }
  return out;
}

/** UAX #29 extended grapheme cluster boundaries before each code point of cps (index 0 is a boundary). */
export function graphemeBreaks(cps: readonly number[]): boolean[] {
  return graphemeBreaksWith(cps, false);
}
