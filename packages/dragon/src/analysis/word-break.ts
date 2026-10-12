// UAX #29 §4 word boundaries at Unicode 16.0.0, clean-room from the annex, for text-transform: capitalize (text-transform.ts).
// Build-time only: it runs in the compiler, never on device. Two rule sets: 'uax29' is the annex as written (WordBreakTest-16.0.0
// passes N/N), and 'chrome' is Chrome 145's word iterator, ICU's word.txt as Chromium ships it (third_party/icu
// source/data/brkitr/rules/word.txt, Unicode licence, with patches/wordbrk.patch): full stops are MidNum, the colons are not
// MidLetter, Han, kana and Hangul syllables are not ALetter and chain into dictionary runs, and Complex_Context letters are ALetter.
// Boundaries ICU's dictionary engines add inside a dictionary run (dictionaryRun) are not modelled; they never change a case mapping.
import { COMPLEX_CONTEXT, DICTIONARY_CJK, EXTENDED_PICTOGRAPHIC, HAN, WORD_BREAK_STARTS, WORD_BREAK_VALUES } from './case-data.generated.ts';

export type WordRules = 'uax29' | 'chrome';

// Word_Break codes, in the order of case-data.generated.ts WORD_BREAK_NAMES.
const OTHER = 0;
const CR = 1;
const LF = 2;
const NEWLINE = 3;
const EXTEND = 4;
const ZWJ = 5;
const RI = 6;
const FORMAT = 7;
const KATAKANA = 8;
const HEBREW = 9;
const ALETTER = 10;
const SINGLE_QUOTE = 11;
const DOUBLE_QUOTE = 12;
const MID_NUM_LET = 13;
const MID_LETTER = 14;
const MID_NUM = 15;
const NUMERIC = 16;
const EXTEND_NUM_LET = 17;
const WSEG_SPACE = 18;
// Chrome only: a Han, kana or Hangul syllable code point that is not Katakana by Word_Break ($KanaKanji, $HangulSyllable).
const DICTIONARY = 19;

function lastAtMost(starts: readonly number[], cp: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] as number) <= cp) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Whether cp is in a flat inclusive [start, end, ...] range list. */
export function inRanges(list: readonly number[], cp: number): boolean {
  let lo = 0;
  let hi = list.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < (list[2 * mid] as number)) hi = mid - 1;
    else if (cp > (list[2 * mid + 1] as number)) lo = mid + 1;
    else return true;
  }
  return false;
}

/** The Word_Break value of cp (a lone surrogate is Other). */
export function wordBreakOf(cp: number): number {
  return WORD_BREAK_VALUES[lastAtMost(WORD_BREAK_STARTS, cp)] as number;
}

/** Whether cp is a character ICU's dictionary engines segment in Chrome ($dictionary: Complex_Context, Han, kana, Hangul syllables). */
export function isDictionary(cp: number): boolean {
  return inRanges(COMPLEX_CONTEXT, cp) || inRanges(DICTIONARY_CJK, cp);
}

function classOf(cp: number, rules: WordRules): number {
  const c = wordBreakOf(cp);
  if (rules === 'uax29') return c;
  // word.txt: $Extend = [\p{Word_Break = Extend}-$Han].
  if (c === EXTEND && inRanges(HAN, cp)) return OTHER;
  // $MidNumLet - [. ．], both added to $MidNum; $MidLetter - [\: ﹕ ：].
  if (c === MID_NUM_LET && (cp === 0x2e || cp === 0xff0e)) return MID_NUM;
  if (c === MID_LETTER && (cp === 0x3a || cp === 0xfe55 || cp === 0xff1a)) return OTHER;
  // $ALetterPlus = [$ALetter-$dictionaryCJK [$ComplexContext-$Extend-$Control]] (Complex_Context has no Control).
  if (c !== KATAKANA && inRanges(DICTIONARY_CJK, cp)) return DICTIONARY;
  if (c !== EXTEND && c !== ZWJ && c !== FORMAT && inRanges(COMPLEX_CONTEXT, cp)) return ALETTER;
  return c;
}

const ignorable = (c: number): boolean => c === EXTEND || c === FORMAT || c === ZWJ;
const separator = (c: number): boolean => c === CR || c === LF || c === NEWLINE;
const ahLetter = (c: number): boolean => c === ALETTER || c === HEBREW;
const midLetterQ = (c: number): boolean => c === MID_LETTER || c === MID_NUM_LET || c === SINGLE_QUOTE;
const midNumQ = (c: number): boolean => c === MID_NUM || c === MID_NUM_LET || c === SINGLE_QUOTE;

/**
 * The word boundaries of a string as UTF-16 offsets, from 0 to its length inclusive (UAX #29 WB1-WB999). A lone surrogate is one
 * code point of Word_Break Other.
 */
export function wordBoundaries(text: string, rules: WordRules = 'chrome'): number[] {
  const cps: number[] = [];
  const offsets: number[] = [];
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;
    cps.push(cp);
    offsets.push(i);
    i += cp > 0xffff ? 2 : 1;
  }
  const n = cps.length;
  const cls = cps.map((cp) => classOf(cp, rules));
  const pict = cps.map((cp) => inRanges(EXTENDED_PICTOGRAPHIC, cp));
  // WB4: the index of the character a position's preceding run of Extend, Format and ZWJ attaches to.
  const base = (i: number): number => {
    let p = i;
    while (p > 0 && ignorable(cls[p] as number) && !separator(cls[p - 1] as number)) p--;
    return p;
  };
  const next = (i: number): number => {
    let j = i;
    while (j < n && ignorable(cls[j] as number)) j++;
    return j;
  };
  const out = [0];
  for (let i = 1; i < n; i++) {
    if (!breaksBefore(i)) continue;
    out.push(offsets[i] as number);
  }
  if (n > 0) out.push(text.length);
  return out;

  function breaksBefore(i: number): boolean {
    const rawPrev = cls[i - 1] as number;
    const rawNext = cls[i] as number;
    if (rawPrev === CR && rawNext === LF) return false; // WB3
    if (separator(rawPrev) || separator(rawNext)) return true; // WB3a, WB3b
    if (rawPrev === ZWJ && pict[i]) return false; // WB3c
    if (rawPrev === WSEG_SPACE && rawNext === WSEG_SPACE) return false; // WB3d
    if (ignorable(rawNext)) return false; // WB4
    // word.txt: $HangulSyllable $HangulSyllable and $KanaKanji $KanaKanji chain for the dictionary engines.
    if (rules === 'chrome' && rawPrev === DICTIONARY && rawNext === DICTIONARY) return false;
    const p = base(i - 1);
    const prev = cls[p] as number;
    const cur = rawNext;
    const after = next(i + 1);
    const next2 = after < n ? (cls[after] as number) : -1;
    const before = p > 0 ? base(p - 1) : -1;
    const prev2 = before >= 0 && before !== p ? (cls[before] as number) : -1;
    if (ahLetter(prev) && ahLetter(cur)) return false; // WB5
    if (ahLetter(prev) && midLetterQ(cur) && ahLetter(next2)) return false; // WB6
    if (ahLetter(prev2) && midLetterQ(prev) && ahLetter(cur)) return false; // WB7
    if (prev === HEBREW && cur === SINGLE_QUOTE) return false; // WB7a
    if (prev === HEBREW && cur === DOUBLE_QUOTE && next2 === HEBREW) return false; // WB7b
    if (prev2 === HEBREW && prev === DOUBLE_QUOTE && cur === HEBREW) return false; // WB7c
    if (prev === NUMERIC && cur === NUMERIC) return false; // WB8
    if (ahLetter(prev) && cur === NUMERIC) return false; // WB9
    if (prev === NUMERIC && ahLetter(cur)) return false; // WB10
    if (prev2 === NUMERIC && midNumQ(prev) && cur === NUMERIC) return false; // WB11
    if (prev === NUMERIC && midNumQ(cur) && next2 === NUMERIC) return false; // WB12
    if (prev === KATAKANA && cur === KATAKANA) return false; // WB13
    if ((ahLetter(prev) || prev === NUMERIC || prev === KATAKANA || prev === EXTEND_NUM_LET) && cur === EXTEND_NUM_LET) return false; // WB13a
    if (prev === EXTEND_NUM_LET && (ahLetter(cur) || cur === NUMERIC || cur === KATAKANA)) return false; // WB13b
    if (prev === RI && cur === RI) {
      // WB15, WB16: break between pairs only, counting the Regional_Indicators (with what attaches to them) before the position.
      let count = 0;
      for (let q = p; q >= 0 && cls[q] === RI; q = q > 0 ? base(q - 1) : -1) {
        count++;
      }
      return count % 2 === 0;
    }
    return true; // WB999
  }
}
