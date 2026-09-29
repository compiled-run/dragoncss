// The pinned Unicode data of script-data.ts (R4 of docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md, and the ScriptRunIterator
// port in shaping.ts) against the vendored Unicode 16.0.0 files, read here independently of the generator, and against V8's ICU
// for every code point Unicode 16.0.0 assigns a script.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bracketIndex, BRACKET_OPEN, BRACKET_PAIRS, isClosePunctuation, isExtendedPictographic, isLatinText, isMark, isOpenPunctuation, SCRIPT_STARTS, SCRIPT_TAGS,
  SCRIPT_UNICODE_VERSION, SCRIPT_VALUES, scriptCode, scriptExtensions, USCRIPT_COMMON, USCRIPT_HAN, USCRIPT_HIRAGANA, USCRIPT_INHERITED, USCRIPT_KATAKANA,
  USCRIPT_LATIN, USCRIPT_UNKNOWN,
} from '../src/script-data.ts';
import { UNICODE_VERSION } from '../src/linebreak-data.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ucd = (f: string): string => readFileSync(join(root, 'vendor/unicode/16.0.0', f), 'utf8');

/** A UCD file as a map from code point to its first field. */
function listed(file: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const raw of ucd(file).split('\n')) {
    const m = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*([^#;]+)/.exec(raw);
    if (m === null) continue;
    const a = parseInt(m[1] as string, 16);
    const b = m[2] === undefined ? a : parseInt(m[2], 16);
    for (let cp = a; cp <= b; cp++) out.set(cp, (m[3] as string).trim());
  }
  return out;
}

const longToTag = new Map<string, string>();
for (const raw of ucd('PropertyValueAliases.txt').split('\n')) {
  const f = raw.replace(/#.*/, '').split(';').map((s) => s.trim());
  if (f[0] === 'sc' && f.length >= 3) longToTag.set(f[2] as string, f[1] as string);
}
const tagOf = (code: number): string => SCRIPT_TAGS[code] as string;

describe('script-data.ts: Unicode 16.0.0 Script and Script_Extensions as ICU 77 UScriptCode', () => {
  const sc = listed('Scripts.txt');
  const scx = listed('ScriptExtensions.txt');

  it('is pinned to the vendored Unicode 16.0.0 files, the version of the line-break data', () => {
    expect(SCRIPT_UNICODE_VERSION).toBe('16.0.0');
    expect(SCRIPT_UNICODE_VERSION).toBe(UNICODE_VERSION);
    const sha = (f: string): string => createHash('sha256').update(readFileSync(join(root, f))).digest('hex');
    expect(sha('vendor/unicode/16.0.0/Scripts.txt')).toBe('9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039');
    expect(sha('vendor/unicode/16.0.0/ScriptExtensions.txt')).toBe('049117ce26b9769fe2749b06eef51a50a89faef4a97764dd2d81daa715980700');
    expect(ucd('Scripts.txt').split('\n')[0]).toBe('# Scripts-16.0.0.txt');
    expect(ucd('ScriptExtensions.txt').split('\n')[0]).toBe('# ScriptExtensions-16.0.0.txt');
  });

  it('has sorted runs from U+0000 and ICU 77\'s codes for the scripts the segmenter names', () => {
    expect(SCRIPT_STARTS[0]).toBe(0);
    expect(SCRIPT_STARTS.length).toBe(SCRIPT_VALUES.length);
    for (let i = 1; i < SCRIPT_STARTS.length; i++) expect((SCRIPT_STARTS[i] as number) > (SCRIPT_STARTS[i - 1] as number)).toBe(true);
    expect([USCRIPT_COMMON, USCRIPT_INHERITED, USCRIPT_HAN, USCRIPT_HIRAGANA, USCRIPT_KATAKANA, USCRIPT_LATIN, USCRIPT_UNKNOWN]).toEqual([0, 1, 17, 20, 22, 25, 103]);
    expect([0, 1, 17, 20, 22, 25, 103].map(tagOf)).toEqual(['Zyyy', 'Zinh', 'Hani', 'Hira', 'Kana', 'Latn', 'Zzzz']);
  });

  it('gives every code point its Scripts.txt value, and Unknown where the file lists none', () => {
    let wrong = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const name = sc.get(cp);
      if (tagOf(scriptCode(cp)) !== (name === undefined ? 'Zzzz' : longToTag.get(name))) wrong++;
    }
    expect(wrong).toBe(0);
  });

  it('gives every code point its ScriptExtensions.txt set in ascending UScriptCode order, or its Script alone', () => {
    let wrong = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      const got = scriptExtensions(cp);
      for (let i = 1; i < got.length; i++) if ((got[i] as number) <= (got[i - 1] as number)) wrong++;
      const want = scx.get(cp);
      const tags = got.map(tagOf).sort();
      if (want === undefined ? tags.join(' ') !== tagOf(scriptCode(cp)) : tags.join(' ') !== want.split(/\s+/).sort().join(' ')) wrong++;
    }
    expect(wrong).toBe(0);
  });

  // Node 24's V8 carries ICU 78 (Unicode 17.0), which changed some Script_Extensions (U+0320) and Extended_Pictographic values;
  // those two are checked against the vendored 16.0.0 files only.
  it('agrees with V8\'s ICU on Script for every code point Unicode 16.0.0 lists', () => {
    const cache = new Map<string, RegExp>();
    const re = (p: string): RegExp => {
      let r = cache.get(p);
      if (r === undefined) {
        r = new RegExp(`^\\p{${p}}$`, 'u');
        cache.set(p, r);
      }
      return r;
    };
    const wrong: string[] = [];
    for (const cp of sc.keys()) {
      const ch = String.fromCodePoint(cp);
      if (!re(`Script=${tagOf(scriptCode(cp))}`).test(ch)) wrong.push(`U+${cp.toString(16)} sc`);
    }
    expect(wrong).toEqual([]);
  });

  it('agrees with V8 on marks, Ps and Pe, and with the vendored files on brackets and Extended_Pictographic, for every listed code point', () => {
    const brackets = listed('BidiBrackets.txt');
    const emoji = new Set<number>();
    for (const raw of ucd('emoji-data.txt').split('\n')) {
      const m = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*Extended_Pictographic/.exec(raw);
      if (m === null) continue;
      const a = parseInt(m[1] as string, 16);
      for (let cp = a; cp <= (m[2] === undefined ? a : parseInt(m[2], 16)); cp++) emoji.add(cp);
    }
    const wrong: string[] = [];
    for (const cp of sc.keys()) {
      const ch = String.fromCodePoint(cp);
      if (isMark(cp) !== /^\p{M}$/u.test(ch)) wrong.push(`U+${cp.toString(16)} M`);
      if (isOpenPunctuation(cp) !== /^\p{Ps}$/u.test(ch)) wrong.push(`U+${cp.toString(16)} Ps`);
      if (isClosePunctuation(cp) !== /^\p{Pe}$/u.test(ch)) wrong.push(`U+${cp.toString(16)} Pe`);
      if (isExtendedPictographic(cp) !== emoji.has(cp)) wrong.push(`U+${cp.toString(16)} ExtPict`);
      const b = bracketIndex(cp);
      const want = brackets.get(cp);
      if ((b >= 0) !== (want !== undefined) || (b >= 0 && BRACKET_PAIRS[b] !== parseInt(want as string, 16))) wrong.push(`U+${cp.toString(16)} bracket`);
    }
    expect(wrong).toEqual([]);
    expect(BRACKET_OPEN[bracketIndex(0x300c)]).toBe(1);
    expect(BRACKET_OPEN[bracketIndex(0x300d)]).toBe(0);
  });
});

describe('isLatinText (R4): every code point Latin, Common or Inherited', () => {
  it('accepts Latin letters, punctuation, digits, spaces, combining marks and Common symbols', () => {
    for (const t of ['The quick brown fox', 'Ünïcödé façade — “quoted” 1,234.56 $19.99!', 'é', '­ ‐', '', '11.11 1/4 ❚']) expect(isLatinText(t), t).toBe(true);
  });

  it('refuses any code point of another script, and unassigned and lone surrogate code points', () => {
    for (const t of ['日本語', 'abc 日', 'Ωmega', 'Привет', 'שלום', 'abc͸', 'a\ud800b', 'ア']) expect(isLatinText(t), t).toBe(false);
  });

  it('reads the Script property only: a Common code point whose Script_Extensions exclude Latin is accepted', () => {
    // U+30FC (Common; Script_Extensions Hira Kana) and U+0964 (Common; Script_Extensions include Deva and Beng). Blink's
    // ScriptRunIterator gives them their own runs inside Latin text; notes/T082-txt1s.md records this for TXT1a-1.
    expect(isLatinText('abc ー def')).toBe(true);
    expect(isLatinText('abc । def')).toBe(true);
    expect(scriptExtensions(0x30fc).map(tagOf)).toEqual(['Hira', 'Kana']);
  });

  it('classifies the gate corpus: every en paragraph is in scope, every Japanese one is not', () => {
    const ref = JSON.parse(readFileSync(join(root, 'docs/research/text-spike/gate/chrome-145.json'), 'utf8')) as { paragraphs: Record<string, string> };
    const scope = Object.fromEntries(Object.entries(ref.paragraphs).map(([k, t]) => [k, isLatinText(t)]));
    expect(scope).toEqual({
      'en/prose': true, 'en/longwords': true, 'en/punct': true, 'en/hyphen': true, 'en/shy': true, 'en/kernlig': true, 'en/numbers': true, 'en/nbsp': true,
      'ja/ja': false, 'ja/jamix': false, 'ja/jakinsoku': false, 'ja/prose': true,
    });
  });
});
