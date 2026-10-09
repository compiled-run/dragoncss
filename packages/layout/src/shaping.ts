// Real-font text measurement (TXT1-S; docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md §2 R1, R2, R5). The host shapes with
// HarfBuzz through GlyphShaper and returns integers only; everything after that is Blink 145's arithmetic, ported from
// packages/text-shaper/src/blink.ts: RunSegmenter's script runs (run_segmenter.cc, script_run_iterator.cc), HanKerning
// (han_kerning.cc), ShapeResult runs (shape_result.cc), ShapeResultView parts (shape_result_view.cc), ShapingLineBreaker's
// reshaping at line edges (shaping_line_breaker.cc) and LayoutUnit::FromFloatCeil. Unreached until TXT1a-1 wires it in.
import type { TextFont } from './input.ts';
import { isEastAsian } from './linebreak.ts';
import {
  bracketIndex, BRACKET_OPEN, BRACKET_PAIRS, isClosePunctuation, isExtendedPictographic, isLatinText, isMark, isOpenPunctuation, SCRIPT_TAGS, scriptCode, scriptExtensions,
  USCRIPT_BOPOMOFO, USCRIPT_COMMON, USCRIPT_HAN, USCRIPT_HIRAGANA, USCRIPT_INHERITED, USCRIPT_KATAKANA, USCRIPT_LATIN,
} from './script-data.ts';
import type { FontData, FontLengths, FontMetrics, MeasureResult, TextMeasurer } from './text.ts';
import { fontMetricLengths } from './text.ts';
import type { TextRefusalCode } from './unsupported.ts';
import type { LU } from './units.ts';
import {
  add, floatAdd, floorToWholePx, fontMetricPx, fromPxCeil, fromRaw, inlineToFloat, inlineToLayoutUnitCeil, neg, platformFontSize, roundCoreTextMetricToWholePx,
  roundFontMetricHalfUpToWholePx, sub, toFloat, toPx, ZERO,
} from './units.ts';

/** Integers per shaped glyph: glyph id, cluster (UTF-16 offset in the text), x advance, y advance, x offset, y offset (16.16), flags. */
export const GLYPH_STRIDE = 7;
/** Integers per feature record: OpenType tag (big-endian uint32), value, start, end (UTF-16 offsets; FEATURE_TO_END is open). */
export const FEATURE_STRIDE = 4;
export const FEATURE_TO_END = 4294967295;
export const TAG_KERN = 1801810542;
export const TAG_HALT = 1751215220;
export const TAG_CHWS = 1667790707;

/**
 * R1, amended by the PM (T082 B2): the host's HarfBuzz. Shapes text[start, end) with the whole text as context, at the font size
 * in px, with an ISO 15924 script tag, and returns GLYPH_STRIDE integers per glyph.
 */
export interface GlyphShaper {
  shape(face: string, size: number, text: string, start: number, end: number, script: string, rtl: boolean, language: string, features: readonly number[]): readonly number[];
}

/** HanKerning::FontData (han_kerning.cc) of a face for the measurer's language, read by the host from GPOS and glyph bounds. */
export type HanKerningFontData = {
  readonly hasAlternateSpacing: boolean;
  readonly hasContextualSpacing: boolean;
  readonly typeForDot: number;
  readonly typeForColon: number;
  readonly typeForSemicolon: number;
  readonly isQuoteFullwidth: boolean;
};

/** A bundled face as the host read it: its id for GlyphShaper, its vertical metrics, and its HanKerning data. */
export type ShapedFace = { readonly id: string; readonly data: FontData; readonly hanKerning: HanKerningFontData };

/** Planted faults: each must change at least one gate width (packages/layout/test/shaping-gate.test.ts). */
export type ShapingFaults = {
  /** Sum glyph advances as floats instead of 16.16 InlineLayoutUnits. */
  readonly advanceNot16_16: boolean;
  /** Keep run, part and line widths in double instead of float, through FromFloatCeil. */
  readonly doubleAccumulation: boolean;
  /** Keep the item's glyphs at both edges of a wrapped line instead of reshaping there. */
  readonly noReshapeAtBreak: boolean;
  /** Turn off `kern`. */
  readonly kerningDropped: boolean;
  /** Round glyph advances to whole pixels (Blink's path for fonts without subpixel positioning). */
  readonly wholePixelPositions: boolean;
  /** Leave out the generated hyphen at a soft hyphen break. */
  readonly softHyphenWidthMissing: boolean;
  /** Round ascent and descent from the unquantised size * units / upem, halves up (T005's rule), instead of Core Text's 16.16 value. */
  readonly metricRoundingSwapped: boolean;
};

export const NO_SHAPING_FAULTS: ShapingFaults = {
  advanceNot16_16: false, doubleAccumulation: false, noReshapeAtBreak: false, kerningDropped: false, wholePixelPositions: false, softHyphenWidthMissing: false,
  metricRoundingSwapped: false,
};

// ---------------------------------------------------------------------------------------------------------------------------
// Text as UTF-16 positions

const SOFT_HYPHEN = 0xad;

/** Per UTF-16 offset: the code point starting there, or -1 for the second unit of a surrogate pair. */
function utf16Units(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    out.push(cp);
    if (cp > 0xffff) out.push(-1);
  }
  return out;
}

function hasUnitAbove(units: readonly number[], start: number, end: number, limit: number): boolean {
  for (let i = start; i < end; i++) if ((units[i] as number) > limit) return true;
  return false;
}

function contains(xs: readonly number[], v: number, from: number): boolean {
  for (let i = from; i < xs.length; i++) if ((xs[i] as number) === v) return true;
  return false;
}

function indexOfFrom(xs: readonly number[], v: number, from: number): number {
  for (let i = from; i < xs.length; i++) if ((xs[i] as number) === v) return i;
  return -1;
}

function swapped(xs: readonly number[], i: number, j: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < xs.length; k++) out.push((k === i ? xs[j] : k === j ? xs[i] : xs[k]) as number);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// RunSegmenter: script runs for horizontal text

export type ScriptSegment = { readonly start: number; readonly end: number; readonly script: string };
export type SegmentResult = { readonly ok: true; readonly segments: readonly ScriptSegment[] } | { readonly ok: false; readonly reason: string };

/** ICUScriptData::GetScripts. */
function getScripts(cp: number): number[] {
  let dst: number[] = [];
  for (const s of scriptExtensions(cp)) dst.push(s);
  let primary = scriptCode(cp);
  if (primary === USCRIPT_KATAKANA) primary = USCRIPT_HIRAGANA;
  if (primary === (dst[0] as number)) return dst;
  if (primary !== USCRIPT_INHERITED && primary !== USCRIPT_COMMON) {
    const i = indexOfFrom(dst, primary, 1);
    if (i < 0) {
      dst.push(primary);
      return swapped(dst, 0, dst.length - 1);
    }
    return swapped(dst, 0, i);
  }
  if (primary === USCRIPT_COMMON) {
    if (dst.length === 1) return [primary, dst[0] as number];
    for (let i = 1; i < dst.length; i++) {
      if ((dst[0] as number) === USCRIPT_LATIN || (dst[i] as number) < (dst[0] as number)) dst = swapped(dst, 0, i);
    }
    return dst;
  }
  const moved: number[] = [primary];
  for (let i = 1; i < dst.length; i++) moved.push(dst[i] as number);
  moved.push(dst[0] as number);
  dst = moved;
  for (let i = 2; i < dst.length; i++) {
    if ((dst[1] as number) === USCRIPT_LATIN || (dst[i] as number) < (dst[1] as number)) dst = swapped(dst, 1, i);
  }
  return dst;
}

type BracketRec = { readonly ch: number; script: number };
type ScriptRunState = { currentSet: readonly number[]; commonPreferred: number; brackets: BracketRec[]; fixupDepth: number };

const MAX_BRACKETS = 32;

/** ScriptRunIterator::MergeSets. */
function mergeSets(st: ScriptRunState, next: readonly number[]): boolean {
  if (next.length === 0 || st.currentSet.length === 0) return false;
  let priority = st.currentSet[0] as number;
  if ((next[0] as number) <= USCRIPT_INHERITED) {
    if (next.length === 2 && priority <= USCRIPT_INHERITED && st.commonPreferred === USCRIPT_COMMON) st.commonPreferred = next[1] as number;
    return true;
  }
  if (priority <= USCRIPT_INHERITED) {
    st.currentSet = next;
    return true;
  }
  let havePriority = contains(next, priority, 0);
  if (st.currentSet.length === 1) return havePriority;
  let nextFrom = 0;
  if (!havePriority) {
    priority = next[0] as number;
    nextFrom = 1;
    havePriority = contains(st.currentSet, priority, 1);
  }
  const written: number[] = [];
  if (havePriority) written.push(priority);
  if (next.length > nextFrom) {
    for (let i = 1; i < st.currentSet.length; i++) {
      const sc = st.currentSet[i] as number;
      if (contains(next, sc, nextFrom)) written.push(sc);
    }
  }
  if (written.length > 0) {
    st.currentSet = written;
    return true;
  }
  return false;
}

/** ScriptRunIterator::FixupStack. */
function fixupStack(st: ScriptRunState, resolved: number, excludeLast: boolean): void {
  let count = st.fixupDepth < st.brackets.length ? st.fixupDepth : st.brackets.length;
  if (count <= 0) return;
  let idx = st.brackets.length - 1;
  if (excludeLast) {
    idx--;
    count--;
    st.fixupDepth = 1;
  } else {
    st.fixupDepth = 0;
  }
  for (; count > 0; count--) {
    (st.brackets[idx] as BracketRec).script = resolved;
    idx--;
  }
}

/** Blink's segmenter refuses nothing; Dragon refuses what the gate does not prove (emoji runs, marks with unknown flags). */
function refusalOf(units: readonly number[]): string {
  for (const cp of units) {
    if (cp < 0) continue;
    // RunSegmenter's emoji presentation split: text-default Extended_Pictographic keeps text presentation.
    const textDefault = cp === 0x23 || cp === 0x2a || (cp >= 0x30 && cp <= 0x39) || cp === 0xa9 || cp === 0xae || cp === 0x203c || cp === 0x2049 || cp === 0x2122 || cp === 0x2139 || (cp >= 0x2194 && cp <= 0x2199);
    if (isExtendedPictographic(cp) && !textDefault) return `U+${cp.toString(16).toUpperCase()} is emoji; emoji segmentation is outside the shaping core`;
    if (cp > 0xff && isMark(cp)) return `U+${cp.toString(16).toUpperCase()} is a combining mark; ScriptRunIterator's combining-mark handling is outside the shaping core`;
  }
  return '';
}

/** RunSegmenter over the item (horizontal text, orientation keep, text fallback priority). */
export function segmentText(text: string): SegmentResult {
  const units = utf16Units(text);
  const refusal = refusalOf(units);
  if (refusal !== '') return { ok: false, reason: refusal };
  // InlineNode::SegmentScriptRuns: 8-bit text is one Latin segment without running the segmenter.
  if (!hasUnitAbove(units, 0, units.length, 0xff)) return { ok: true, segments: [{ start: 0, end: units.length, script: 'Latn' }] };
  const out: ScriptSegment[] = [];
  const st: ScriptRunState = { currentSet: [USCRIPT_COMMON], commonPreferred: USCRIPT_COMMON, brackets: [], fixupDepth: 0 };
  let runStart = 0;
  const resolve = (): number => ((st.currentSet[0] as number) === USCRIPT_COMMON ? st.commonPreferred : (st.currentSet[0] as number));
  for (let pos = 0; pos < units.length; pos++) {
    const cp = units[pos] as number;
    if (cp < 0) continue;
    let next: readonly number[] = getScripts(cp);
    const b = bracketIndex(cp);
    const isOpen = b >= 0 && (BRACKET_OPEN[b] as number) === 1;
    if (isOpen) {
      if (st.brackets.length === MAX_BRACKETS) {
        st.brackets = st.brackets.slice(1);
        if (st.fixupDepth === MAX_BRACKETS) st.fixupDepth--;
      }
      if (next.length === 1 && (next[0] as number) === USCRIPT_COMMON && isEastAsian(cp)) next = scriptExtensions(0x300c);
      st.brackets.push({ ch: cp, script: USCRIPT_COMMON });
      st.fixupDepth++;
    } else if (b >= 0 && st.brackets.length > 0) {
      const pair = BRACKET_PAIRS[b] as number;
      for (let k = st.brackets.length - 1; k >= 0; k--) {
        const rec = st.brackets[k] as BracketRec;
        if (rec.ch !== pair) continue;
        let script = rec.script;
        if (script === USCRIPT_HAN || script === USCRIPT_HIRAGANA || script === USCRIPT_BOPOMOFO) {
          for (const s of st.currentSet) {
            if (s === USCRIPT_HAN || s === USCRIPT_HIRAGANA || s === USCRIPT_BOPOMOFO) {
              script = s;
              break;
            }
          }
        }
        if (script !== USCRIPT_COMMON) next = [script];
        // Blink pops the entries above the match and keeps the match itself.
        const popped = st.brackets.length - 1 - k;
        const kept: BracketRec[] = [];
        for (let i = 0; i <= k; i++) kept.push(st.brackets[i] as BracketRec);
        st.brackets = kept;
        st.fixupDepth = st.fixupDepth - popped > 0 ? st.fixupDepth - popped : 0;
        break;
      }
    }
    if ((next[0] as number) === USCRIPT_INHERITED && next.length > 1) return { ok: false, reason: `U+${cp.toString(16).toUpperCase()} is inherited with script extensions; outside the shaping core` };
    if (!mergeSets(st, next)) {
      const script = resolve();
      out.push({ start: runStart, end: pos, script: SCRIPT_TAGS[script] as string });
      fixupStack(st, script, isOpen);
      st.currentSet = next;
      runStart = pos;
    }
  }
  out.push({ start: runStart, end: units.length, script: SCRIPT_TAGS[resolve()] as string });
  return { ok: true, segments: out };
}

// ---------------------------------------------------------------------------------------------------------------------------
// HanKerning, text-spacing-trim: normal, horizontal

export const HK_OTHER = 0;
export const HK_OPEN = 1;
export const HK_CLOSE = 2;
export const HK_MIDDLE = 3;
export const HK_DOT = 4;
export const HK_COLON = 5;
export const HK_SEMICOLON = 6;
export const HK_OPEN_QUOTE = 7;
export const HK_CLOSE_QUOTE = 8;
export const HK_OPEN_NARROW = 9;
export const HK_CLOSE_NARROW = 10;

export const NO_HAN_KERNING: HanKerningFontData = {
  hasAlternateSpacing: false, hasContextualSpacing: false, typeForDot: HK_OTHER, typeForColon: HK_OTHER, typeForSemicolon: HK_OTHER, isQuoteFullwidth: false,
};

/** East_Asian_Width=F. */
function isFullwidth(cp: number): boolean {
  return cp === 0x3000 || (cp >= 0xff01 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6);
}

/** Character::GetHanKerningCharType. */
export function hanKerningCharType(cp: number): number {
  if (cp === 0x2018 || cp === 0x201c) return HK_OPEN_QUOTE;
  if (cp === 0x2019 || cp === 0x201d) return HK_CLOSE_QUOTE;
  if (cp === 0x3000 || cp === 0xb7 || cp === 0x2027 || cp === 0x30fb) return HK_MIDDLE;
  if (cp === 0x3001 || cp === 0x3002 || cp === 0xff0c || cp === 0xff0e) return HK_DOT;
  if (cp === 0xff1a) return HK_COLON;
  if (cp === 0xff1b) return HK_SEMICOLON;
  if (cp < 0) return HK_OTHER;
  const cjk = (cp >= 0x3000 && cp <= 0x303f) || isFullwidth(cp);
  if (isOpenPunctuation(cp)) return cjk ? HK_OPEN : HK_OPEN_NARROW;
  if (isClosePunctuation(cp)) return cjk ? HK_CLOSE : HK_CLOSE_NARROW;
  return HK_OTHER;
}

/** Character::MaybeHanKerningOpenOrCloseFast. */
function maybeOpenOrCloseFast(cp: number): boolean {
  return (cp >= 0x2018 && cp <= 0x301f) || (cp >= 0xff08 && cp <= 0xff60);
}

/** Character::MaybeHanKerningClose. */
export function maybeHanKerningClose(cp: number): boolean {
  const t = hanKerningCharType(cp);
  return maybeOpenOrCloseFast(cp) && (t === HK_CLOSE || t === HK_CLOSE_QUOTE);
}

/** HanKerning::MayApply over [start, end): 16-bit text with at least one character in the fast ranges. */
function hanKerningMayApply(units: readonly number[], start: number, end: number): boolean {
  if (!hasUnitAbove(units, start, end, 0xff)) return false;
  for (let i = start; i < end; i++) if (maybeOpenOrCloseFast(units[i] as number)) return true;
  return false;
}

function shouldKern(type: number, last: number): boolean {
  return type === HK_OPEN && (last === HK_OPEN || last === HK_MIDDLE || last === HK_CLOSE || last === HK_OPEN_NARROW);
}

function shouldKernLast(type: number, last: number): boolean {
  return last === HK_CLOSE && (type === HK_CLOSE || type === HK_MIDDLE || type === HK_CLOSE_NARROW);
}

function fontCharType(cp: number, fd: HanKerningFontData): number {
  const t = hanKerningCharType(cp);
  if (t === HK_DOT) return fd.typeForDot;
  if (t === HK_COLON) return fd.typeForColon;
  if (t === HK_SEMICOLON) return fd.typeForSemicolon;
  if (t === HK_OPEN_QUOTE) return fd.isQuoteFullwidth ? HK_OPEN : HK_OPEN_NARROW;
  if (t === HK_CLOSE_QUOTE) return fd.isQuoteFullwidth ? HK_CLOSE : HK_CLOSE_NARROW;
  return t;
}

type RangeFeatures = { readonly features: readonly number[]; readonly unsafeBefore: readonly number[] };
const NO_RANGE_FEATURES: RangeFeatures = { features: [], unsafeBefore: [] };

/** HanKerning::AppendFontFeatures for one shaped range: `halt` on the kerned characters, and offsets that become unsafe to break. */
function hanKerningFeatures(item: ShapeItem, start: number, end: number, isLineStart: boolean, hanStart: boolean, hanEnd: boolean): RangeFeatures {
  const fd = item.hanKerning;
  if (!item.hanKerningMayApply || !hanKerningMayApply(item.units, start, end) || !fd.hasAlternateSpacing) return NO_RANGE_FEATURES;
  const type = (i: number): number => fontCharType(item.units[i] as number, fd);
  const indices: number[] = [];
  const unsafe: number[] = [];
  let last: number;
  if (hanStart) {
    indices.push(start);
    unsafe.push(start);
    last = type(start);
  } else if (start > 0 && !isLineStart) {
    last = type(start - 1);
    const t = type(start);
    if (shouldKern(t, last)) {
      indices.push(start);
      unsafe.push(start);
    }
    last = t;
  } else {
    last = type(start);
  }
  if (fd.hasContextualSpacing) {
    if (hanEnd) indices.push(end - 1);
    else if (end < item.units.length) {
      if (end - 1 > start) last = type(end - 1);
      if (shouldKernLast(type(end), last)) indices.push(end - 1);
    }
  } else {
    for (let i = start + 1; i < end; i++) {
      const t = type(i);
      if (shouldKernLast(t, last)) {
        indices.push(i - 1);
        unsafe.push(i);
      } else if (shouldKern(t, last)) {
        indices.push(i);
        unsafe.push(i);
      }
      last = t;
    }
    if (hanEnd) indices.push(end - 1);
    else if (end < item.units.length && shouldKernLast(type(end), last)) indices.push(end - 1);
  }
  const features: number[] = [];
  for (const i of indices) {
    features.push(TAG_HALT);
    features.push(1);
    features.push(i);
    features.push(i + 1);
  }
  return { features, unsafeBefore: unsafe };
}

// ---------------------------------------------------------------------------------------------------------------------------
// ShapeResult

type ShapingGlyph = { readonly glyph: number; readonly ci: number; readonly advance: number; safe: boolean };
type ShapingRun = { readonly start: number; readonly numChars: number; readonly glyphs: readonly ShapingGlyph[]; readonly width: number };

/** A shaped range [start, end) of the item, with Blink's cached safe-to-break flags and positions per UTF-16 offset. */
export type ShapeResult = {
  readonly start: number;
  readonly end: number;
  readonly runs: readonly ShapingRun[];
  /** ShapeResult::width_: float sum of run widths. */
  readonly width: number;
  /** A code point with no glyph (font fallback is outside the shaping core), or -1. */
  readonly missing: number;
  /** ComputePositionData: safe_to_break_before per offset. */
  readonly safe: readonly boolean[];
  /** ComputePositionData: x_position per offset, raw LayoutUnits. */
  readonly positions: readonly number[];
  /** The 16.16 advance before each offset (total_advance before its first glyph, or the preceding glyph's for an offset without one). */
  readonly raw: readonly number[];
  /** The 16.16 advance sum. */
  readonly total: number;
};

/** One text item (one font) as the shaping core sees it. */
export type ShapeItem = {
  readonly shaper: GlyphShaper;
  readonly face: string;
  readonly size: number;
  readonly text: string;
  readonly units: readonly number[];
  readonly language: string;
  readonly segments: readonly ScriptSegment[];
  /** FontFeatureRange::FromFontDescription for the style: horizontal, font-kerning auto, text-spacing-trim normal. */
  readonly features: readonly number[];
  readonly hanKerning: HanKerningFontData;
  readonly hanKerningMayApply: boolean;
  readonly faults: ShapingFaults;
};

export type ItemInput = {
  readonly shaper: GlyphShaper;
  readonly face: string;
  readonly size: number;
  readonly text: string;
  readonly language: string;
  readonly hanKerning: HanKerningFontData;
  readonly faults: ShapingFaults;
};

export type ItemResult = { readonly ok: true; readonly item: ShapeItem } | { readonly ok: false; readonly reason: string };

export function makeItem(input: ItemInput): ItemResult {
  const seg = segmentText(input.text);
  if (!seg.ok) return { ok: false, reason: seg.reason };
  const units = utf16Units(input.text);
  const features: number[] = [];
  if (input.faults.kerningDropped) {
    features.push(TAG_KERN);
    features.push(0);
    features.push(0);
    features.push(FEATURE_TO_END);
  }
  features.push(TAG_CHWS);
  features.push(1);
  features.push(0);
  features.push(FEATURE_TO_END);
  return {
    ok: true,
    item: {
      shaper: input.shaper, face: input.face, size: input.size, text: input.text, units, language: input.language, segments: seg.segments, features,
      hanKerning: input.hanKerning, hanKerningMayApply: hanKerningMayApply(units, 0, units.length), faults: input.faults,
    },
  };
}

/** A float width from 16.16 advances. Only a run clamps a negative sum to zero (shape_result.cc); a view part does not. */
function sumAdvances(advances: readonly number[], faults: ShapingFaults, clampNegative: boolean): number {
  if (faults.advanceNot16_16) {
    let w = 0;
    for (const a of advances) w = floatAdd(w, inlineToFloat(a));
    return w;
  }
  let total = 0;
  for (const a of advances) total = total + a;
  if (clampNegative && total < 0) total = 0;
  return faults.doubleAccumulation ? total / 65536 : inlineToFloat(total);
}

/** LayoutUnit::FromFloatCeil of a width; under doubleAccumulation the width is an exact 16.16 value kept in double, ceiled exactly. */
function snapWidth(width: number, faults: ShapingFaults): LU {
  return faults.doubleAccumulation ? inlineToLayoutUnitCeil(width * 65536) : fromPxCeil(width);
}

function accumulate(width: number, part: number, faults: ShapingFaults): number {
  return faults.doubleAccumulation ? width + part : floatAdd(width, part);
}

/** RoundHarfBuzzPosition, a planted fault only: the nearest whole pixel, halves up (ceil((raw - 32767) / 65536) pixels). */
function wholePixel(raw: number): number {
  const lu = inlineToLayoutUnitCeil(raw - 32767);
  return (0 - floorToWholePx(neg(lu))) * 1024;
}

/** HarfBuzzShaper::Shape over [start, end) with the item as context. */
function shapeRange(item: ShapeItem, start: number, end: number, isLineStart: boolean, hanStart: boolean, hanEnd: boolean): ShapeResult {
  const runs: ShapingRun[] = [];
  let width = 0;
  let missing = -1;
  const unsafe: number[] = [];
  for (const seg of item.segments) {
    const s = seg.start > start ? seg.start : start;
    const e = seg.end < end ? seg.end : end;
    if (e <= s) continue;
    const extra = hanKerningFeatures(item, s, e, isLineStart && s === start, hanStart && s === start, hanEnd && e === end);
    const features: number[] = [];
    for (const f of item.features) features.push(f);
    for (const f of extra.features) features.push(f);
    for (const u of extra.unsafeBefore) unsafe.push(u);
    const g = item.shaper.shape(item.face, item.size, item.text, s, e, seg.script, false, item.language, features);
    const glyphs: ShapingGlyph[] = [];
    const advances: number[] = [];
    for (let o = 0; o < g.length; o = o + GLYPH_STRIDE) {
      const gid = g[o] as number;
      const cluster = g[o + 1] as number;
      if (gid === 0 && missing < 0) missing = item.units[cluster] as number;
      const flags = g[o + 6] as number;
      const safe = o === 0 ? true : cluster === (g[o + 1 - GLYPH_STRIDE] as number) ? false : Number.isInteger(flags / 2);
      const raw = g[o + 2] as number;
      const advance = item.faults.wholePixelPositions && !Number.isInteger(raw / 65536) ? wholePixel(raw) : raw;
      glyphs.push({ glyph: gid, ci: cluster - s, advance, safe });
      advances.push(advance);
    }
    const run: ShapingRun = { start: s, numChars: e - s, glyphs, width: sumAdvances(advances, item.faults, true) };
    runs.push(run);
    width = accumulate(width, run.width, item.faults);
  }
  // ShapeResult::AddUnsafeToBreak (LTR).
  for (const offset of unsafe) {
    for (const run of runs) {
      const ro = offset - run.start;
      if (ro < 0 || ro >= run.numChars) continue;
      for (const g of run.glyphs) if (g.ci === ro) g.safe = false;
    }
  }
  // ComputePositionData (LTR): the first glyph of each character sets its flag and its ceiled position.
  const n = end - start;
  const safe: boolean[] = [];
  const positions: number[] = [];
  const raw: number[] = [];
  let total = 0;
  let lastX = 0;
  let lastRaw = 0;
  for (const run of runs) {
    for (const g of run.glyphs) {
      const idx = run.start + g.ci - start;
      if (safe.length <= idx) {
        while (safe.length < idx) {
          safe.push(false);
          positions.push(lastX);
          raw.push(lastRaw);
        }
        lastX = inlineToLayoutUnitCeil(total);
        lastRaw = total;
        safe.push(g.safe);
        positions.push(lastX);
        raw.push(lastRaw);
      }
      total = total + g.advance;
    }
  }
  while (safe.length < n) {
    safe.push(false);
    positions.push(lastX);
    raw.push(lastRaw);
  }
  return { start, end, runs, width, missing, safe, positions, raw, total };
}

export function shapeItem(item: ShapeItem): ShapeResult {
  return shapeRange(item, 0, item.units.length, false, false, false);
}

function cachedNextSafeToBreakOffset(result: ShapeResult, offset: number): number {
  for (let i = offset - result.start; i < result.safe.length; i++) if ((result.safe[i] as boolean)) return result.start + i;
  return result.end;
}

function cachedPreviousSafeToBreakOffset(result: ShapeResult, offset: number): number {
  const adj = offset - result.start;
  if (adj >= result.safe.length) return result.end;
  for (let i = adj; i >= 0; i--) if ((result.safe[i] as boolean)) return result.start + i;
  return result.start;
}

/** ShapeResult::CachedPositionForOffset (LTR), raw LayoutUnits. */
function cachedPositionForOffset(result: ShapeResult, offset: number): number {
  const i = offset - result.start;
  return i < result.positions.length ? (result.positions[i] as number) : fromPxCeil(inlineToFloat(result.total));
}

/** ShapeResult::CachedOffsetForPosition (LTR): the last character whose cached position is at or before x (raw LayoutUnits). */
function cachedOffsetForPosition(result: ShapeResult, x: number): number {
  const p = result.positions;
  if (x <= 0) return result.start;
  if (toPx(fromRaw(x)) >= inlineToFloat(result.total)) return result.end;
  let step = 1;
  while (step * 2 <= p.length) step = step * 2;
  let pos = 0;
  while (step >= 1) {
    if (pos + step < p.length && (p[pos + step] as number) <= x) pos = pos + step;
    step = step / 2;
  }
  return result.start + pos;
}

/**
 * ShapingLineBreaker::ShapeLine's candidate break: the last offset whose advance from the line start is at most the available
 * width, measured on the 16.16 advances (ComputePositionData's total_advance) from start, not on the ceiled cached positions.
 * Measured: the gate's 1,260 Chrome 145.0.7632.6 cases (packages/layout/test/shaping-gate.test.ts) break where the 16.16 advance
 * from the line start fits, and the ceiled-position reading of CachedOffsetForPosition breaks 2 Latin lines one opportunity late
 * (Lato/shy/12.48/120, Lato/kernlig/24/120), each with a view one LayoutUnit wider than the available width.
 */
function candidateBreak(result: ShapeResult, start: number, available: number): number {
  const limit = (result.raw[start] as number) + available * 1024;
  if (result.total <= limit) return result.end;
  let candidate = start;
  for (let k = start; k < result.raw.length; k++) {
    if ((result.raw[k] as number) <= limit) candidate = k;
    else break;
  }
  return result.start + candidate;
}

/** A ShapeResultView segment: the characters [start, end) of a ShapeResult. */
type ViewSegment = { readonly result: ShapeResult; readonly start: number; readonly end: number };

/** ShapeResultView::PopulateRunInfoParts: part widths, summed in float. */
function viewWidth(segments: readonly ViewSegment[], faults: ShapingFaults): number {
  let width = 0;
  for (const seg of segments) {
    for (const run of seg.result.runs) {
      const runEnd = run.start + run.numChars;
      const s = seg.start > run.start ? seg.start : run.start;
      const e = seg.end < runEnd ? seg.end : runEnd;
      if (e <= s) continue;
      let part: number;
      if (run.start >= seg.start && runEnd <= seg.end) {
        part = run.width;
      } else {
        const advances: number[] = [];
        for (const g of run.glyphs) {
          const c = run.start + g.ci;
          if (c >= s && c < e) advances.push(g.advance);
        }
        part = sumAdvances(advances, faults, false);
      }
      width = accumulate(width, part, faults);
    }
  }
  return width;
}

/** LazyLineBreakIterator::IsBreakableSpace || Character::IsOtherSpaceSeparator. */
function isBreakableSpace(cp: number): boolean {
  return cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x3000;
}

/** ShapeResult::IsStartSafeToBreak (LTR). */
function isStartSafe(result: ShapeResult): boolean {
  if (result.runs.length === 0) return false;
  const run = result.runs[0] as ShapingRun;
  if (run.glyphs.length === 0) return false;
  const g = run.glyphs[0] as ShapingGlyph;
  return g.safe && result.start === run.start + g.ci;
}

export type LineResult = { readonly ok: true; readonly end: number; readonly width: LU } | { readonly ok: false; readonly reason: string };

function snapped(segments: readonly ViewSegment[], faults: ShapingFaults): LU {
  return snapWidth(viewWidth(segments, faults), faults);
}

function missingIn(results: readonly ShapeResult[]): number {
  for (const r of results) if (r.missing >= 0) return r.missing;
  return -1;
}

function noGlyph(cp: number): LineResult {
  return { ok: false, reason: `U+${cp.toString(16).toUpperCase()} has no glyph; font fallback is outside the shaping core` };
}

/**
 * The width of a line [start, breakOffset) of the item, as ShapingLineBreaker::ShapeLine builds its ShapeResultView with
 * text-align start (DontReshapeEndIfAtSpace) and text-spacing-trim normal, plus the generated hyphen at a soft hyphen break.
 * The break is an input: a model that cannot reach it returns a typed failure. `available` and the result are LayoutUnits.
 */
export function lineWidth(item: ShapeItem, paragraph: ShapeResult, start: number, breakOffset: number, available: LU, isBreakable: (offset: number) => boolean): LineResult {
  const m = lineView(item, paragraph, start, breakOffset, available, isBreakable);
  if (!m.ok) return m;
  const units = item.units;
  if (breakOffset < units.length && breakOffset > 0 && (units[breakOffset - 1] as number) === SOFT_HYPHEN && !item.faults.softHyphenWidthMissing) {
    const h = hyphenWidth(item);
    if (!h.ok) return h;
    return { ok: true, end: m.end, width: add(m.width, h.width) };
  }
  return m;
}

/** ComputedStyle::HyphenString: U+2010 if the face has a glyph for it, else U+002D, shaped as its own item. */
function hyphenWidth(item: ShapeItem): LineResult {
  const own = (text: string): ShapeResult => {
    const made = makeItem({ shaper: item.shaper, face: item.face, size: item.size, text, language: item.language, hanKerning: NO_HAN_KERNING, faults: item.faults });
    if (!made.ok) return shapeRange(item, 0, 0, false, false, false);
    return shapeItem(made.item);
  };
  let r = own('‐');
  if (r.missing >= 0 || r.runs.length === 0) r = own('-');
  if (r.missing >= 0) return noGlyph(r.missing);
  return { ok: true, end: 0, width: snapWidth(r.width, item.faults) };
}

function lineView(item: ShapeItem, paragraph: ShapeResult, start: number, breakOffset: number, availableIn: LU, isBreakable: (offset: number) => boolean): LineResult {
  const units = item.units;
  const faults = item.faults;
  const rangeStart = paragraph.start;
  const rangeEnd = paragraph.end;
  if (paragraph.missing >= 0) return noGlyph(paragraph.missing);
  let available: number = availableIn;
  // Break opportunity with trailing spaces: the offset moves to the non-hangable run end.
  let end = breakOffset;
  while (end > start + 1 && isBreakableSpace(units[end - 1] as number)) end--;
  const endsInSpace = end !== breakOffset;

  // Early return: the whole item fits.
  if (start === rangeStart && available >= snapWidth(paragraph.width, faults) && isStartSafe(paragraph)) {
    if (breakOffset !== rangeEnd) return { ok: false, reason: `the item fits but the break is at ${breakOffset}` };
    return { ok: true, end: rangeEnd, width: snapped([{ result: paragraph, start: rangeStart, end: rangeEnd }], faults) };
  }

  const startPosition = cachedPositionForOffset(paragraph, start);
  // FirstSafeOffset: only the start of a wrapped line reshapes.
  const firstSafe = start !== 0 && !faults.noReshapeAtBreak ? cachedNextSafeToBreakOffset(paragraph, start) : start;
  let lineStart = paragraph;
  let hasLineStart = false;
  if (firstSafe !== start) {
    lineStart = shapeRange(item, start, firstSafe, true, false, false);
    hasLineStart = true;
    const oldWidth = cachedPositionForOffset(paragraph, firstSafe) - startPosition;
    const diff = oldWidth - snapWidth(lineStart.width, faults);
    if (diff !== 0) available = available + diff > 0 ? available + diff : 0;
  }

  const endPosition = startPosition + available;
  let candidate = cachedOffsetForPosition(paragraph, endPosition);
  let lastSafe = end;
  let lineEnd = paragraph;
  let hasLineEnd = false;
  // Extend the candidate if the next character fits after HanKerning trims it at the line end.
  if (candidate < rangeEnd && maybeHanKerningClose(units[candidate] as number) && isBreakable(candidate + 1)) {
    const adjusted = candidate + 1;
    const safe = cachedPreviousSafeToBreakOffset(paragraph, candidate);
    const trimmed = shapeRange(item, safe, adjusted, false, false, true);
    const widthToSafe = cachedPositionForOffset(paragraph, safe) - startPosition;
    if (floatAdd(toPx(fromRaw(widthToSafe)), trimmed.width) <= toFloat(fromRaw(available))) {
      candidate = adjusted;
      if (breakOffset !== adjusted) return { ok: false, reason: `HanKerning extends the line to ${adjusted} but the break is at ${breakOffset}` };
      lineEnd = trimmed;
      hasLineEnd = true;
      lastSafe = safe;
    }
  }

  if (candidate >= rangeEnd) {
    // ShapeToEnd.
    if (breakOffset !== rangeEnd) return { ok: false, reason: `the rest fits but the break is at ${breakOffset}` };
    const missing = missingIn([lineStart]);
    if (missing >= 0) return noGlyph(missing);
    if (hasLineStart && firstSafe >= rangeEnd) return { ok: true, end: rangeEnd, width: snapped([{ result: lineStart, start, end: rangeEnd }], faults) };
    const segments: ViewSegment[] = [];
    if (hasLineStart) segments.push({ result: lineStart, start: lineStart.start, end: lineStart.end });
    segments.push({ result: paragraph, start: firstSafe, end: rangeEnd });
    return { ok: true, end: rangeEnd, width: snapped(segments, faults) };
  }

  if (firstSafe >= end && hasLineStart) {
    const all = shapeRange(item, start, end, true, false, false);
    if (all.missing >= 0) return noGlyph(all.missing);
    return { ok: true, end, width: snapWidth(all.width, faults) };
  }

  // The end reshapes only when the break is not after a space and not at the end of the item.
  if (!hasLineEnd && breakOffset < rangeEnd && !endsInSpace && !faults.noReshapeAtBreak) {
    lastSafe = cachedPreviousSafeToBreakOffset(paragraph, end);
    if (lastSafe !== end) {
      if (lastSafe < firstSafe) {
        lastSafe = start;
        hasLineStart = false;
      }
      lineEnd = shapeRange(item, lastSafe, end, false, false, false);
      hasLineEnd = true;
    }
  }

  const segments: ViewSegment[] = [];
  const shaped: ShapeResult[] = [];
  if (hasLineStart) {
    segments.push({ result: lineStart, start: lineStart.start, end: lineStart.end });
    shaped.push(lineStart);
  }
  const middleStart = hasLineStart ? firstSafe : start;
  if (lastSafe > middleStart) segments.push({ result: paragraph, start: middleStart, end: lastSafe });
  if (hasLineEnd) {
    segments.push({ result: lineEnd, start: lineEnd.start, end: lineEnd.end });
    shaped.push(lineEnd);
  }
  const missing = missingIn(shaped);
  if (missing >= 0) return noGlyph(missing);
  return { ok: true, end, width: snapped(segments, faults) };
}

// ---------------------------------------------------------------------------------------------------------------------------
// ShapingLineBreaker::ShapeLine (LTR): the line breaking decision inside one text item (shaping_line_breaker.cc)

/** A ShapeResultView of a line: its parts, in order. */
export type LineView = { readonly segments: readonly ViewSegment[] };

/** One break the item's break iterator reports: a line may start at offset; spaces before it end at nonHangableEnd (or -1). */
type ItemBreak = { readonly offset: number; readonly nonHangableEnd: number };

/** FindNonHangableEnd: the start of the space run that ends at candidate (inclusive). */
function nonHangableEndOf(units: readonly number[], candidate: number): number {
  let end = candidate;
  while (end > 0) {
    end--;
    if (!isBreakableSpace(units[end] as number)) return end + 1;
  }
  return end;
}

/** ShapingLineBreaker::PreviousBreakOpportunity without hyphenation: the last opportunity at or before offset and after min. */
function previousBreak(units: readonly number[], breakable: (offset: number) => boolean, offset: number, min: number): ItemBreak {
  let b = min;
  for (let p = offset; p > min; p--) {
    if (breakable(p)) {
      b = p;
      break;
    }
  }
  if (b > 0 && isBreakableSpace(units[b - 1] as number)) return { offset: b, nonHangableEnd: nonHangableEndOf(units, b - 1) };
  return { offset: b, nonHangableEnd: -1 };
}

/** ShapingLineBreaker::NextBreakOpportunity without hyphenation: the first opportunity at or after offset, else len. */
function nextBreak(units: readonly number[], breakable: (offset: number) => boolean, offset: number, len: number): ItemBreak {
  let b = len;
  for (let p = offset; p < len; p++) {
    if (breakable(p)) {
      b = p;
      break;
    }
  }
  if (b > 0 && isBreakableSpace(units[b - 1] as number)) return { offset: b, nonHangableEnd: nonHangableEndOf(units, b - 1) };
  return { offset: b, nonHangableEnd: -1 };
}

/** What ShapeLine decided: the break offset, the line's view and SnappedWidth, and LineBreaker's result flags. */
export type ItemLine =
  | { readonly ok: true; readonly end: number; readonly view: LineView; readonly width: LU; readonly overflow: boolean; readonly hyphenated: boolean; readonly trailingSpaces: boolean }
  | { readonly ok: false; readonly reason: string };

function viewLine(item: ShapeItem, segments: readonly ViewSegment[], end: number, overflow: boolean, trailingSpaces: boolean): ItemLine {
  const shaped: ShapeResult[] = [];
  for (const s of segments) shaped.push(s.result);
  const missing = missingIn(shaped);
  if (missing >= 0) {
    const r = noGlyph(missing);
    return { ok: false, reason: r.ok ? '' : r.reason };
  }
  const hyphenated = end > 0 && (item.units[end - 1] as number) === SOFT_HYPHEN;
  return { ok: true, end, view: { segments }, width: snapWidth(viewWidth(segments, item.faults), item.faults), overflow, hyphenated, trailingSpaces };
}

/** ShapingLineBreaker::ShapeToEnd. */
function shapeToEnd(item: ShapeItem, result: ShapeResult, start: number, lineStart: ShapeResult | null, firstSafe: number, overflow: boolean): ItemLine {
  const end = result.end;
  if (lineStart === null) return viewLine(item, [{ result, start, end }], end, overflow, false);
  if (firstSafe >= end) return viewLine(item, [{ result: lineStart, start, end }], end, overflow, false);
  return viewLine(item, [{ result: lineStart, start: lineStart.start, end: lineStart.end }, { result, start: firstSafe, end }], end, overflow, false);
}

/**
 * ShapingLineBreaker::ShapeLine for the line that starts at start in the item: the candidate from the cached positions, the
 * previous (or, after a space, next) break opportunity, reshaping at both edges, and stepping back while the reshaped end does not
 * fit. wrappedStart is IsStartOfWrappedLine; breakable says whether a line may start at an item offset (the item's end included).
 * Text-spacing-trim is normal, hyphens manual and the text has no auto-spacing; HanKerning applies only to CJK punctuation.
 */
export function shapeLine(item: ShapeItem, result: ShapeResult, start: number, availableIn: LU, wrappedStart: boolean, breakable: (offset: number) => boolean, dontReshapeEndIfAtSpace: boolean): ItemLine {
  const units = item.units;
  const faults = item.faults;
  const rangeStart = result.start;
  const rangeEnd = result.end;
  if (result.missing >= 0) {
    const r = noGlyph(result.missing);
    return { ok: false, reason: r.ok ? '' : r.reason };
  }
  let available: number = availableIn < 0 ? 0 : availableIn;
  if (start === rangeStart && !wrappedStart && available >= snapWidth(result.width, faults) && isStartSafe(result)) {
    return viewLine(item, [{ result, start: rangeStart, end: rangeEnd }], rangeEnd, false, false);
  }
  const startPosition = cachedPositionForOffset(result, start);
  const firstSafe = wrappedStart && !faults.noReshapeAtBreak ? cachedNextSafeToBreakOffset(result, start) : start;
  let lineStart: ShapeResult | null = null;
  if (firstSafe !== start) {
    const ls = shapeRange(item, start, firstSafe, true, false, false);
    lineStart = ls;
    const oldWidth = cachedPositionForOffset(result, firstSafe) - startPosition;
    const diff = oldWidth - snapWidth(ls.width, faults);
    if (diff !== 0) available = available + diff > 0 ? available + diff : 0;
  }
  const endPosition = startPosition + available;
  let candidate = candidateBreak(result, start, available);
  let lastSafe = 0;
  let lineEnd: ShapeResult | null = null;
  if (candidate < rangeEnd && maybeHanKerningClose(units[candidate] as number) && breakable(candidate + 1)) {
    const adjusted = candidate + 1;
    const safe = cachedPreviousSafeToBreakOffset(result, candidate);
    const trimmed = shapeRange(item, safe, adjusted, false, false, true);
    const widthToSafe = cachedPositionForOffset(result, safe) - startPosition;
    if (floatAdd(toPx(fromRaw(widthToSafe)), trimmed.width) <= toFloat(fromRaw(available))) {
      candidate = adjusted;
      lineEnd = trimmed;
      lastSafe = safe;
    }
  }
  if (candidate >= rangeEnd) return shapeToEnd(item, result, start, lineStart, firstSafe, false);
  if (candidate < start) candidate = start;
  let overflow = false;
  let bo: ItemBreak;
  if (!isBreakableSpace(units[candidate] as number)) {
    bo = previousBreak(units, breakable, candidate, start);
    overflow = bo.offset <= start;
    if (overflow) bo = nextBreak(units, breakable, candidate > start + 1 ? candidate : start + 1, rangeEnd);
  } else {
    bo = nextBreak(units, breakable, candidate > start + 1 ? candidate : start + 1, rangeEnd);
    if (bo.offset > candidate && (bo.nonHangableEnd < 0 || bo.nonHangableEnd > candidate)) {
      const previous = previousBreak(units, breakable, candidate, start);
      if (previous.offset > start) bo = previous;
      else overflow = true;
    }
    if (bo.nonHangableEnd >= 0 && bo.nonHangableEnd <= start) {
      const end = bo.offset < rangeEnd ? bo.offset : rangeEnd;
      return viewLine(item, [{ result, start, end }], end, overflow, true);
    }
  }
  let reshapeEnd = lineEnd === null;
  if (bo.offset >= rangeEnd) {
    if (overflow) return shapeToEnd(item, result, start, lineStart, firstSafe, true);
    let nhe = bo.nonHangableEnd >= 0 && rangeEnd < bo.nonHangableEnd ? -1 : bo.nonHangableEnd;
    if (isBreakableSpace(units[rangeEnd - 1] as number)) nhe = nonHangableEndOf(units, rangeEnd - 1);
    bo = { offset: rangeEnd, nonHangableEnd: nhe };
    reshapeEnd = false;
  }
  if (dontReshapeEndIfAtSpace && reshapeEnd) reshapeEnd = !isBreakableSpace(units[bo.offset - 1] as number);
  let offset = bo.offset;
  if (bo.nonHangableEnd >= 0) offset = start + 1 > bo.nonHangableEnd ? start + 1 : bo.nonHangableEnd;
  if (firstSafe >= offset) {
    const all = shapeRange(item, start, offset, true, false, false);
    return viewLine(item, [{ result: all, start: all.start, end: all.end }], offset, overflow, false);
  }
  if (reshapeEnd) {
    while (true) {
      if (bo.nonHangableEnd >= 0) offset = start + 1 > bo.nonHangableEnd ? start + 1 : bo.nonHangableEnd;
      else offset = bo.offset;
      lastSafe = faults.noReshapeAtBreak ? offset : cachedPreviousSafeToBreakOffset(result, offset);
      if (lastSafe === offset) break;
      if (lastSafe < firstSafe) {
        lastSafe = start;
        lineStart = null;
      }
      if (overflow) {
        lineEnd = shapeRange(item, lastSafe, offset, false, false, false);
        break;
      }
      const safePosition = cachedPositionForOffset(result, lastSafe);
      const le = shapeRange(item, lastSafe, offset, false, false, false);
      if (le.width <= toFloat(fromRaw(endPosition - safePosition))) {
        lineEnd = le;
        break;
      }
      lineEnd = null;
      bo = previousBreak(units, breakable, offset - 1, start);
      if (bo.offset > start) continue;
      overflow = true;
      bo = previousBreak(units, breakable, candidate, start);
      if (bo.offset <= start) {
        bo = nextBreak(units, breakable, candidate > start + 1 ? candidate : start + 1, rangeEnd);
        if (bo.offset >= rangeEnd) return shapeToEnd(item, result, start, lineStart, firstSafe, true);
      }
    }
  }
  if (lineEnd === null) lastSafe = offset;
  const segments: ViewSegment[] = [];
  if (lineStart !== null) segments.push({ result: lineStart, start: lineStart.start, end: lineStart.end });
  if (lastSafe > firstSafe) segments.push({ result, start: firstSafe, end: lastSafe });
  if (lineEnd !== null) segments.push({ result: lineEnd, start: lineEnd.start, end: lineEnd.end });
  return viewLine(item, segments, offset, overflow, false);
}

/** ShapeResultView::Create of a view restricted to [start, end): RemoveTrailingCollapsibleSpace's view without the trailing space. */
export function subView(view: LineView, start: number, end: number): LineView {
  const out: ViewSegment[] = [];
  for (const s of view.segments) {
    const a = s.start > start ? s.start : start;
    const b = s.end < end ? s.end : end;
    if (b > a) out.push({ result: s.result, start: a, end: b });
  }
  return { segments: out };
}

/** ShapeResultView::SnappedWidth. */
export function viewSnappedWidth(item: ShapeItem, view: LineView): LU {
  return snapWidth(viewWidth(view.segments, item.faults), item.faults);
}

/** The whole item as one view (ShapeResultView::Create(result)). */
export function wholeView(result: ShapeResult): LineView {
  return { segments: [{ result, start: result.start, end: result.end }] };
}

/** ShapeResult::CachedWidth of [start, end): the difference of the cached positions. */
export function cachedRangeLU(result: ShapeResult, start: number, end: number): LU {
  return sub(fromRaw(cachedPositionForOffset(result, end)), fromRaw(cachedPositionForOffset(result, start)));
}

/** The InlineSize of the generated hyphen of the item's font (ComputedStyle::HyphenString shaped as its own item). */
export function hyphenAdvance(item: ShapeItem): LineResult {
  return hyphenWidth(item);
}

// ---------------------------------------------------------------------------------------------------------------------------
// LineBreaker (line_breaker.cc): text items, open and close tags of undecorated inline boxes and forced breaks, with collapsible
// white space, one text-wrap-mode and the initial word-break, overflow-wrap, line-break and hyphens.

/**
 * One item of a formatting context for the line breaker. A text item is one shaped text item: its shaped result, the item offsets
 * where a line may start (opportunities, ascending, inside the item), whether a line may start right after it (atEnd), and its
 * offset in the context's text content. A tag records whether the content character after it is a breakable space.
 */
export type BreakItem =
  | { readonly kind: 'text'; readonly item: ShapeItem; readonly result: ShapeResult; readonly opportunities: readonly number[]; readonly atEnd: boolean; readonly offset: number }
  | { readonly kind: 'open'; readonly offset: number }
  | { readonly kind: 'close'; readonly offset: number; readonly spaceBefore: boolean; readonly spaceAfter: boolean }
  | { readonly kind: 'br'; readonly offset: number };

/** One InlineItemResult: the item, its offsets, its inline size (with the hyphen), its view and whether a line may break after it. */
export type BreakResult = {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly width: LU;
  readonly hyphen: LU;
  readonly view: LineView | null;
  readonly canBreakAfter: boolean;
  readonly mayBreakInside: boolean;
};

/** A line: its item results, the inline size each shows once a trailing collapsible space hangs, and where the next line starts. */
export type BrokenLine = {
  readonly results: readonly BreakResult[];
  readonly visibleWidths: readonly LU[];
  readonly nextItem: number;
  readonly nextOffset: number;
  readonly forced: boolean;
};

export type BrokenLines = { readonly ok: true; readonly lines: readonly BrokenLine[] } | { readonly ok: false; readonly reason: string };

type MutableResult = { index: number; start: number; end: number; width: LU; hyphen: LU; view: LineView | null; canBreakAfter: boolean; mayBreakInside: boolean };

type BreakState = 'continue' | 'trailing' | 'overflow' | 'done';

class BreakFailure extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** The line breaker's state while it builds one line (LineBreaker's members). */
type LineBuild = {
  readonly items: readonly BreakItem[];
  readonly toFit: number;
  readonly wrap: boolean;
  readonly accurateEnd: boolean;
  readonly afterForced: boolean;
  readonly lineStart: number;
  results: MutableResult[];
  position: number;
  state: BreakState;
  leading: boolean;
  forced: boolean;
  curItem: number;
  curOffset: number;
};

/** The state, read after a call that may change it. */
function stateOf(b: LineBuild): BreakState {
  return b.state;
}

function itemLength(it: BreakItem): number {
  return it.kind === 'text' ? it.result.end : 0;
}

function textUnit(it: BreakItem, offset: number): number {
  return it.kind === 'text' && offset >= 0 && offset < it.result.end ? (it.item.units[offset] as number) : -1;
}

function itemBreakable(it: BreakItem, offset: number): boolean {
  if (it.kind !== 'text') return false;
  if (offset >= it.result.end) return it.atEnd;
  return contains(it.opportunities, offset, 0);
}

function emptyResult(index: number, offset: number, canBreakAfter: boolean): MutableResult {
  return { index, start: offset, end: offset, width: ZERO, hyphen: ZERO, view: null, canBreakAfter, mayBreakInside: false };
}

function recomputePosition(b: LineBuild): void {
  let p = 0;
  for (const r of b.results) p = p + r.width;
  b.position = p;
}

function moveAfter(b: LineBuild, r: MutableResult): void {
  const it = b.items[r.index] as BreakItem;
  if (it.kind === 'text' && r.end < it.result.end) {
    b.curItem = r.index;
    b.curOffset = r.end;
  } else {
    b.curItem = r.index + 1;
    b.curOffset = 0;
  }
}

/** LineBreaker::Rewind to the first n results. */
function rewindTo(b: LineBuild, n: number): void {
  const last = b.results[n - 1] as MutableResult;
  const kept: MutableResult[] = [];
  for (let i = 0; i < n; i++) kept.push(b.results[i] as MutableResult);
  b.results = kept;
  moveAfter(b, last);
  b.leading = false;
  recomputePosition(b);
}

function isAllSpaces(it: BreakItem, start: number, end: number): boolean {
  for (let o = start; o < end; o++) if (!isBreakableSpace(textUnit(it, o))) return false;
  return true;
}

/** LineBreaker::BreakText: ShapeLine from the result's start, with BreakText's retry when the generated hyphen overflows. */
function breakText(b: LineBuild, r: MutableResult, availIn: number, availWithHyphens: number): boolean {
  const it = b.items[r.index] as BreakItem;
  if (it.kind !== 'text') throw new BreakFailure('breakText on an item that is not text');
  let avail = availIn;
  const wrapped = it.offset + r.start !== 0 && it.offset + r.start === b.lineStart && !b.afterForced;
  while (true) {
    const l = shapeLine(it.item, it.result, r.start, fromRaw(avail < 0 ? 0 : avail), wrapped, (o) => itemBreakable(it, o), !b.accurateEnd);
    if (!l.ok) throw new BreakFailure(l.reason);
    let inline: number = l.width < 0 ? 0 : l.width;
    let hyphen = 0;
    if (l.hyphenated && !it.item.faults.softHyphenWidthMissing) {
      const h = hyphenWidth(it.item);
      if (!h.ok) throw new BreakFailure(h.reason);
      if (!l.overflow && inline <= avail) {
        const space = availWithHyphens - inline;
        if (space >= 0 && h.width > space) {
          avail = avail - h.width;
          continue;
        }
      }
      hyphen = h.width;
      inline = inline + hyphen;
    }
    r.end = l.end;
    r.width = fromRaw(inline);
    r.hyphen = fromRaw(hyphen);
    r.view = l.view;
    r.canBreakAfter = l.end < it.result.end ? true : itemBreakable(it, it.result.end);
    r.mayBreakInside = !l.overflow;
    return inline <= availWithHyphens;
  }
}

/** LineBreaker::HandleTrailingSpaces with collapsible white space: one space hangs, then the line is done unless the item ends. */
function handleTrailingSpaces(b: LineBuild): void {
  const it = b.items[b.curItem] as BreakItem;
  if (!b.wrap || textUnit(it, b.curOffset) !== 0x20) {
    b.state = 'done';
    return;
  }
  b.curOffset++;
  const last = b.results[b.results.length - 1];
  if (last !== undefined) last.canBreakAfter = true;
  if (b.curOffset < itemLength(it)) {
    b.state = 'done';
    return;
  }
  if (last === undefined || last.index !== b.curItem) b.results.push(emptyResult(b.curItem, b.curOffset, true));
  b.curItem++;
  b.curOffset = 0;
  b.state = 'trailing';
}

/** LineBreaker::RewindOverflow: trailable items after new_end stay on the line. */
function rewindOverflow(b: LineBuild, newEnd: number): void {
  let openCount = 0;
  let end = newEnd;
  for (let index = newEnd; index < b.results.length; index++) {
    const r = b.results[index] as MutableResult;
    const it = b.items[r.index] as BreakItem;
    if (it.kind === 'text') {
      if (r.end === r.start) continue;
      if (b.wrap && isBreakableSpace(textUnit(it, r.start))) {
        if (isAllSpaces(it, r.start + 1, r.end)) continue;
        b.state = 'trailing';
        rewindTo(b, index);
        return;
      }
    } else if (it.kind === 'open') {
      if (openCount === 0) end = index;
      openCount++;
      continue;
    } else if (it.kind === 'close') {
      if (openCount > 0) openCount--;
      continue;
    }
    b.state = 'done';
    rewindTo(b, openCount > 0 ? end : index);
    return;
  }
  if (openCount > 0) {
    b.state = 'done';
    rewindTo(b, end);
    return;
  }
  recomputePosition(b);
  b.state = 'done';
}

function removeHyphen(b: LineBuild): void {
  const last = b.results[b.results.length - 1];
  if (last !== undefined && last.hyphen > 0) {
    last.width = sub(last.width, last.hyphen);
    last.hyphen = ZERO;
    recomputePosition(b);
  }
}

/** LineBreaker::HandleOverflow: the last break opportunity that fits, breaking an earlier text result again if it can. */
function handleOverflow(b: LineBuild): void {
  removeHyphen(b);
  let toRewind = b.position - b.toFit;
  let breakBefore = 0;
  for (let i = b.results.length; i > 0; ) {
    i--;
    const r = b.results[i] as MutableResult;
    if (i < b.results.length - 1 && r.canBreakAfter) {
      if (toRewind <= 0) {
        rewindOverflow(b, i + 1);
        return;
      }
      breakBefore = i + 1;
    }
    toRewind = toRewind - r.width;
    if (toRewind > 0) continue;
    const it = b.items[r.index] as BreakItem;
    if (it.kind !== 'text' || r.end === r.start) continue;
    if (toRewind < 0 && r.mayBreakInside) {
      const itemAvail = -toRewind;
      const minAvail = r.width - 1;
      if (minAvail <= 0) throw new BreakFailure('a zero-width text result overflows (BreakTextAtPreviousBreakOpportunity)');
      const before: MutableResult = { index: r.index, start: r.start, end: r.end, width: r.width, hyphen: r.hyphen, view: r.view, canBreakAfter: r.canBreakAfter, mayBreakInside: r.mayBreakInside };
      breakText(b, r, itemAvail < minAvail ? itemAvail : minAvail, itemAvail);
      if (r.canBreakAfter && r.width <= itemAvail && r.end < before.end) {
        if (i + 1 === b.results.length) {
          b.curItem = r.index;
          b.curOffset = r.end;
          recomputePosition(b);
          handleTrailingSpaces(b);
          return;
        }
        b.state = 'trailing';
        rewindTo(b, i + 1);
        return;
      }
      r.end = before.end;
      r.width = before.width;
      r.hyphen = before.hyphen;
      r.view = before.view;
      r.canBreakAfter = before.canBreakAfter;
      r.mayBreakInside = before.mayBreakInside;
    }
  }
  if (breakBefore > 0) {
    rewindOverflow(b, breakBefore);
    return;
  }
  const tail = b.results[b.results.length - 1];
  b.state = tail !== undefined && tail.canBreakAfter ? 'trailing' : 'overflow';
}

/** LineBreaker::HandleText. */
function handleText(b: LineBuild): void {
  const it = b.items[b.curItem] as BreakItem;
  if (it.kind !== 'text') throw new BreakFailure('handleText on an item that is not text');
  if (b.state === 'trailing') {
    handleTrailingSpaces(b);
    return;
  }
  if (b.leading && textUnit(it, b.curOffset) === 0x20) {
    b.curOffset++;
    if (b.curOffset >= itemLength(it)) {
      b.results.push(emptyResult(b.curItem, b.curOffset, false));
      b.curItem++;
      b.curOffset = 0;
      return;
    }
  }
  if (b.state === 'continue' && b.position > b.toFit) {
    if (b.wrap && isBreakableSpace(textUnit(it, b.curOffset))) {
      handleTrailingSpaces(b);
      if (stateOf(b) !== 'done') b.state = 'continue';
      return;
    }
    handleOverflow(b);
    return;
  }
  removeHyphen(b);
  const r = emptyResult(b.curItem, b.curOffset, false);
  b.results.push(r);
  b.leading = false;
  if (!b.wrap) {
    const view: LineView = r.start === 0 ? wholeView(it.result) : { segments: [{ result: it.result, start: r.start, end: it.result.end }] };
    r.end = it.result.end;
    r.view = view;
    const w = viewSnappedWidth(it.item, view);
    r.width = w < 0 ? ZERO : w;
    b.position = b.position + r.width;
    b.curItem++;
    b.curOffset = 0;
    return;
  }
  const remaining = b.toFit - b.position;
  const fits = breakText(b, r, remaining, remaining);
  b.position = b.position + r.width;
  moveAfter(b, r);
  if (fits) {
    if (r.end < it.result.end) handleTrailingSpaces(b);
    return;
  }
  if (b.state === 'overflow') {
    if (r.canBreakAfter) b.state = 'trailing';
    return;
  }
  if (isAllSpaces(it, r.start, r.end)) return;
  handleOverflow(b);
}

/** LineBreaker::HandleCloseTag: a break opportunity before the tag moves after it; else one before a space after it. */
function handleCloseTag(b: LineBuild): void {
  const it = b.items[b.curItem] as BreakItem;
  const r = emptyResult(b.curItem, 0, false);
  const prev = b.results[b.results.length - 1];
  b.results.push(r);
  b.curItem++;
  b.curOffset = 0;
  if (prev === undefined || it.kind !== 'close') return;
  if (prev.canBreakAfter) {
    r.canBreakAfter = true;
    prev.canBreakAfter = false;
  } else if (b.wrap) {
    r.canBreakAfter = it.spaceAfter;
  }
}

/** One line: LineBreaker::BreakLine, then ComputeTrailingCollapsibleSpace. */
function breakOneLine(b: LineBuild): BrokenLine {
  while (b.state !== 'done') {
    if (b.curItem >= b.items.length) {
      if (b.position > b.toFit && b.results.length > 0 && b.state === 'continue') {
        handleOverflow(b);
        if (b.curItem < b.items.length) continue;
      }
      break;
    }
    if (b.state === 'overflow') {
      const tail = b.results[b.results.length - 1];
      if (tail !== undefined && tail.canBreakAfter) b.state = 'trailing';
    }
    const it = b.items[b.curItem] as BreakItem;
    if (it.kind === 'text') handleText(b);
    else if (it.kind === 'open') {
      b.results.push(emptyResult(b.curItem, 0, false));
      b.curItem++;
      b.curOffset = 0;
    } else if (it.kind === 'close') handleCloseTag(b);
    else {
      // HandleForcedLineBreak: the <br>, then the close tags that follow it.
      b.results.push(emptyResult(b.curItem, 0, true));
      b.curItem++;
      b.curOffset = 0;
      while (b.curItem < b.items.length && (b.items[b.curItem] as BreakItem).kind === 'close') {
        b.results.push(emptyResult(b.curItem, 0, true));
        b.curItem++;
      }
      b.forced = true;
      b.state = 'done';
    }
  }
  let hang = -1;
  let hangWidth = ZERO;
  for (let i = b.results.length - 1; i >= 0; i--) {
    const r = b.results[i] as MutableResult;
    const it = b.items[r.index] as BreakItem;
    if (it.kind !== 'text' || r.end === r.start) continue;
    if (textUnit(it, r.end - 1) === 0x20 && r.view !== null) {
      hang = i;
      hangWidth = r.end - 1 > r.start ? viewSnappedWidth(it.item, subView(r.view, r.start, r.end - 1)) : ZERO;
    }
    break;
  }
  const visibleWidths: LU[] = [];
  for (let i = 0; i < b.results.length; i++) visibleWidths.push(i === hang ? hangWidth : (b.results[i] as MutableResult).width);
  const results: BreakResult[] = [];
  for (const r of b.results) results.push({ index: r.index, start: r.start, end: r.end, width: r.width, hyphen: r.hyphen, view: r.view, canBreakAfter: r.canBreakAfter, mayBreakInside: r.mayBreakInside });
  return { results, visibleWidths, nextItem: b.curItem, nextOffset: b.curOffset, forced: b.forced };
}

/**
 * LineBreaker::NextLine over the items with an available width (no floats, no text-indent). wrap is the context's
 * text-wrap-mode; accurateEnd is LineInfo::NeedsAccurateEndPosition (text-align other than the start side), which keeps
 * ShapeLine reshaping the end of a line that breaks at a space. epsilon is LayoutUnit::AddEpsilon (AvailableWidthToFit).
 */
export function breakItemLines(items: readonly BreakItem[], available: LU, wrap: boolean, accurateEnd: boolean, epsilon: boolean): BrokenLines {
  const toFit: number = epsilon ? available + 1 : available;
  const lines: BrokenLine[] = [];
  let curItem = 0;
  let curOffset = 0;
  let afterForced = false;
  try {
    while (curItem < items.length) {
      const b: LineBuild = {
        items, toFit, wrap, accurateEnd, afterForced, lineStart: lineOffsetOf(items, curItem, curOffset),
        results: [], position: 0, state: 'continue', leading: true, forced: false, curItem, curOffset,
      };
      const line = breakOneLine(b);
      if (line.results.length === 0) break;
      if (line.nextItem === curItem && line.nextOffset === curOffset) throw new BreakFailure(`the line breaker made no progress at item ${curItem}`);
      lines.push(line);
      curItem = line.nextItem;
      curOffset = line.nextOffset;
      afterForced = line.forced;
    }
  } catch (e) {
    if (e instanceof BreakFailure) return { ok: false, reason: e.reason };
    throw e;
  }
  return { ok: true, lines };
}

/** The text-content offset of an item position. */
function lineOffsetOf(items: readonly BreakItem[], index: number, offset: number): number {
  const it = items[index] as BreakItem;
  return it.offset + offset;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The measurer

/** An item shaped once per text, face and size, cached per ShapedText (per layout). */
export type ShapedItem = { readonly ok: true; readonly item: ShapeItem; readonly result: ShapeResult } | { readonly ok: false; readonly code: TextRefusalCode; readonly reason: string };

export type ShapedText = {
  /** R2's TextMeasurer, over the face TextFont.family names (the face id: Ahem, or a bundled face's sha256). */
  readonly measurer: TextMeasurer;
  item(text: string, face: string, size: number): ShapedItem;
  line(shaped: ShapedItem, start: number, breakOffset: number, available: LU, isBreakable: (offset: number) => boolean): LineResult;
};

/** The shaping core over the host's faces and HarfBuzz, for text in one language. */
export function shapedText(faces: ReadonlyMap<string, ShapedFace>, shaper: GlyphShaper, faults: ShapingFaults, language: string): ShapedText {
  const cache = new Map<string, ShapedItem>();
  const item = (text: string, face: string, size: number): ShapedItem => {
    const key = `${face}\n${size}\n${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const f = faces.get(face);
    let out: ShapedItem;
    if (f === undefined) out = { ok: false, code: 'text-glyph', reason: `no bundled face ${face}` };
    else {
      const made = makeItem({ shaper, face: f.id, size, text, language, hanKerning: f.hanKerning, faults });
      if (!made.ok) out = { ok: false, code: 'text-glyph', reason: made.reason };
      else {
        const result = shapeItem(made.item);
        out = result.missing >= 0 ? { ok: false, code: 'text-glyph', reason: `U+${result.missing.toString(16).toUpperCase()} has no glyph; font fallback is outside the shaping core` } : { ok: true, item: made.item, result };
      }
    }
    cache.set(key, out);
    return out;
  };
  const line = (shaped: ShapedItem, start: number, breakOffset: number, available: LU, isBreakable: (offset: number) => boolean): LineResult => {
    if (!shaped.ok) return { ok: false, reason: shaped.reason };
    return lineWidth(shaped.item, shaped.result, start, breakOffset, available, isBreakable);
  };
  const itemFor = (text: string, font: TextFont): ShapedItem => item(text, font.family, platformFontSize(font.size));
  /** A code point index as the UTF-16 offset of the item. */
  const offsetOf = (units: readonly number[], codePoint: number): number => {
    let k = 0;
    for (let i = 0; i < units.length; i++) {
      if ((units[i] as number) < 0) continue;
      if (k === codePoint) return i;
      k++;
    }
    return units.length;
  };
  const measurer: TextMeasurer = {
    // R5: SimpleFontData's rounded ascent and descent of the platform-size font; a zero line gap stays ZERO.
    metrics(font: TextFont): FontMetrics {
      const f = faces.get(font.family);
      if (f === undefined) throw new Error(`no bundled face ${font.family}; the host passes every face the input names`);
      const size = platformFontSize(font.size);
      const d = f.data;
      const round = (units: number): LU => (faults.metricRoundingSwapped ? roundFontMetricHalfUpToWholePx(fontMetricPx(size, d.unitsPerEm, units)) : roundCoreTextMetricToWholePx(units, d.unitsPerEm, size));
      return { ascent: round(d.ascent), descent: round(d.descent), lineGap: d.lineGap === 0 ? ZERO : round(d.lineGap) };
    },
    // ShapeResult::SnappedWidth of the whole item: FromFloatCeil of its float width.
    measure(text: string, font: TextFont): MeasureResult {
      const s = itemFor(text, font);
      if (!s.ok) return { ok: false, code: s.code, reason: s.reason };
      return { ok: true, measure: { width: snapWidth(s.result.width, faults) } };
    },
    // ShapeResult::CachedWidth: the difference of the item's cached positions at code points start and end.
    measureRange(text: string, start: number, end: number, font: TextFont): MeasureResult {
      const s = itemFor(text, font);
      if (!s.ok) return { ok: false, code: s.code, reason: s.reason };
      const a = cachedPositionForOffset(s.result, offsetOf(s.item.units, start));
      const b = cachedPositionForOffset(s.result, offsetOf(s.item.units, end));
      return { ok: true, measure: { width: sub(fromRaw(b), fromRaw(a)) } };
    },
    // The float metrics of the face at the platform size (V2 of the value model); a face that is not bundled has none.
    lengths(font: TextFont): FontLengths {
      const f = faces.get(font.family);
      if (f === undefined) throw new Error(`no bundled face ${font.family}; the host passes every face the input names`);
      return fontMetricLengths(f.data, platformFontSize(font.size));
    },
    shaped(text: string, font: TextFont): ShapedItem {
      return itemFor(text, font);
    },
    hasFace(family: string): boolean {
      return faces.has(family);
    },
  };
  return { measurer, item, line };
}

/** R2: the measurer over bundled faces and the host's HarfBuzz. */
export function shapedMeasurer(faces: ReadonlyMap<string, ShapedFace>, shaper: GlyphShaper, faults: ShapingFaults, language: string): TextMeasurer {
  return shapedText(faces, shaper, faults, language).measurer;
}

/**
 * R4 (notes/T056-txt1a-spec.md): the engine's measurer accepts only text whose code points are all Latin, Common or Inherited,
 * and refuses anything else with text-script; TXT1c and TXT2 own other scripts. The shaping core itself stays script-agnostic,
 * since the TXT1-S gate shapes every script. latinCheckSkipped plants the missing check.
 */
export function latinScopedMeasurer(measurer: TextMeasurer, latinCheckSkipped: boolean): TextMeasurer {
  if (latinCheckSkipped) return measurer;
  return {
    metrics(font: TextFont): FontMetrics {
      return measurer.metrics(font);
    },
    measure(text: string, font: TextFont): MeasureResult {
      const outside = firstOutsideLatin(text);
      if (outside >= 0) return outsideLatinRefusal(outside);
      return measurer.measure(text, font);
    },
    measureRange(text: string, start: number, end: number, font: TextFont): MeasureResult {
      const outside = firstOutsideLatin(text);
      if (outside >= 0) return outsideLatinRefusal(outside);
      return measurer.measureRange(text, start, end, font);
    },
    lengths(font: TextFont): FontLengths {
      return measurer.lengths(font);
    },
    shaped(text: string, font: TextFont): ShapedItem {
      const outside = firstOutsideLatin(text);
      if (outside >= 0) return { ok: false, code: 'text-script', reason: outsideLatinReason(outside) };
      return measurer.shaped(text, font);
    },
    hasFace(family: string): boolean {
      return measurer.hasFace(family);
    },
  };
}

/** The first code point of text outside Latin, Common and Inherited, or -1. */
function firstOutsideLatin(text: string): number {
  for (const ch of text) if (!isLatinText(ch)) return ch.codePointAt(0) as number;
  return -1;
}

function outsideLatinReason(cp: number): string {
  return `U+${cp.toString(16).toUpperCase()} is outside Latin, Common and Inherited (R4)`;
}

function outsideLatinRefusal(cp: number): MeasureResult {
  return { ok: false, code: 'text-script', reason: outsideLatinReason(cp) };
}
