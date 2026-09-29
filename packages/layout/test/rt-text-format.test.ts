// DTXT-0 (docs/goals/milestone-2-proof/notes/T068-dtxt-spec.md DT-1): templates, the typed integer guard, enumeration and
// repertoire facts. '{m}:{s:02}' must equal Markless formatTime(60m + s) on all 60,000 strings (rt-vectors/text-format), and the
// planted faults padDropped, minutesWrapped and textDomainUnchecked must each flip a vector.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { IntDomain, TextFormatFaults, TextTemplate } from '../src/rt-text-format.ts';
import { codePointCount, domainSize, enumerateTexts, formatText, guardValue, MAX_SLOT_STRINGS, NO_TEXT_FORMAT_FAULTS, parseTemplate, repertoireOf, widthMemoKey } from '../src/rt-text-format.ts';
import { scriptCode, USCRIPT_COMMON, USCRIPT_LATIN } from '../src/script-data.ts';

type FormatTimeVectors = {
  readonly source: { readonly repo: string; readonly file: string; readonly sha256: string; readonly functionSha256: string; readonly function: string };
  readonly template: string;
  readonly inputs: readonly IntDomain[];
  readonly strings: readonly string[];
};
type GuardVectors = {
  readonly template: string;
  readonly inputs: readonly IntDomain[];
  readonly records: ReadonlyArray<{ readonly values: readonly (number | string)[]; readonly text?: string; readonly field?: string; readonly reason?: string }>;
};
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(`../rt-vectors/text-format/${name}`, import.meta.url), 'utf8')) as T;
const vectors = read<FormatTimeVectors>('format-time.json');
const guard = read<GuardVectors>('guard.json');
const decode = (v: number | string): number => (typeof v === 'number' ? v : Number(v));

const DEMO: readonly IntDomain[] = [{ id: 'm', min: 0, max: 999 }, { id: 's', min: 0, max: 59 }];
function demo(): TextTemplate {
  const r = parseTemplate('{m}:{s:02}', DEMO);
  if (!r.ok) throw new Error(r.reason);
  return r.template;
}
const faulty = (k: keyof TextFormatFaults): TextFormatFaults => ({ ...NO_TEXT_FORMAT_FAULTS, [k]: true });

describe('DTXT-0: templates', () => {
  it("parses '{m}:{s:02}' into a field, a literal and a padded field", () => {
    expect(demo().parts).toEqual([{ literal: '', field: 0, pad: 0 }, { literal: ':', field: -1, pad: 0 }, { literal: '', field: 1, pad: 2 }]);
    const r = parseTemplate('t={a:09} of {b}s', [{ id: 'b', min: 1, max: 3 }, { id: 'a', min: 0, max: 7 }]);
    expect(r.ok && r.template.parts).toEqual([
      { literal: 't=', field: -1, pad: 0 }, { literal: '', field: 1, pad: 9 }, { literal: ' of ', field: -1, pad: 0 }, { literal: '', field: 0, pad: 0 }, { literal: 's', field: -1, pad: 0 },
    ]);
  });

  it('refuses malformed templates at the code point offset of the fault', () => {
    const cases: ReadonlyArray<readonly [string, number, string]> = [
      ['{m}:{s:2}', 7, ':0N'],
      ['{m}:{s:00}', 8, ':0N'],
      ['{m}:{s:002}', 8, ':0N'],
      ['{m}:{s:023}', 9, 'expected }'],
      ['{m}:{s:0x}', 8, ':0N'],
      ['{m}:{s', 4, 'not closed'],
      ['{m}:s}', 5, 'unmatched }'],
      ['{m}:{t}{s}', 4, 'field t has no input'],
      ['{m}:{m}{s}', 4, 'appears twice'],
      ['{m}:{}{s}', 4, 'the id must be'],
      ['{m}:{1s}{s}', 4, 'the id must be'],
      ['😀{m}:{s:02}}', 11, 'unmatched }'],
      ['{m}', -1, 'input s is not used'],
    ];
    for (const [t, offset, reason] of cases) {
      const r = parseTemplate(t, DEMO);
      expect(r.ok, t).toBe(false);
      if (!r.ok) {
        expect(r.offset, t).toBe(offset);
        expect(r.reason, t).toContain(reason);
      }
    }
  });

  it('refuses domains that are not finite non-negative safe integer ranges, duplicates and static text', () => {
    const bad: ReadonlyArray<readonly [IntDomain, string]> = [
      [{ id: 'm', min: Number.NaN, max: 5 }, 'integers'],
      [{ id: 'm', min: 0, max: Infinity }, 'integers'],
      [{ id: 'm', min: 0.5, max: 5 }, 'integers'],
      [{ id: 'm', min: -1, max: 5 }, 'negative'],
      [{ id: 'm', min: 6, max: 5 }, 'above max'],
      [{ id: 'm', min: 0, max: 2 ** 53 }, 'above'],
      [{ id: 'm-x', min: 0, max: 5 }, 'the id must be'],
    ];
    for (const [d, reason] of bad) {
      const r = parseTemplate('{m}', [d]);
      expect(r.ok === false && r.offset === -1 && r.reason.includes(reason), JSON.stringify(d)).toBe(true);
    }
    expect(parseTemplate('{m}', [{ id: 'm', min: 0, max: 1 }, { id: 'm', min: 0, max: 1 }])).toMatchObject({ ok: false, reason: 'input m is declared twice' });
    expect(parseTemplate('0:00', [])).toMatchObject({ ok: false, offset: -1 });
  });
});

describe('DTXT-0: the typed input guard', () => {
  it('refuses NaN, infinities, fractions and out-of-domain values, naming the input', () => {
    const d: IntDomain = { id: 's', min: 0, max: 59 };
    expect(guardValue(d, Number.NaN)).toEqual({ ok: false, field: 's', reason: 's: NaN is not an integer' });
    expect(guardValue(d, Infinity)).toEqual({ ok: false, field: 's', reason: 's: Infinity is not finite' });
    expect(guardValue(d, -Infinity)).toEqual({ ok: false, field: 's', reason: 's: -Infinity is not finite' });
    expect(guardValue(d, 0.5)).toEqual({ ok: false, field: 's', reason: 's: 0.5 is not an integer' });
    expect(guardValue(d, -1)).toEqual({ ok: false, field: 's', reason: 's: -1 is outside [0, 59]' });
    expect(guardValue(d, 60)).toEqual({ ok: false, field: 's', reason: 's: 60 is outside [0, 59]' });
    expect(guardValue(d, 0)).toEqual({ ok: true });
    expect(guardValue(d, -0)).toEqual({ ok: true });
    expect(guardValue(d, 59)).toEqual({ ok: true });
    expect(formatText(demo(), [1], NO_TEXT_FORMAT_FAULTS)).toEqual({ ok: false, field: '', reason: 'expected 2 values, got 1' });
    expect(formatText(demo(), [-0, -0], NO_TEXT_FORMAT_FAULTS)).toEqual({ ok: true, text: '0:00' });
  });

  it('reproduces every guard vector (rt-vectors/text-format/guard.json)', () => {
    const p = parseTemplate(guard.template, guard.inputs);
    if (!p.ok) throw new Error(p.reason);
    expect(guard.records.length).toBe(30);
    expect(guard.records.filter((r) => r.text === undefined).length).toBeGreaterThan(15);
    for (const r of guard.records) {
      const got = formatText(p.template, r.values.map(decode), NO_TEXT_FORMAT_FAULTS);
      expect(got, JSON.stringify(r.values)).toEqual(r.text === undefined ? { ok: false, field: r.field, reason: r.reason } : { ok: true, text: r.text });
    }
  });
});

describe("DTXT-0: '{m}:{s:02}' against Markless formatTime", () => {
  const formatTime = new Function(`${stripTypeScriptTypes(vectors.source.function)}\nreturn formatTime;`)() as (t: number) => string;

  it('the recorded source is the pinned Markless formatTime: file and function digests are literals here', () => {
    // Markless is not in this repo: capture-dtxt-widths.ts --check reads the file and its digest. Pinning both here means
    // replacing the source, the strings and the digests together still has to change this test.
    expect(vectors.source.file).toBe('demos/music-player-ssr/src/youtube-controller.ts');
    expect(vectors.source.sha256).toBe('8fd07911a5d78c0caab2ce2c8ca3155815034b79fb15f2056381aff6e3247e6f');
    expect(vectors.source.functionSha256).toBe('6fc2c8b4592c4c9947d83019ae35b31f704390ce70df8581b5578d8c47f3efb8');
    expect(createHash('sha256').update(vectors.source.function).digest('hex')).toBe(vectors.source.functionSha256);
  });

  it('the vectors are Markless formatTime(60m + s), recomputed from the recorded source, 60,000 strings', () => {
    expect(vectors.template).toBe('{m}:{s:02}');
    expect(vectors.inputs).toEqual(DEMO);
    expect(vectors.strings.length).toBe(60000);
    const wrong: number[] = [];
    for (let i = 0; i < 60000; i++) if (formatTime(i) !== vectors.strings[i]) wrong.push(i);
    expect(wrong).toEqual([]);
  });

  it('formatText and enumerateTexts equal every vector exactly', () => {
    const t = demo();
    const wrong: string[] = [];
    for (let m = 0; m <= 999; m++) {
      for (let s = 0; s <= 59; s++) {
        const r = formatText(t, [m, s], NO_TEXT_FORMAT_FAULTS);
        if (!r.ok || r.text !== vectors.strings[60 * m + s]) wrong.push(`${m},${s}`);
      }
    }
    expect(wrong).toEqual([]);
    const all = enumerateTexts(t, NO_TEXT_FORMAT_FAULTS);
    expect(all.ok && all.texts).toEqual(vectors.strings);
  });

  it('enumerates at most 100,000 strings per slot', () => {
    expect(domainSize(DEMO)).toBe(60000);
    const at = parseTemplate('{a}{b}', [{ id: 'a', min: 0, max: 99 }, { id: 'b', min: 1, max: 1000 }]);
    const over = parseTemplate('{a}{b}', [{ id: 'a', min: 0, max: 99 }, { id: 'b', min: 0, max: 1000 }]);
    const huge = parseTemplate('{a}{b}{c}', [{ id: 'a', min: 0, max: 2 ** 52 }, { id: 'b', min: 0, max: 2 ** 52 }, { id: 'c', min: 0, max: 2 ** 52 }]);
    if (!at.ok || !over.ok || !huge.ok) throw new Error('parse');
    expect(domainSize(at.template.domains)).toBe(MAX_SLOT_STRINGS);
    const e = enumerateTexts(at.template, NO_TEXT_FORMAT_FAULTS);
    expect(e.ok && e.texts.length).toBe(MAX_SLOT_STRINGS);
    expect(domainSize(over.template.domains)).toBe(MAX_SLOT_STRINGS + 1);
    expect(enumerateTexts(over.template, NO_TEXT_FORMAT_FAULTS)).toMatchObject({ ok: false });
    expect(enumerateTexts(huge.template, NO_TEXT_FORMAT_FAULTS)).toMatchObject({ ok: false });
  });
});

describe('DTXT-0: repertoire facts', () => {
  it("'{m}:{s:02}': digits and colon only, no whitespace, no bidi controls, Script Common only", () => {
    const r = repertoireOf(vectors.strings);
    expect(r.codePoints).toEqual([0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a]);
    expect(r.whitespace).toEqual([]);
    expect(r.bidiControls).toEqual([]);
    expect(r.scripts).toEqual([USCRIPT_COMMON]);
    expect(r.latinOnly).toBe(true);
  });

  it('finds whitespace, bidi controls and non-Latin scripts in literals', () => {
    const r = repertoireOf(['1 \u062f', '2\u200f', '3\u2066x\u2069', '\u00e9\u00a0']);
    expect(r.whitespace).toEqual([0x20, 0xa0]);
    expect(r.bidiControls).toEqual([0x200f, 0x2066, 0x2069]);
    expect(r.scripts).toEqual([USCRIPT_COMMON, USCRIPT_LATIN, scriptCode(0x62f)].sort((a, b) => a - b));
    expect(r.latinOnly).toBe(false);
    expect(repertoireOf(['abc', 'é1']).latinOnly).toBe(true);
  });
});

describe('DTXT-0: planted faults', () => {
  const flips = (faults: TextFormatFaults): number => {
    const e = enumerateTexts(demo(), faults);
    if (!e.ok) return -1;
    return e.texts.filter((t, i) => t !== vectors.strings[i]).length;
  };

  it('padDropped flips the vectors (every s below 10)', () => {
    expect(flips(faulty('padDropped'))).toBe(10000);
  });

  it('minutesWrapped flips the vectors (every m from 60)', () => {
    expect(flips(faulty('minutesWrapped'))).toBe(940 * 60);
  });

  it('textDomainUnchecked flips the guard vectors (every refusal is formatted instead)', () => {
    const p = parseTemplate(guard.template, guard.inputs);
    if (!p.ok) throw new Error(p.reason);
    const refused = guard.records.filter((r) => r.text === undefined);
    const flipped = refused.filter((r) => formatText(p.template, r.values.map(decode), faulty('textDomainUnchecked')).ok);
    expect(flipped.length).toBe(refused.length);
    expect(formatText(p.template, [5, 60], faulty('textDomainUnchecked'))).toEqual({ ok: true, text: '5:60' });
  });

  it('widthCacheByLength keys the memo by code point count (the width oracle catches it on Dragon Sans)', () => {
    expect(widthMemoKey('f', 16, '1:11', NO_TEXT_FORMAT_FAULTS)).not.toBe(widthMemoKey('f', 16, '0:00', NO_TEXT_FORMAT_FAULTS));
    expect(widthMemoKey('f', 16, '1:11', faulty('widthCacheByLength'))).toBe(widthMemoKey('f', 16, '0:00', faulty('widthCacheByLength')));
    expect(widthMemoKey('f', 16, '0:00', NO_TEXT_FORMAT_FAULTS)).not.toBe(widthMemoKey('f', 14, '0:00', NO_TEXT_FORMAT_FAULTS));
    expect(widthMemoKey('f', 16, '0:00', NO_TEXT_FORMAT_FAULTS)).not.toBe(widthMemoKey('g', 16, '0:00', NO_TEXT_FORMAT_FAULTS));
    expect(codePointCount('😀:00')).toBe(4);
  });
});
