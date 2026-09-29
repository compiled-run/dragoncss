// The pinned Script table (script-data.ts, R4 of docs/goals/milestone-2-proof/notes/T056-txt1a-spec.md) against the vendored
// Unicode 16.0.0 Scripts.txt, read here independently of the generator, and against V8's ICU for every listed code point.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isLatinText, SCRIPT_COMMON, SCRIPT_INHERITED, SCRIPT_LATIN, SCRIPT_NAMES, SCRIPT_STARTS, SCRIPT_UNICODE_VERSION, SCRIPT_UNKNOWN, SCRIPT_VALUES, scriptCode } from '../src/script-data.ts';
import { UNICODE_VERSION } from '../src/linebreak-data.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scriptsTxt = readFileSync(join(root, 'vendor/unicode/16.0.0/Scripts.txt'));

/** Scripts.txt as a map from code point to script name. */
function listed(): Map<number, string> {
  const out = new Map<number, string>();
  for (const raw of scriptsTxt.toString('utf8').split('\n')) {
    const m = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*(\w+)/.exec(raw);
    if (m === null) continue;
    const a = parseInt(m[1] as string, 16);
    const b = m[2] === undefined ? a : parseInt(m[2], 16);
    for (let cp = a; cp <= b; cp++) out.set(cp, m[3] as string);
  }
  return out;
}

describe('script-data.ts: the Unicode 16.0.0 Script property', () => {
  const byCp = listed();

  it('is pinned to the vendored Scripts.txt of Unicode 16.0.0, the version of the line-break data', () => {
    expect(SCRIPT_UNICODE_VERSION).toBe('16.0.0');
    expect(SCRIPT_UNICODE_VERSION).toBe(UNICODE_VERSION);
    expect(createHash('sha256').update(scriptsTxt).digest('hex')).toBe('9e88f0a677df47311106340be8ede2ecdacd9c1c931831218d2be6d5508e0039');
    expect(scriptsTxt.toString('utf8').split('\n')[0]).toBe('# Scripts-16.0.0.txt');
  });

  it('has sorted runs from U+0000 and the fixed codes the Latin scope reads', () => {
    expect(SCRIPT_STARTS[0]).toBe(0);
    expect(SCRIPT_STARTS.length).toBe(SCRIPT_VALUES.length);
    for (let i = 1; i < SCRIPT_STARTS.length; i++) {
      expect((SCRIPT_STARTS[i] as number) > (SCRIPT_STARTS[i - 1] as number)).toBe(true);
      expect(SCRIPT_VALUES[i]).not.toBe(SCRIPT_VALUES[i - 1]);
    }
    expect([SCRIPT_UNKNOWN, SCRIPT_COMMON, SCRIPT_INHERITED, SCRIPT_LATIN].map((c) => SCRIPT_NAMES[c])).toEqual(['Unknown', 'Common', 'Inherited', 'Latin']);
  });

  it('gives every code point its Scripts.txt value, and Unknown where the file lists none', () => {
    let wrong = 0;
    for (let cp = 0; cp <= 0x10ffff; cp++) if (SCRIPT_NAMES[scriptCode(cp)] !== (byCp.get(cp) ?? 'Unknown')) wrong++;
    expect(wrong).toBe(0);
    expect(new Set(byCp.values()).size + 1).toBe(SCRIPT_NAMES.length);
  });

  it('agrees with V8\'s ICU on every code point Unicode 16.0.0 lists', () => {
    const re = new Map(SCRIPT_NAMES.map((n) => [n, new RegExp(`^\\p{Script=${n}}$`, 'u')]));
    const wrong: string[] = [];
    for (const [cp, name] of byCp) if (!(re.get(name) as RegExp).test(String.fromCodePoint(cp))) wrong.push(`U+${cp.toString(16)} ${name}`);
    expect(wrong).toEqual([]);
  });
});

describe('isLatinText (R4): every code point Latin, Common or Inherited', () => {
  it('accepts Latin letters, punctuation, digits, spaces, combining marks and Common symbols', () => {
    for (const t of ['The quick brown fox', 'Ünïcödé façade — “quoted” 1,234.56 $19.99!', 'é', '­ ‐', '', '11.11 1/4 ❚']) expect(isLatinText(t), t).toBe(true);
  });

  it('refuses any code point of another script, and unassigned and lone surrogate code points', () => {
    for (const t of ['日本語', 'abc 日', 'Ωmega', 'Привет', 'שלום', 'abc͸', 'a\ud800b', 'ア']) expect(isLatinText(t), t).toBe(false);
  });

  it('reads the Script property only: a Common code point whose Script_Extensions exclude Latin is accepted', () => {
    // U+30FC (Common; Script_Extensions Hira Kana) and U+0964 (Common; Script_Extensions include Deva and Beng). Blink's
    // ScriptRunIterator gives them their own runs inside Latin text; notes/T082-txt1s.md records this for TXT1a-1.
    expect(isLatinText('abc ー def')).toBe(true);
    expect(isLatinText('abc । def')).toBe(true);
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
