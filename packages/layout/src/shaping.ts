// Real-font text measurement (TXT1-S; docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md §2 R1, R2, R5). The host shapes with
// HarfBuzz through GlyphShaper and returns integers only; everything after that is Blink 145's arithmetic, ported from
// packages/text-shaper/src/blink.ts: RunSegmenter's script runs (run_segmenter.cc, script_run_iterator.cc), HanKerning
// (han_kerning.cc), ShapeResult runs (shape_result.cc), ShapeResultView parts (shape_result_view.cc), ShapingLineBreaker's
// reshaping at line edges (shaping_line_breaker.cc) and LayoutUnit::FromFloatCeil. Unreached until TXT1a-1 wires it in.
import type { TextFont } from './input.ts';
import { isEastAsian } from './linebreak.ts';
import {
  bracketIndex, BRACKET_OPEN, BRACKET_PAIRS, isClosePunctuation, isExtendedPictographic, isMark, isOpenPunctuation, SCRIPT_TAGS, scriptCode, scriptExtensions,
  USCRIPT_BOPOMOFO, USCRIPT_COMMON, USCRIPT_HAN, USCRIPT_HIRAGANA, USCRIPT_INHERITED, USCRIPT_KATAKANA, USCRIPT_LATIN,
} from './script-data.ts';
import type { FontData, FontMetrics, MeasureResult, TextMeasurer } from './text.ts';
import type { LU } from './units.ts';
import {
  add, floatAdd, floorToWholePx, fromPxCeil, fromRaw, inlineToFloat, inlineToLayoutUnitCeil, neg, platformFontSize, roundCoreTextMetricToWholePx, sub, toFloat,
  toPx, ZERO,
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
};

export const NO_SHAPING_FAULTS: ShapingFaults = {
  advanceNot16_16: false, doubleAccumulation: false, noReshapeAtBreak: false, kerningDropped: false, wholePixelPositions: false, softHyphenWidthMissing: false,
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
  let total = 0;
  let lastX = 0;
  for (const run of runs) {
    for (const g of run.glyphs) {
      const idx = run.start + g.ci - start;
      if (safe.length <= idx) {
        while (safe.length < idx) {
          safe.push(false);
          positions.push(lastX);
        }
        lastX = inlineToLayoutUnitCeil(total);
        safe.push(g.safe);
        positions.push(lastX);
      }
      total = total + g.advance;
    }
  }
  while (safe.length < n) {
    safe.push(false);
    positions.push(lastX);
  }
  return { start, end, runs, width, missing, safe, positions, total };
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
// The measurer

/** An item shaped once per text, face and size, cached per ShapedText (per layout). */
export type ShapedItem = { readonly ok: true; readonly item: ShapeItem; readonly result: ShapeResult } | { readonly ok: false; readonly reason: string };

export type ShapedText = {
  /** R2's TextMeasurer. Until TXT1a-1 adds TextFont.face, TextFont.family names the face id. */
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
    if (f === undefined) out = { ok: false, reason: `no bundled face ${face}` };
    else {
      const made = makeItem({ shaper, face: f.id, size, text, language, hanKerning: f.hanKerning, faults });
      if (!made.ok) out = { ok: false, reason: made.reason };
      else {
        const result = shapeItem(made.item);
        out = result.missing >= 0 ? { ok: false, reason: `U+${result.missing.toString(16).toUpperCase()} has no glyph; font fallback is outside the shaping core` } : { ok: true, item: made.item, result };
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
      if (f === undefined) return { ascent: ZERO, descent: ZERO, lineGap: ZERO };
      const size = platformFontSize(font.size);
      const d = f.data;
      return {
        ascent: roundCoreTextMetricToWholePx(d.ascent, d.unitsPerEm, size),
        descent: roundCoreTextMetricToWholePx(d.descent, d.unitsPerEm, size),
        lineGap: d.lineGap === 0 ? ZERO : roundCoreTextMetricToWholePx(d.lineGap, d.unitsPerEm, size),
      };
    },
    // ShapeResult::SnappedWidth of the whole item: FromFloatCeil of its float width.
    measure(text: string, font: TextFont): MeasureResult {
      const s = itemFor(text, font);
      if (!s.ok) return { ok: false, reason: s.reason };
      return { ok: true, measure: { width: snapWidth(s.result.width, faults) } };
    },
    // ShapeResult::CachedWidth: the difference of the item's cached positions at code points start and end.
    measureRange(text: string, start: number, end: number, font: TextFont): MeasureResult {
      const s = itemFor(text, font);
      if (!s.ok) return { ok: false, reason: s.reason };
      const a = cachedPositionForOffset(s.result, offsetOf(s.item.units, start));
      const b = cachedPositionForOffset(s.result, offsetOf(s.item.units, end));
      return { ok: true, measure: { width: sub(fromRaw(b), fromRaw(a)) } };
    },
  };
  return { measurer, item, line };
}

/** R2: the measurer over bundled faces and the host's HarfBuzz. */
export function shapedMeasurer(faces: ReadonlyMap<string, ShapedFace>, shaper: GlyphShaper, faults: ShapingFaults, language: string): TextMeasurer {
  return shapedText(faces, shaper, faults, language).measurer;
}
