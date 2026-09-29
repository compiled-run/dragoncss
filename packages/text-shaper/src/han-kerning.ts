// Blink's HanKerning (han_kerning.cc, Chrome 145) for `text-spacing-trim: normal` in horizontal text:
// the `halt` feature on fullwidth punctuation next to other punctuation, applied per shaped range.
import type { ShapeOptions } from './blink.ts';
import type { DragonHB, Feature } from './wasm.ts';

export const CharType = {
  Other: 0,
  Open: 1,
  Close: 2,
  Middle: 3,
  Dot: 4,
  Colon: 5,
  Semicolon: 6,
  OpenQuote: 7,
  CloseQuote: 8,
  OpenNarrow: 9,
  CloseNarrow: 10,
} as const;
export type CharType = (typeof CharType)[keyof typeof CharType];

const psRe = /^\p{gc=Ps}$/u;
const peRe = /^\p{gc=Pe}$/u;

/** East_Asian_Width=F. */
function isFullwidth(cp: number): boolean {
  return cp === 0x3000 || (cp >= 0xff01 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6);
}

/** Character::GetHanKerningCharType (character_property_data_generator.cc, SetHanKerning). */
export function hanKerningCharType(cp: number): CharType {
  switch (cp) {
    case 0x2018:
    case 0x201c:
      return CharType.OpenQuote;
    case 0x2019:
    case 0x201d:
      return CharType.CloseQuote;
    case 0x3000:
    case 0x00b7:
    case 0x2027:
    case 0x30fb:
      return CharType.Middle;
    case 0x3001:
    case 0x3002:
    case 0xff0c:
    case 0xff0e:
      return CharType.Dot;
    case 0xff1a:
      return CharType.Colon;
    case 0xff1b:
      return CharType.Semicolon;
  }
  const ch = String.fromCodePoint(cp);
  const cjk = (cp >= 0x3000 && cp <= 0x303f) || isFullwidth(cp);
  if (psRe.test(ch)) return cjk ? CharType.Open : CharType.OpenNarrow;
  if (peRe.test(ch)) return cjk ? CharType.Close : CharType.CloseNarrow;
  return CharType.Other;
}

/** Character::MaybeHanKerningOpenOrCloseFast. */
function maybeOpenOrCloseFast(cp: number): boolean {
  return (cp >= 0x2018 && cp <= 0x301f) || (cp >= 0xff08 && cp <= 0xff60);
}

export function maybeHanKerningClose(cp: number): boolean {
  const t = hanKerningCharType(cp);
  return maybeOpenOrCloseFast(cp) && (t === CharType.Close || t === CharType.CloseQuote);
}

/** HanKerning::MayApply: 16-bit text with at least one character in the fast ranges. */
function mayApply(text: string): boolean {
  if (!/[^\u0000-ÿ]/.test(text)) return false;
  for (let i = 0; i < text.length; i++) if (maybeOpenOrCloseFast(text.charCodeAt(i))) return true;
  return false;
}

function shouldKern(type: CharType, last: CharType): boolean {
  return type === CharType.Open && (last === CharType.Open || last === CharType.Middle || last === CharType.Close || last === CharType.OpenNarrow);
}

function shouldKernLast(type: CharType, last: CharType): boolean {
  return last === CharType.Close && (type === CharType.Close || type === CharType.Middle || type === CharType.CloseNarrow);
}

interface FontData {
  readonly hasAlternateSpacing: boolean;
  readonly hasContextualSpacing: boolean;
  readonly typeForDot: CharType;
  readonly typeForColon: CharType;
  readonly typeForSemicolon: CharType;
  readonly isQuoteFullwidth: boolean;
}

/** CharTypeFromBounds over glyphs that must share one advance and one type. */
function typeFromBounds(glyphs: ReadonlyArray<{ glyph: number; advance: number; left: number; right: number }>): CharType {
  let advance0 = 0;
  let type0: CharType = CharType.Other;
  let i = 0;
  for (; ; i++) {
    const g = glyphs[i];
    if (g === undefined) return CharType.Other;
    if (g.glyph === 0) continue;
    advance0 = g.advance;
    type0 = typeOne(advance0 / 2, g);
    break;
  }
  for (i++; i < glyphs.length; i++) {
    const g = glyphs[i] as (typeof glyphs)[number];
    if (g.glyph === 0) continue;
    if (g.advance !== advance0) return CharType.Other;
    if (typeOne(advance0 / 2, g) !== type0) return CharType.Other;
  }
  return type0;
}

function typeOne(halfEm: number, b: { left: number; right: number }): CharType {
  if (b.right <= halfEm) return CharType.Close;
  if (b.left >= halfEm) return CharType.Open;
  if (b.right - b.left <= halfEm && b.left >= halfEm / 2) return CharType.Middle;
  return CharType.Other;
}

/** HanKerning::FontData for a horizontal font and locale. */
function fontData(hb: DragonHB, face: number, font: number, language: string): FontData {
  const gpos = new Set(hb.faceFeatureTags(face, 'GPOS'));
  const none: FontData = { hasAlternateSpacing: false, hasContextualSpacing: false, typeForDot: CharType.Other, typeForColon: CharType.Other, typeForSemicolon: CharType.Other, isQuoteFullwidth: false };
  if (!gpos.has('halt')) return none;
  const chars = '、。，．：；“‘”’';
  // GetGlyphData with LayoutLocale::GetScriptForHan: USCRIPT_KATAKANA_OR_HIRAGANA ('Hrkt') for ja.
  const script = language === 'ja' ? 'Hrkt' : language.startsWith('ko') ? 'Kore' : language.startsWith('zh-Hant') || language === 'zh-TW' || language === 'zh-HK' ? 'Hant' : 'Hani';
  const g = hb.shape(font, chars, 0, chars.length, { script, language });
  const n = g.length / 7;
  if (n !== chars.length) return { ...none, hasContextualSpacing: gpos.has('chws') };
  const glyphs = [];
  for (let i = 0; i < n; i++) {
    const o = i * 7;
    if (g[o + 1] !== i) return { ...none, hasContextualSpacing: gpos.has('chws') };
    const gid = g[o] as number;
    const e = hb.glyphExtents(font, gid);
    const xOffset = (g[o + 4] as number) / 65536;
    const left = (e === undefined ? 0 : e[0] / 65536) + xOffset;
    const right = (e === undefined ? 0 : (e[0] + e[2]) / 65536) + xOffset;
    glyphs.push({ glyph: gid, advance: Math.fround((g[o + 2] as number) / 65536), left, right });
  }
  const quoteOpen = typeFromBounds(glyphs.slice(6, 8));
  const quoteClose = typeFromBounds(glyphs.slice(8, 10));
  return {
    hasAlternateSpacing: true,
    hasContextualSpacing: gpos.has('chws'),
    typeForDot: typeFromBounds(glyphs.slice(0, 4)),
    typeForColon: typeFromBounds(glyphs.slice(4, 5)),
    typeForSemicolon: typeFromBounds(glyphs.slice(5, 6)),
    isQuoteFullwidth: quoteOpen === CharType.Open && quoteClose === CharType.Close,
  };
}

function charType(cp: number, fd: FontData): CharType {
  const t = hanKerningCharType(cp);
  switch (t) {
    case CharType.Dot:
      return fd.typeForDot;
    case CharType.Colon:
      return fd.typeForColon;
    case CharType.Semicolon:
      return fd.typeForSemicolon;
    case CharType.OpenQuote:
      return fd.isQuoteFullwidth ? CharType.Open : CharType.OpenNarrow;
    case CharType.CloseQuote:
      return fd.isQuoteFullwidth ? CharType.Close : CharType.CloseNarrow;
    default:
      return t;
  }
}

export interface HanKerning {
  /** HanKerning::AppendFontFeatures for one shaped range; undefined when it does not apply. */
  rangeFeatures(start: number, end: number, options: ShapeOptions): { features: Feature[]; unsafeToBreakBefore: number[] } | undefined;
}

export function hanKerningFor(hb: DragonHB, face: number, font: number, text: string, language: string): HanKerning | undefined {
  if (!mayApply(text)) return undefined;
  let fd: FontData | undefined;
  return {
    rangeFeatures(start, end, options) {
      if (!mayApply(text.slice(start, end))) return undefined;
      fd ??= fontData(hb, face, font, language);
      if (!fd.hasAlternateSpacing) return undefined;
      const type = (i: number): CharType => charType(text.charCodeAt(i), fd as FontData);
      const indices: number[] = [];
      const unsafe: number[] = [];
      let last: CharType;
      if (options.hanKerningStart === true) {
        indices.push(start);
        unsafe.push(start);
        last = type(start);
      } else if (start > 0 && options.isLineStart !== true) {
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
        if (options.hanKerningEnd === true) {
          indices.push(end - 1);
        } else if (end < text.length) {
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
        if (options.hanKerningEnd === true) {
          indices.push(end - 1);
        } else if (end < text.length) {
          if (shouldKernLast(type(end), last)) indices.push(end - 1);
        }
      }
      if (indices.length === 0) return { features: [], unsafeToBreakBefore: unsafe };
      return { features: indices.map((i) => ({ tag: 'halt', value: 1, start: i, end: i + 1 })), unsafeToBreakBefore: unsafe };
    },
  };
}
