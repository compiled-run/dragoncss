// TXT1-0 gate (docs/decisions.md "Text shaping: bundled HarfBuzz"): dragon_hb.wasm plus Blink's arithmetic
// must give Chrome 145's LayoutUnit width for every line and every nowrap span of the 620 spike cases.
// Any mismatch goes back to the owner; the planted faults show the comparison can fail.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DragonHB, LATO_LOADED_FONTS_PATH, LATO_REFERENCE_PATH, LOADED_FONTS_PATH, fontPath, loadReference, runGate } from '../src/index.ts';
import type { CaseResult, GateOptions } from '../src/index.ts';

const ref = loadReference();
const hb = DragonHB.load();
const mismatches = (results: readonly CaseResult[]): number => results.filter((r) => !r.exact).length;

describe('TXT1-0 HarfBuzz gate', () => {
  it('uses the fonts Chrome measured', () => {
    // The reference's hashes are those of the files Chrome loaded (chrome/loaded-fonts.sha256), not of the repo copies.
    const loaded = readFileSync(LOADED_FONTS_PATH, 'utf8');
    for (const [name, meta] of Object.entries(ref.fonts)) {
      expect(loaded, name).toContain(`${meta.sha256}  ${meta.file}\n`);
      expect(createHash('sha256').update(readFileSync(fontPath(meta.file))).digest('hex'), name).toBe(meta.sha256);
    }
  });

  it('covers the whole spike corpus', () => {
    expect(ref.cases.length).toBe(620);
    const byFont = new Map<string, number>();
    for (const c of ref.cases) byFont.set(c.font, (byFont.get(c.font) ?? 0) + 1);
    expect(Object.fromEntries(byFont)).toEqual({ Inter: 160, Roboto: 160, NotoSans: 160, NotoSansJP: 80, InterVF: 60 });
  });

  it('matches Chrome on every line and nowrap width of all 620 cases', () => {
    const results = runGate(ref, hb);
    const failed = results.filter((r) => !r.exact).map((r) => ({ id: r.id, error: r.error, lines: r.lineDiffs.slice(0, 3), nowrap: r.nowrap }));
    expect(failed).toEqual([]);
    expect(results.length).toBe(ref.cases.length);
    expect(results.reduce((n, r) => n + r.lines, 0)).toBe(ref.cases.reduce((n, c) => n + c.lines.length, 0));
  });

  const faults: ReadonlyArray<readonly [string, GateOptions]> = [
    ['glyph advances summed in float', { faults: { floatAccumulation: true } }],
    ['positions rounded to whole pixels', { faults: { wholePixelPositions: true } }],
    ['kerning off', { faults: { noKerning: true } }],
    ['no reshaping at the start of wrapped lines', { faults: { noReshapeAtLineStart: true } }],
    ['no HanKerning (text-spacing-trim)', { noHanKerning: true }],
  ];
  for (const [name, options] of faults) {
    it(`catches a planted fault: ${name}`, () => {
      expect(mismatches(runGate(ref, hb, options))).toBeGreaterThan(0);
    });
  }
});

// T036: Lato 2.015 Regular (400) and Bold (700), vendored for the north star, measured with the spike's method
// (docs/research/text-spike/lato). Every Latin paragraph at the spike's sizes plus the demo's, wrapped and nowrap.
describe('TXT1-0 HarfBuzz gate: Lato', () => {
  const lato = loadReference(LATO_REFERENCE_PATH);

  it('uses the Lato files Chrome measured, the vendored ones', () => {
    const loaded = readFileSync(LATO_LOADED_FONTS_PATH, 'utf8');
    expect(Object.entries(lato.fonts).map(([n, m]) => [n, m.file])).toEqual([['Lato', 'Lato-Regular.ttf'], ['LatoBold', 'Lato-Bold.ttf']]);
    for (const [name, meta] of Object.entries(lato.fonts)) {
      expect(loaded, name).toContain(`${meta.sha256}  ${meta.file}\n`);
      expect(fontPath(meta.file), name).toMatch(/vendor\/fonts\/Lato\//);
      expect(createHash('sha256').update(readFileSync(fontPath(meta.file))).digest('hex'), name).toBe(meta.sha256);
    }
  });

  it('covers every Latin paragraph of the spike in both weights, with the break opportunities of the spike', () => {
    expect(lato.cases.length).toBe(640);
    const byFont = new Map<string, number>();
    for (const c of lato.cases) byFont.set(c.font, (byFont.get(c.font) ?? 0) + 1);
    expect(Object.fromEntries(byFont)).toEqual({ Lato: 320, LatoBold: 320 });
    const en = Object.keys(ref.paragraphs).filter((k) => k.startsWith('en/'));
    expect(Object.keys(lato.paragraphs).sort()).toEqual(en.sort());
    for (const k of en) {
      expect(lato.paragraphs[k], k).toBe(ref.paragraphs[k]);
      expect(lato.opportunities[k], k).toEqual(ref.opportunities[k]);
    }
  });

  it('matches Chrome on every line and nowrap width of all 640 Lato cases', () => {
    const results = runGate(lato, hb);
    const failed = results.filter((r) => !r.exact).map((r) => ({ id: r.id, error: r.error, lines: r.lineDiffs.slice(0, 3), nowrap: r.nowrap }));
    expect(failed).toEqual([]);
    expect(results.length).toBe(640);
    expect(results.reduce((n, r) => n + r.lines, 0)).toBe(lato.cases.reduce((n, c) => n + c.lines.length, 0));
  });

  const latoFaults: ReadonlyArray<readonly [string, GateOptions]> = [
    ['glyph advances summed in float', { faults: { floatAccumulation: true } }],
    ['positions rounded to whole pixels', { faults: { wholePixelPositions: true } }],
    ['kerning off', { faults: { noKerning: true } }],
  ];
  // Line-start reshaping changes no Lato width in this corpus; the 620-case controls above cover it.
  for (const [name, options] of latoFaults) {
    it(`catches a planted fault on Lato: ${name}`, () => {
      expect(mismatches(runGate(lato, hb, options))).toBeGreaterThan(0);
    });
  }
});
