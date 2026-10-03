// P4 (notes/T013-p3-review-p4-plan.md section 2 item 3): the font-data measurer over the Ahem constants equals the Ahem measurer
// of 4c1331c (restated here from units.ts as the reference) on every vector and corpus text input, with and without the planted
// platform-rule faults; the covered-glyph predicate equals the old one on every BMP code point and a set of astral ones.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MeasureResult, TextMeasurer } from '../src/index.ts';
import { ahemMeasurer } from '../src/index.ts';
import type { AhemRuleFaults, FontData } from '../src/text.ts';
import { AHEM_FONT_DATA, ahemMeasurerWith, coveredCodePoints, coveredIndex, fontDataMeasurer } from '../src/text.ts';
import type { TextFont } from '../src/input.ts';
import { cachedRangeWidth, fontMetricPx, platformFontSize, roundFontMetricHalfUpToWholePx, roundFontMetricToWholePx, textAdvanceAt, zoomFontSize, ZERO } from '../src/units.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// The Ahem measurer as committed at 4c1331c (packages/layout/src/text.ts), kept verbatim as the reference.
function oldAdvance(cp: number): number {
  if (cp === 0x200b) return 0;
  if (cp >= 0x20 && cp <= 0x7e && cp !== 0x27) return 1;
  return -1;
}
function oldAhem(faults: AhemRuleFaults): TextMeasurer {
  const instanceSize = (px: number): number => (faults.untruncatedFontSize ? px : platformFontSize(px));
  const round = faults.metricHalfUp ? roundFontMetricHalfUpToWholePx : roundFontMetricToWholePx;
  const refuse = (cp: number): MeasureResult => ({ ok: false, reason: `U+${cp.toString(16).toUpperCase()} is not an Ahem full-advance glyph` });
  return {
    metrics: (font) => ({ ascent: round(fontMetricPx(instanceSize(font.size), 1000, 800)), descent: round(fontMetricPx(instanceSize(font.size), 1000, 200)), lineGap: ZERO }),
    measure(text, font) {
      let glyphs = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) as number;
        if (oldAdvance(cp) < 0) return refuse(cp);
        glyphs += oldAdvance(cp);
      }
      return { ok: true, measure: { width: textAdvanceAt(glyphs, instanceSize(font.size)) } };
    },
    measureRange(text, start, end, font) {
      let k = 0;
      let before = 0;
      let through = 0;
      for (const ch of text) {
        const cp = ch.codePointAt(0) as number;
        if (oldAdvance(cp) < 0) return refuse(cp);
        if (k < start) before += oldAdvance(cp);
        if (k < end) through += oldAdvance(cp);
        k++;
      }
      return { ok: true, measure: { width: cachedRangeWidth(before, through, instanceSize(font.size)) } };
    },
    lengths: () => {
      throw new Error('the pre-R4 reference measures no font-relative lengths');
    },
    shaped: () => ({ ok: false, reason: 'the old Ahem measurer does not shape' }),
  };
}

/** The Ahem constants as raw font data, written out independently of AHEM_FONT_DATA. */
const RAW_AHEM: FontData = { unitsPerEm: 1000, ascent: 800, descent: 200, lineGap: 0, advances: coveredCodePoints().map((cp) => (cp === 0x200b ? 0 : 1000)), xHeight: 800, capHeight: 800, zeroAdvance: 1000 };

type Leaf = { readonly text: string; readonly size: number };

function leavesOf(input: unknown, out: Leaf[]): void {
  const i = input as { devicePixelRatio: number; root: unknown };
  const walk = (n: { kind: string; text?: string; font?: { size: number }; children?: unknown[] }): void => {
    if (n.kind === 'text') {
      out.push({ text: n.text as string, size: (n.font as { size: number }).size });
      out.push({ text: n.text as string, size: zoomFontSize((n.font as { size: number }).size, i.devicePixelRatio) });
      return;
    }
    for (const c of n.children ?? []) walk(c as typeof n);
  };
  walk(i.root as Parameters<typeof walk>[0]);
}

async function allLeaves(): Promise<Leaf[]> {
  const out: Leaf[] = [];
  const vectorDirs = ['packages/layout/vectors', 'packages/layout/vectors/dpr-2', 'packages/layout/vectors/dpr-3', 'packages/layout/vectors/dpr-2.625'];
  for (const d of vectorDirs) {
    for (const f of readdirSync(join(root, d)).filter((x) => x.endsWith('.json')).sort()) leavesOf((JSON.parse(readFileSync(join(root, d, f), 'utf8')) as { input: unknown }).input, out);
  }
  // The differential corpora, loaded from packages/translate at run time (packages/layout does not depend on it).
  type CorpusModule = { vectorCases: () => { line: string }[]; engineCases: (v: readonly { line: string }[]) => { lines: string[] } };
  type DprModule = { dprVectorCases: () => { line: string }[]; engineDprCases: (v: readonly { line: string }[]) => string[] };
  const corpus = (await import(pathToFileURL(join(root, 'packages/translate/src/corpus.ts')).href)) as CorpusModule;
  const dpr = (await import(pathToFileURL(join(root, 'packages/translate/src/corpus-dpr.ts')).href)) as DprModule;
  const lines = [...corpus.engineCases(corpus.vectorCases()).lines, ...dpr.engineDprCases(dpr.dprVectorCases() as never)];
  for (const l of lines) leavesOf((JSON.parse(l) as { input: unknown }).input, out);
  const seen = new Set<string>();
  return out.filter((x) => {
    const k = `${x.size}\u0000${x.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Deep equality with Object.is on numbers, so -0 and 0 differ (the harnesses compare IEEE bit patterns). */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

const FAULTS: readonly AhemRuleFaults[] = [
  { metricHalfUp: false, untruncatedFontSize: false },
  { metricHalfUp: true, untruncatedFontSize: false },
  { metricHalfUp: false, untruncatedFontSize: true },
  { metricHalfUp: true, untruncatedFontSize: true },
];

describe('font-data measurer (R4 bridge path)', () => {
  it('the covered-glyph predicate equals the old Ahem predicate on every BMP code point and astral samples', () => {
    const cps = coveredCodePoints();
    expect(cps.length).toBe(95);
    for (let cp = 0; cp <= 0x10ffff; cp += cp < 0x10000 ? 1 : 0x1001) {
      const k = coveredIndex(cp);
      expect(k >= 0, `U+${cp.toString(16)}`).toBe(oldAdvance(cp) >= 0);
      if (k >= 0) expect(cps[k]).toBe(cp);
    }
  });

  it('AHEM_FONT_DATA is the Ahem constants: 1000/800/200, line gap 0, 1 em per covered glyph and 0 for U+200B', () => {
    expect(AHEM_FONT_DATA).toEqual(RAW_AHEM);
  });

  it('over the Ahem constants it equals the 4c1331c Ahem measurer and ahemMeasurer on every vector and corpus text input', async () => {
    const leaves = await allLeaves();
    expect(leaves.length).toBeGreaterThan(1000);
    let compared = 0;
    const mismatches: string[] = [];
    const check = (what: string, got: unknown, want: unknown): void => {
      compared++;
      if (!same(got, want) && mismatches.length < 20) mismatches.push(`${what}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
    };
    for (const faults of FAULTS) {
      const want = oldAhem(faults);
      const viaData = fontDataMeasurer(RAW_AHEM, faults);
      const committed = faults.metricHalfUp || faults.untruncatedFontSize ? ahemMeasurerWith(faults) : ahemMeasurer;
      for (const l of leaves) {
        const font: TextFont = { family: 'Ahem', size: l.size };
        const tag = `${JSON.stringify(faults)} ${l.size} ${JSON.stringify(l.text)}`;
        const m = want.metrics(font);
        check(`metrics ${tag}`, viaData.metrics(font), m);
        check(`metrics ${tag}`, committed.metrics(font), m);
        const w = want.measure(l.text, font);
        check(`measure ${tag}`, viaData.measure(l.text, font), w);
        check(`measure ${tag}`, committed.measure(l.text, font), w);
        const n = [...l.text].length;
        // Every prefix, every suffix and short ranges at every offset (min-content words are ranges of their leaf).
        for (let k = 0; k <= n; k++) {
          for (const [s, e] of [[0, k], [k, n], [k, Math.min(n, k + 1)], [k, Math.min(n, k + 3)]] as const) {
            const r = want.measureRange(l.text, s, e, font);
            check(`range ${s}-${e} ${tag}`, viaData.measureRange(l.text, s, e, font), r);
            check(`range ${s}-${e} ${tag}`, committed.measureRange(l.text, s, e, font), r);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    console.log(`font-data measurer: ${leaves.length} distinct text inputs x 4 fault settings, ${compared} comparisons, all equal`);
  }, 300_000);

  it('a font whose data differ from Ahem measures differently, so the data are read, not ignored', () => {
    const font: TextFont = { family: 'Ahem', size: 10 };
    const tall = fontDataMeasurer({ ...RAW_AHEM, ascent: 900 }, FAULTS[0] as AhemRuleFaults);
    expect(tall.metrics(font).ascent).not.toBe(ahemMeasurer.metrics(font).ascent);
    const wide = fontDataMeasurer({ ...RAW_AHEM, advances: RAW_AHEM.advances.map((a) => a * 2) }, FAULTS[0] as AhemRuleFaults);
    expect(wide.measure('XX', font)).not.toEqual(ahemMeasurer.measure('XX', font));
    const half = fontDataMeasurer({ ...RAW_AHEM, advances: RAW_AHEM.advances.map((a) => a / 2) }, FAULTS[0] as AhemRuleFaults);
    expect(half.measure('X', font).ok).toBe(false);
  });
});
