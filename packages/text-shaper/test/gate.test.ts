// TXT1-0 gate (docs/decisions.md "Text shaping: bundled HarfBuzz"): dragon_hb.wasm plus Blink's arithmetic
// must give Chrome 145's LayoutUnit width for every line and every nowrap span of the 620 spike cases.
// Any mismatch goes back to the owner; the planted faults show the comparison can fail.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DragonHB, FONT_DIR, LOADED_FONTS_PATH, loadReference, runGate } from '../src/index.ts';
import type { CaseResult, GateOptions } from '../src/index.ts';

const ref = loadReference();
const hb = DragonHB.load();
const mismatches = (results: readonly CaseResult[]): number => results.filter((r) => !r.exact).length;

describe('TXT1-0 HarfBuzz gate', () => {
  it('uses the fonts Chrome measured', () => {
    // The reference's hashes are those of the files Chrome loaded (chrome/loaded-fonts.sha256), not of FONT_DIR.
    const loaded = readFileSync(LOADED_FONTS_PATH, 'utf8');
    for (const [name, meta] of Object.entries(ref.fonts)) {
      expect(loaded, name).toContain(`${meta.sha256}  ${meta.file}\n`);
      expect(createHash('sha256').update(readFileSync(`${FONT_DIR}/${meta.file}`)).digest('hex'), name).toBe(meta.sha256);
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
