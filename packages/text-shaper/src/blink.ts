// The parts of Blink's text pipeline (Chrome 145) that turn HarfBuzz's 16.16 glyph positions into the
// LayoutUnit widths of lines: ShapeResult runs (shape_result.cc), ShapeResultView parts
// (shape_result_view.cc), ShapingLineBreaker's reshaping at line edges (shaping_line_breaker.cc) and
// LayoutUnit::FromFloatCeil. Line breaks are inputs; this module measures, it does not break.
import type { DragonHB, Feature } from './wasm.ts';
import { GLYPH_FLAG_UNSAFE_TO_BREAK, GLYPH_STRIDE } from './wasm.ts';
import { segmentText } from './script.ts';

const f32 = Math.fround;

export interface GlyphData {
  readonly glyph: number;
  /** Character index relative to the run start. */
  readonly ci: number;
  /** 16.16 advance (TextRunLayoutUnit). */
  readonly advance: number;
  /** SafeToBreakBefore. */
  safe: boolean;
}

export interface Run {
  readonly start: number;
  readonly numChars: number;
  readonly glyphs: readonly GlyphData[];
  /** InlineLayoutUnit sum of the advances, ToFloat(). */
  readonly width: number;
}

export interface ShapeResult {
  readonly start: number;
  readonly end: number;
  readonly runs: readonly Run[];
  /** Float sum of run widths (ShapeResult::width_). */
  readonly width: number;
}

/** InlineLayoutUnit (int64 16.16) sum to float: static_cast<float>(raw) / 65536. */
export function inlineToFloat(raw: number): number {
  return f32(f32(raw) / 65536);
}

/** LayoutUnit::FromFloatCeil, as a raw 1/64 value. */
export function fromFloatCeil(value: number): number {
  return Math.ceil(f32(f32(value) * 64));
}

export interface ShapeOptions {
  readonly isLineStart?: boolean;
  readonly hanKerningStart?: boolean;
  readonly hanKerningEnd?: boolean;
}

/** Deliberate departures from Blink, used to show the gate can fail. */
export interface GateFaults {
  /** Sum glyph advances in float instead of InlineLayoutUnit. */
  readonly floatAccumulation?: boolean;
  /** Round positions to whole pixels (Blink's path for fonts without subpixel positioning). */
  readonly wholePixelPositions?: boolean;
  /** Turn off `kern`. */
  readonly noKerning?: boolean;
  /** Keep the paragraph's glyphs at the start of wrapped lines instead of reshaping there. */
  readonly noReshapeAtLineStart?: boolean;
}

/** Everything HarfBuzzShaper needs for one paragraph (one text item with one font). */
export interface ShapeContext {
  readonly hb: DragonHB;
  readonly font: number;
  readonly text: string;
  readonly language: string;
  readonly segments: ReadonlyArray<{ start: number; end: number; script: string }>;
  /** FontFeatureRange::FromFontDescription for the style. */
  readonly features: readonly Feature[];
  /** Extra features per shaped range (HanKerning), plus offsets that become unsafe to break. */
  readonly rangeFeatures?: (start: number, end: number, options: ShapeOptions) => { features: Feature[]; unsafeToBreakBefore: number[] } | undefined;
  readonly faults?: GateFaults;
}

export function makeContext(hb: DragonHB, font: number, text: string, language: string, extra?: Partial<Pick<ShapeContext, 'features' | 'rangeFeatures' | 'faults'>>): ShapeContext {
  const faults = extra?.faults ?? {};
  // Horizontal, font-kerning auto, ligatures normal, text-spacing-trim normal: only `chws`.
  const features = extra?.features ?? [{ tag: 'chws', value: 1 }];
  return {
    hb,
    font,
    text,
    language,
    segments: segmentText(text),
    features: faults.noKerning === true ? [{ tag: 'kern', value: 0 }, ...features] : features,
    ...(extra?.rangeFeatures !== undefined ? { rangeFeatures: extra.rangeFeatures } : {}),
    faults,
  };
}

/** A run or part width from its glyph advances. */
function sumAdvances(advances: readonly number[], faults: GateFaults | undefined): number {
  if (faults?.floatAccumulation === true) {
    let w = 0;
    for (const a of advances) w = f32(w + f32(a / 65536));
    return w;
  }
  let sum = 0;
  for (const a of advances) sum += a;
  return inlineToFloat(Math.max(0, sum));
}

/** HarfBuzzShaper::Shape over [start, end) with the paragraph as context. */
export function shape(ctx: ShapeContext, start: number, end: number, options: ShapeOptions = {}): ShapeResult {
  const runs: Run[] = [];
  let width = 0;
  const unsafe: number[] = [];
  for (const seg of ctx.segments) {
    const s = Math.max(seg.start, start);
    const e = Math.min(seg.end, end);
    if (e <= s) continue;
    let features = ctx.features;
    const extra = ctx.rangeFeatures?.(s, e, {
      isLineStart: options.isLineStart === true && s === start,
      hanKerningStart: options.hanKerningStart === true && s === start,
      hanKerningEnd: options.hanKerningEnd === true && e === end,
    });
    if (extra !== undefined) {
      features = [...features, ...extra.features];
      unsafe.push(...extra.unsafeToBreakBefore);
    }
    const g = ctx.hb.shape(ctx.font, ctx.text, s, e - s, { script: seg.script, language: ctx.language, features });
    const glyphs: GlyphData[] = [];
    const n = g.length / GLYPH_STRIDE;
    for (let i = 0; i < n; i++) {
      const o = i * GLYPH_STRIDE;
      const gid = g[o] as number;
      const cluster = g[o + 1] as number;
      if (gid === 0) throw new Error(`gate: U+${ctx.text.codePointAt(cluster)?.toString(16)} has no glyph; font fallback is outside the gate`);
      const safe = i === 0 ? true : cluster === (g[o + 1 - GLYPH_STRIDE] as number) ? false : ((g[o + 6] as number) & GLYPH_FLAG_UNSAFE_TO_BREAK) === 0;
      const raw = g[o + 2] as number;
      // RoundHarfBuzzPosition, applied only as a planted fault (macOS positions subpixel).
      const advance = ctx.faults?.wholePixelPositions === true && (raw & 0xffff) !== 0 ? Math.round(f32(raw) / 65536) * 65536 : raw;
      glyphs.push({ glyph: gid, ci: cluster - s, advance, safe });
    }
    const run: Run = { start: s, numChars: e - s, glyphs, width: sumAdvances(glyphs.map((x) => x.advance), ctx.faults) };
    runs.push(run);
    width = f32(width + run.width);
  }
  const result: ShapeResult = { start, end, runs, width };
  if (unsafe.length > 0) addUnsafeToBreak(result, unsafe);
  return result;
}

/** ShapeResult::AddUnsafeToBreak (LTR). */
function addUnsafeToBreak(result: ShapeResult, offsets: number[]): void {
  const sorted = [...new Set(offsets)].sort((a, b) => a - b);
  for (const offset of sorted) {
    for (const run of result.runs) {
      const ro = offset - run.start;
      if (ro < 0 || ro >= run.numChars) continue;
      for (const g of run.glyphs) if (g.ci === ro) g.safe = false;
    }
  }
}

/** ShapeResult::ComputePositionData's safe_to_break_before per character (LTR). */
function safeFlags(result: ShapeResult): boolean[] {
  const n = result.end - result.start;
  const safe = new Array<boolean>(n).fill(false);
  let next = 0;
  for (const run of result.runs) {
    for (const g of run.glyphs) {
      const idx = run.start + g.ci - result.start;
      if (next <= idx) {
        safe[idx] = g.safe;
        next = idx + 1;
      }
    }
  }
  return safe;
}

const safeCache = new WeakMap<ShapeResult, boolean[]>();
function safeOf(result: ShapeResult): boolean[] {
  let s = safeCache.get(result);
  if (s === undefined) {
    s = safeFlags(result);
    safeCache.set(result, s);
  }
  return s;
}

export function cachedNextSafeToBreakOffset(result: ShapeResult, offset: number): number {
  const safe = safeOf(result);
  for (let i = offset - result.start; i < safe.length; i++) if (safe[i]) return result.start + i;
  return result.end;
}

export function cachedPreviousSafeToBreakOffset(result: ShapeResult, offset: number): number {
  const safe = safeOf(result);
  const adj = offset - result.start;
  if (adj >= safe.length) return result.end;
  for (let i = adj; i >= 0; i--) if (safe[i]) return result.start + i;
  return result.start;
}

/** A ShapeResultView segment: the characters [start, end) of a ShapeResult. */
export interface Segment {
  readonly result: ShapeResult;
  readonly start: number;
  readonly end: number;
}

/** ShapeResultView::PopulateRunInfoParts: part widths, summed in float. */
export function viewWidth(segments: readonly Segment[], faults?: GateFaults): number {
  let width = 0;
  for (const seg of segments) {
    for (const run of seg.result.runs) {
      const runEnd = run.start + run.numChars;
      const s = Math.max(seg.start, run.start);
      const e = Math.min(seg.end, runEnd);
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
        part = sumAdvances(advances, faults);
      }
      width = f32(width + part);
    }
  }
  return width;
}

/** LazyLineBreakIterator::IsBreakableSpace || Character::IsOtherSpaceSeparator. */
export function isBreakableSpace(ch: number): boolean {
  return ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x3000;
}

export interface LineMeasure {
  /** The line's text item ends here: the break offset before its trailing spaces. */
  readonly end: number;
  /** ShapeResultView::SnappedWidth of the line's text, raw LayoutUnits. */
  readonly lu: number;
  readonly segments: readonly Segment[];
}

/** ShapeResult::ComputePositionData's x_position per character (raw LayoutUnits, LTR) and width_. */
function positions(result: ShapeResult): { x: number[]; total: number } {
  const n = result.end - result.start;
  const x = new Array<number>(n).fill(0);
  let next = 0;
  let total = 0;
  let lastX = 0;
  for (const run of result.runs) {
    for (const g of run.glyphs) {
      const idx = run.start + g.ci - result.start;
      if (next <= idx) {
        for (let i = next; i < idx; i++) x[i] = lastX;
        lastX = Math.ceil(total / 1024); // InlineLayoutUnit::ToCeil<LayoutUnit>: 16.16 to 1/64
        x[idx] = lastX;
        next = idx + 1;
      }
      total += g.advance;
    }
  }
  for (let i = next; i < n; i++) x[i] = lastX;
  return { x, total };
}

const positionCache = new WeakMap<ShapeResult, { x: number[]; total: number }>();
function positionsOf(result: ShapeResult): { x: number[]; total: number } {
  let p = positionCache.get(result);
  if (p === undefined) {
    p = positions(result);
    positionCache.set(result, p);
  }
  return p;
}

/** ShapeResult::CachedPositionForOffset (LTR), raw LayoutUnits. */
function cachedPositionForOffset(result: ShapeResult, offset: number): number {
  const p = positionsOf(result);
  const i = offset - result.start;
  return i < p.x.length ? (p.x[i] as number) : fromFloatCeil(inlineToFloat(p.total));
}

/** ShapeResult::CachedOffsetForPosition (LTR): the character whose span holds x (raw LayoutUnits). */
function cachedOffsetForPosition(result: ShapeResult, x: number): number {
  const p = positionsOf(result);
  const n = p.x.length;
  if (x <= 0) return result.start;
  if (x / 64 >= inlineToFloat(p.total)) return result.end;
  let low = 0;
  let high = n - 1;
  while (low <= high) {
    const mid = low + ((high - low) >> 1);
    const xm = p.x[mid] as number;
    if (xm <= x && (mid + 1 === n || (p.x[mid + 1] as number) > x)) return result.start + mid;
    if (x < xm) high = mid - 1;
    else low = mid + 1;
  }
  return result.start;
}

export interface LineOptions {
  /** The line's available inline size, raw LayoutUnits. */
  readonly available: number;
  /** Whether the line breaker may break before this offset (LazyLineBreakIterator::IsBreakable). */
  readonly isBreakable: (offset: number) => boolean;
  /** Character::MaybeHanKerningClose, when text-spacing-trim trims line ends (ShouldTrimEnd). */
  readonly maybeHanKerningClose?: (cp: number) => boolean;
}

/**
 * The ShapeResultView ShapingLineBreaker::ShapeLine builds for a line [start, breakOffset) that Chrome
 * chose, with `text-align: start` (so LineBreaker sets DontReshapeEndIfAtSpace) and
 * `text-spacing-trim: normal` (no trimming at the start of wrapped lines).
 */
export function lineView(ctx: ShapeContext, paragraph: ShapeResult, start: number, breakOffset: number, o: LineOptions): LineMeasure {
  const text = ctx.text;
  const rangeStart = paragraph.start;
  const rangeEnd = paragraph.end;
  let available = o.available;
  // Break opportunity with trailing spaces: the offset moves to the non-hangable run end.
  let end = breakOffset;
  while (end > start + 1 && isBreakableSpace(text.charCodeAt(end - 1))) end--;
  const endsInSpace = end !== breakOffset;
  const whole = (): LineMeasure => {
    const segments = [{ result: paragraph, start: rangeStart, end: rangeEnd }];
    return { end: rangeEnd, lu: fromFloatCeil(viewWidth(segments, ctx.faults)), segments };
  };

  // Early return: the whole item fits.
  if (start === rangeStart && available >= fromFloatCeil(paragraph.width) && isStartSafe(paragraph)) {
    if (breakOffset !== rangeEnd) throw new Error(`gate model: the paragraph fits but Chrome broke at ${breakOffset}`);
    return whole();
  }

  const startPosition = cachedPositionForOffset(paragraph, start);
  // FirstSafeOffset: only the start of a wrapped line reshapes.
  const firstSafe = start !== 0 && ctx.faults?.noReshapeAtLineStart !== true ? cachedNextSafeToBreakOffset(paragraph, start) : start;
  let lineStart: ShapeResult | undefined;
  if (firstSafe !== start) {
    lineStart = shape(ctx, start, firstSafe, { isLineStart: true });
    const oldWidth = cachedPositionForOffset(paragraph, firstSafe) - startPosition;
    const diff = oldWidth - fromFloatCeil(lineStart.width);
    if (diff !== 0) available = Math.max(available + diff, 0);
  }

  const endPosition = startPosition + available;
  let candidate = cachedOffsetForPosition(paragraph, endPosition);
  let lastSafe = end;
  let lineEnd: ShapeResult | undefined;
  // Extend the candidate if the next character fits after HanKerning trims it at the line end.
  if (candidate < rangeEnd && o.maybeHanKerningClose?.(text.charCodeAt(candidate)) === true && o.isBreakable(candidate + 1)) {
    const adjusted = candidate + 1;
    const safe = cachedPreviousSafeToBreakOffset(paragraph, candidate);
    const trimmed = shape(ctx, safe, adjusted, { hanKerningEnd: true });
    const widthToSafe = cachedPositionForOffset(paragraph, safe) - startPosition;
    if (f32(widthToSafe / 64 + trimmed.width) <= available / 64) {
      candidate = adjusted;
      if (breakOffset !== adjusted) throw new Error(`gate model: HanKerning extends the line to ${adjusted} but Chrome broke at ${breakOffset}`);
      lineEnd = trimmed;
      lastSafe = safe;
    }
  }

  if (candidate >= rangeEnd) {
    // ShapeToEnd.
    if (breakOffset !== rangeEnd) throw new Error(`gate model: the rest fits but Chrome broke at ${breakOffset}`);
    const segments: Segment[] = [];
    if (lineStart !== undefined) {
      if (firstSafe >= rangeEnd) {
        segments.push({ result: lineStart, start, end: rangeEnd });
        return { end: rangeEnd, lu: fromFloatCeil(viewWidth(segments, ctx.faults)), segments };
      }
      segments.push({ result: lineStart, start: lineStart.start, end: lineStart.end });
    }
    segments.push({ result: paragraph, start: firstSafe, end: rangeEnd });
    return { end: rangeEnd, lu: fromFloatCeil(viewWidth(segments, ctx.faults)), segments };
  }

  if (firstSafe >= end && lineStart !== undefined) {
    const all = shape(ctx, start, end, { isLineStart: true });
    return { end, lu: fromFloatCeil(all.width), segments: [{ result: all, start, end }] };
  }

  // The end reshapes only when the break is not after a space and not at the end of the item.
  if (lineEnd === undefined && breakOffset < rangeEnd && !endsInSpace) {
    lastSafe = cachedPreviousSafeToBreakOffset(paragraph, end);
    if (lastSafe !== end) {
      if (lastSafe < firstSafe) {
        lastSafe = start;
        lineStart = undefined;
      }
      lineEnd = shape(ctx, lastSafe, end);
    }
  }

  const segments: Segment[] = [];
  if (lineStart !== undefined) segments.push({ result: lineStart, start: lineStart.start, end: lineStart.end });
  const middleStart = lineStart !== undefined ? firstSafe : start;
  if (lastSafe > middleStart) segments.push({ result: paragraph, start: middleStart, end: lastSafe });
  if (lineEnd !== undefined) segments.push({ result: lineEnd, start: lineEnd.start, end: lineEnd.end });
  return { end, lu: fromFloatCeil(viewWidth(segments, ctx.faults)), segments };
}

/** ShapeResult::IsStartSafeToBreak (LTR). */
function isStartSafe(result: ShapeResult): boolean {
  const run = result.runs[0];
  const g = run?.glyphs[0];
  return run !== undefined && g !== undefined && g.safe && result.start === run.start + g.ci;
}
