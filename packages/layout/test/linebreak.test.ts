// Oracle tests for Dragon's line breaking (docs/decisions.md, "Text strategy"): break opportunities (linebreak.ts) against
// Chrome 145's, and greedy fitting (linefit.ts) with macOS Core Text advances against Chrome 145's lines.
// Fixtures: fixtures/linebreak/chrome145-spike.json (the 620-case real-font spike corpus) and chrome145-rules.json (42 short
// texts aimed at single rules). Both are regenerated with the tools in fixtures/linebreak/capture.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FitFaults } from '../src/linefit.ts';
import { fitLines, fitLinesWith, fitsAvailable, lineBreaks, NO_FIT_FAULTS } from '../src/linefit.ts';
import type { BreakOpportunity, LineBreakFaults, LineBreakStyle } from '../src/linebreak.ts';
import { isEastAsian, lineBreakClass, lineBreakOpportunities, lineBreakOpportunitiesWith, NO_LINE_BREAK_FAULTS, uax14BreakAllowed } from '../src/linebreak.ts';
import { LB_CLASS_NAMES, LB_STARTS, LB_VALUES, UNICODE_VERSION } from '../src/linebreak-data.ts';
import { fromCssPx } from '../src/units.ts';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'linebreak');

type SpikeText = { key: string; lang: string; text: string; fonts: string[]; opps: number[] };
type SpikeCase = { id: string; font: string; key: string; advances: string; width: number; breaks: number[]; breaksSpaceAll?: number[] };
type Spike = { texts: SpikeText[]; cases: SpikeCase[]; advances: Record<string, { hyphen: number; advances: number[] }> };
type RuleText = { id: string; lang: string; text: string; opps: number[] };

const spike = JSON.parse(readFileSync(join(dir, 'chrome145-spike.json'), 'utf8')) as Spike;
const rules = JSON.parse(readFileSync(join(dir, 'chrome145-rules.json'), 'utf8')) as RuleText[];

const STYLE: LineBreakStyle = {
  whiteSpaceCollapse: 'collapse',
  textWrapMode: 'wrap',
  wordBreak: 'normal',
  overflowWrap: 'normal',
  lineBreak: 'auto',
  hyphens: 'manual',
  languageRules: 'cj-ideographic',
};

/** Code points of a string, and the map from UTF-16 index to code point index (Chrome reports UTF-16 indices). */
function codePoints(text: string): { cps: number[]; fromUtf16: Map<number, number> } {
  const cps: number[] = [];
  const fromUtf16 = new Map<number, number>();
  let u = 0;
  for (const ch of text) {
    fromUtf16.set(u, cps.length);
    cps.push(ch.codePointAt(0) as number);
    u += ch.length;
  }
  fromUtf16.set(u, cps.length);
  return { cps, fromUtf16 };
}

function toCp(fromUtf16: Map<number, number>, xs: readonly number[]): number[] {
  return xs.map((x) => {
    const c = fromUtf16.get(x);
    if (c === undefined) throw new Error(`UTF-16 index ${x} is inside a surrogate pair`);
    return c;
  });
}

function opportunities(cps: readonly number[], faults: LineBreakFaults): BreakOpportunity[] {
  const r = lineBreakOpportunitiesWith(cps, STYLE, faults);
  if (!r.ok) throw new Error(r.reason);
  return [...r.opportunities];
}

const textByKey = new Map(spike.texts.map((t) => [t.key, t]));

/** The spike's reporting groups: static Latin fonts, Inter variable, Noto Sans JP on the Japanese texts, and on English prose. */
function group(c: SpikeCase): string {
  if (c.font === 'NotoSansJP') return c.key === 'ja|prose' ? 'jpFontLatinProse' : 'japanese';
  return c.font === 'InterVF' ? 'interVariable' : 'latinStatic';
}

function tally(rows: readonly { group: string; ok: boolean }[]): Record<string, string> {
  const out: Record<string, [number, number]> = {};
  for (const r of rows) {
    const t = out[r.group] ?? [0, 0];
    t[1]++;
    if (r.ok) t[0]++;
    out[r.group] = t;
  }
  return Object.fromEntries(Object.entries(out).sort().map(([k, [a, b]]) => [k, `${a}/${b}`]));
}

/** Opportunity match per spike case (each case uses its paragraph's opportunity set). */
function spikeOpportunityRows(faults: LineBreakFaults): { id: string; group: string; ok: boolean }[] {
  const cache = new Map<string, boolean>();
  return spike.cases.map((c) => {
    let ok = cache.get(c.key);
    if (ok === undefined) {
      const t = textByKey.get(c.key) as SpikeText;
      const { cps, fromUtf16 } = codePoints(t.text);
      ok = JSON.stringify(opportunities(cps, faults).map((o) => o.position)) === JSON.stringify(toCp(fromUtf16, t.opps));
      cache.set(c.key, ok);
    }
    return { id: c.id, group: group(c), ok };
  });
}

function ruleOpportunityRows(faults: LineBreakFaults): { id: string; group: string; ok: boolean }[] {
  return rules.map((t) => {
    const { cps, fromUtf16 } = codePoints(t.text);
    const ok = JSON.stringify(opportunities(cps, faults).map((o) => o.position)) === JSON.stringify(toCp(fromUtf16, t.opps));
    return { id: t.id, group: t.id.split('/')[0] as string, ok };
  });
}

/** Greedy fit per spike case against Chrome's lines (Japanese against text-spacing-trim: space-all unless `trimmed`). */
function spikeFitRows(lbFaults: LineBreakFaults, fitFaults: FitFaults, trimmed: boolean): { id: string; group: string; ok: boolean }[] {
  return spike.cases.map((c) => {
    const t = textByKey.get(c.key) as SpikeText;
    const { cps, fromUtf16 } = codePoints(t.text);
    const adv = spike.advances[c.advances] as { hyphen: number; advances: number[] };
    // Core Text advances are per UTF-16 index; the corpus is all BMP, so they are per code point.
    if (adv.advances.length !== cps.length) throw new Error(`${c.id}: advances are not per code point`);
    const r = fitLinesWith(cps, adv.advances, opportunities(cps, lbFaults), fromCssPx(c.width), adv.hyphen, fitFaults);
    if (!r.ok) throw new Error(r.reason);
    const expected = c.breaksSpaceAll !== undefined && !trimmed ? c.breaksSpaceAll : c.breaks;
    return { id: c.id, group: group(c), ok: JSON.stringify(lineBreaks(r.lines)) === JSON.stringify(toCp(fromUtf16, expected)) };
  });
}

const failures = (rows: readonly { id: string; ok: boolean }[]): string[] => rows.filter((r) => !r.ok).map((r) => r.id);

describe('pinned line-break data', () => {
  it('is Unicode 16.0.0 (ICU 77, Chrome 145), with a total range table', () => {
    expect(UNICODE_VERSION).toBe('16.0.0');
    expect(LB_STARTS[0]).toBe(0);
    expect(LB_STARTS.length).toBe(LB_VALUES.length);
    for (let i = 1; i < LB_STARTS.length; i++) expect((LB_STARTS[i] as number) > (LB_STARTS[i - 1] as number)).toBe(true);
  });

  it('classes the characters the corpus depends on', () => {
    const name = (cp: number): string => LB_CLASS_NAMES[lineBreakClass(cp)] as string;
    expect([0x61, 0x2d, 0x2f, 0x20, 0xa0, 0xad, 0x200b, 0x2060, 0x201c, 0x201d, 0x2019, 0x3000, 0x3063, 0x30fc, 0x3002, 0x2026, 0x2014, 0xd7].map(name))
      .toEqual(['AL', 'HY', 'SY', 'SP', 'GL', 'BA', 'ZW', 'WJ', 'QU_PI', 'QU_PF', 'QU_PF', 'BA', 'CJ', 'CJ', 'CL', 'IN', 'B2', 'AI']);
    expect(name(0x10ffff)).toBe('XX');
    expect([0x3042, 0xff01, 0x61, 0xd7].map(isEastAsian)).toEqual([true, true, false, false]);
  });
});

describe('UAX #14 core', () => {
  it('resolves CJ to NS by default and to ID for Chrome (LB1)', () => {
    const text = [0x3042, 0x3063, 0x3068];
    expect(uax14BreakAllowed(text, false)).toEqual([false, false, true, true]);
    expect(uax14BreakAllowed(text, true)).toEqual([false, true, true, true]);
  });

  it('keeps combining sequences, emoji modifiers and ZWJ sequences whole (LB9, LB8a, LB30b)', () => {
    expect(uax14BreakAllowed([0x61, 0x301, 0x28], false)).toEqual([false, false, false, true]);
    expect(uax14BreakAllowed([0x1f44d, 0x1f3fd, 0x1f44d], false)).toEqual([false, false, true, true]);
    expect(uax14BreakAllowed([0x1f468, 0x200d, 0x1f469], false)).toEqual([false, false, false, true]);
  });
});

describe('break opportunities against Chrome 145', () => {
  it('match Chrome for every spike case (620), by group', () => {
    const rows = spikeOpportunityRows(NO_LINE_BREAK_FAULTS);
    expect(failures(rows)).toEqual([]);
    expect(tally(rows)).toEqual({ interVariable: '60/60', japanese: '60/60', jpFontLatinProse: '20/20', latinStatic: '480/480' });
  });

  it('match Chrome for every spike paragraph, and each paragraph set is the same for every font', () => {
    const rows = spike.texts.map((t) => {
      const { cps, fromUtf16 } = codePoints(t.text);
      return { group: t.key, ok: JSON.stringify(opportunities(cps, NO_LINE_BREAK_FAULTS).map((o) => o.position)) === JSON.stringify(toCp(fromUtf16, t.opps)) };
    });
    expect(rows.every((r) => r.ok)).toBe(true);
    expect(rows.length).toBe(12);
    expect(spike.texts.reduce((n, t) => n + t.fonts.length, 0)).toBe(31);
  });

  it('match Chrome for every rule text (42)', () => {
    const rows = ruleOpportunityRows(NO_LINE_BREAK_FAULTS);
    expect(failures(rows)).toEqual([]);
    expect(rows.length).toBe(42);
  });

  it('mark the breaks after U+00AD as soft-hyphen breaks, and only those', () => {
    const t = textByKey.get('en|shy') as SpikeText;
    const { cps } = codePoints(t.text);
    const opps = opportunities(cps, NO_LINE_BREAK_FAULTS);
    const shy = opps.filter((o) => o.kind === 'soft-hyphen');
    expect(shy.length).toBe(cps.filter((c) => c === 0xad).length);
    expect(opps.every((o) => (o.kind === 'soft-hyphen') === (cps[o.position - 1] === 0xad))).toBe(true);
  });

  it('keep NBSP-joined words together, and break after a space before an NBSP', () => {
    const { cps } = codePoints('Mr.\u00A0Smith a \u00A0b');
    expect(opportunities(cps, NO_LINE_BREAK_FAULTS).map((o) => o.position)).toEqual([10, 12]);
  });

  it('give no opportunities for text-wrap-mode: nowrap', () => {
    const r = lineBreakOpportunities(codePoints('a b c').cps, { ...STYLE, textWrapMode: 'nowrap' });
    expect(r).toEqual({ ok: true, opportunities: [] });
  });

  it('refuse what the engine does not support, explicitly', () => {
    const reason = (text: string, style: LineBreakStyle): string => {
      const r = lineBreakOpportunities(codePoints(text).cps, style);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason('a b', { ...STYLE, wordBreak: 'break-all' })).toMatch(/word-break: break-all/);
    expect(reason('a b', { ...STYLE, overflowWrap: 'anywhere' })).toMatch(/overflow-wrap: anywhere/);
    expect(reason('a b', { ...STYLE, whiteSpaceCollapse: 'preserve' })).toMatch(/white-space-collapse: preserve/);
    expect(reason('a b', { ...STYLE, lineBreak: 'strict' })).toMatch(/line-break: strict/);
    expect(reason('a b', { ...STYLE, hyphens: 'auto' })).toMatch(/hyphens: auto/);
    expect(reason('a b', { ...STYLE, languageRules: 'chinese' })).toMatch(/line_cj/);
    expect(reason('a\tb', STYLE)).toMatch(/U\+9 at 1 is a control/);
    expect(reason('a\u2028b', STYLE)).toMatch(/forced line break/);
    expect(reason('ภาษา', STYLE)).toMatch(/class SA/);
    expect(reason('a\u2003b', STYLE)).toMatch(/space separator/);
  });
});

describe('greedy fit with Core Text advances against Chrome 145 lines', () => {
  it('chooses Chrome\'s breaks for every spike case (Japanese against text-spacing-trim: space-all)', () => {
    const rows = spikeFitRows(NO_LINE_BREAK_FAULTS, NO_FIT_FAULTS, false);
    expect(failures(rows)).toEqual([]);
    expect(tally(rows)).toEqual({ interVariable: '60/60', japanese: '60/60', jpFontLatinProse: '20/20', latinStatic: '480/480' });
  });

  it('misses Chrome\'s default Japanese lines only through text-spacing-trim, which is not implemented (caveat)', () => {
    const rows = spikeFitRows(NO_LINE_BREAK_FAULTS, NO_FIT_FAULTS, true).filter((r) => r.group === 'japanese');
    expect(tally(rows)).toEqual({ japanese: '15/60' });
  });

  it('adds the hyphen advance at a soft-hyphen break, hangs trailing spaces and lets an unbreakable word overflow', () => {
    // "ab\u00ADcd ef": every code point advances 10; the hyphen advances 5.
    const text = [0x61, 0x62, 0xad, 0x63, 0x64, 0x20, 0x65, 0x66];
    const advances = [10, 10, 0, 10, 10, 10, 10, 10];
    const opps = opportunities(text, NO_LINE_BREAK_FAULTS);
    expect(opps).toEqual([{ position: 3, kind: 'soft-hyphen' }, { position: 6, kind: 'normal' }]);
    const at = (w: number) => {
      const r = fitLines(text, advances, opps, fromCssPx(w), 5);
      if (!r.ok) throw new Error(r.reason);
      return r.lines.map((l) => [l.start, l.end, l.visibleEnd, l.width, l.hyphenated, l.overflows]);
    };
    expect(at(40)).toEqual([[0, 6, 5, 40, false, false], [6, 8, 8, 20, false, false]]);
    expect(at(25)).toEqual([[0, 3, 3, 25, true, false], [3, 6, 5, 20, false, false], [6, 8, 8, 20, false, false]]);
    expect(at(24)).toEqual([[0, 3, 3, 25, true, true], [3, 6, 5, 20, false, false], [6, 8, 8, 20, false, false]]);
  });

  it('fits a width up to 1/64 px over the available width, as Blink does', () => {
    const w = fromCssPx(100);
    expect(fitsAvailable(100 + 0.5 / 64, w, NO_FIT_FAULTS)).toBe(true);
    expect(fitsAvailable(100 + 1 / 64, w, NO_FIT_FAULTS)).toBe(true);
    expect(fitsAvailable(100 + 1.5 / 64, w, NO_FIT_FAULTS)).toBe(false);
    expect(fitsAvailable(100 + 0.5 / 64, w, { ...NO_FIT_FAULTS, noEpsilon: true })).toBe(false);
  });

  it('refuses advances that do not match the text', () => {
    expect(fitLines([0x61], [], [], fromCssPx(10), 0)).toEqual({ ok: false, reason: '0 advances for 1 code points' });
  });
});

describe('planted faults each fail at least one Chrome case', () => {
  it('"break after /" (ICU) fails opportunity cases', () => {
    const faults = { ...NO_LINE_BREAK_FAULTS, breakAfterSolidus: true };
    const failed = [...failures(spikeOpportunityRows(faults)), ...failures(ruleOpportunityRows(faults))];
    expect(failed.length).toBeGreaterThan(0);
    expect(failed).toContain('Inter/longwords/12/120');
    expect(failed).toContain('ascii-solidus/en');
  });

  it('"no break between hyphen and digit" (UAX #14 LB25) fails opportunity cases', () => {
    const faults = { ...NO_LINE_BREAK_FAULTS, noHyphenDigitBreak: true };
    const failed = [...failures(spikeOpportunityRows(faults)), ...failures(ruleOpportunityRows(faults))];
    expect(failed.length).toBeGreaterThan(0);
    expect(failed).toContain('Inter/hyphen/12/120');
    expect(failed).toContain('ascii-minus/en');
  });

  it('fit without the 1/64 px epsilon fails fit cases', () => {
    expect(failures(spikeFitRows(NO_LINE_BREAK_FAULTS, { ...NO_FIT_FAULTS, noEpsilon: true }, false)).length).toBeGreaterThan(0);
  });

  it('breaking an overflowing word mid-word fails fit cases', () => {
    expect(failures(spikeFitRows(NO_LINE_BREAK_FAULTS, { ...NO_FIT_FAULTS, breakInsideWord: true }, false)).length).toBeGreaterThan(0);
  });
});
