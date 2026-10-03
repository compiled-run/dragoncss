// The committed Chrome glyph calibration set (T093 ruling A): the PNGs and manifest pnpm run parity:glyph-calibration wrote, the
// cells covering 20 to 192 device px at every device DPR and the four x phases, apart from each other, with no ink outside them;
// Chrome's fringe within GLYPH_FRINGE_MAX_DEVICE_PX of a glyph edge, its glyph x centres within GLYPH_CENTRE_ERROR_MAX_DEVICE_PX
// and its glyph bottom edges within GLYPH_BOTTOM_ERROR_MAX_DEVICE_PX of the geometry; the sampler's clearance beyond the fringe;
// and the corpus's largest glyph within the calibrated sizes. The y centre is not bounded: Chrome's darwin fringe grows glyph tops
// by 0.21 to 0.60 device px and not bottoms (T093 addendum F1, which retargeted the y centre assertion to the bottom edge).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chromeArgsAt, CHROME_VERSION } from '../src/chrome.ts';
import type { CalibrationManifest } from '../src/glyph-calibration.ts';
import { CALIBRATION_DPRS, calibrationRecheck, CALIBRATION_PHASES, CALIBRATION_SIZES_DEVICE_PX, fringeExtent, GLYPH_BOTTOM_ERROR_MAX_DEVICE_PX, GLYPH_CENTRE_ERROR_MAX_DEVICE_PX, GLYPH_FRINGE_MAX_DEVICE_PX, glyphCalibrationManifestPath, glyphCalibrationPath, overlappingCells, planCells, positionErrors, strayInk } from '../src/glyph-calibration.ts';
import { BACKEND_OF, nativeCases } from '../src/native-host.ts';
import { decodePng, glyphLines, PIXEL_CAPTURE } from '../src/pixel-reference.ts';
import { SAMPLE_INSET_DEVICE_PX } from '../src/samples.ts';
import { deviceDprs } from '../src/targets.ts';
import { inputFaces } from '../src/text-latin-run.ts';
import { programInput } from 'dragon';

const manifest = JSON.parse(readFileSync(glyphCalibrationManifestPath(), 'utf8')) as CalibrationManifest;
const images = new Map(manifest.sets.map((s) => [s.dpr, decodePng(readFileSync(glyphCalibrationPath(s.dpr)))]));
const image = (dpr: number) => {
  const img = images.get(dpr);
  if (img === undefined) throw new Error(`no calibration PNG at DPR ${dpr}`);
  return img;
};

describe('the committed glyph calibration set', () => {
  it('one PNG per DPR (2, 2.625 and 3) with the manifest sha256, size, Chrome version and flags', () => {
    expect(CALIBRATION_DPRS).toEqual([2, 2.625, 3]);
    expect([manifest.chrome, manifest.capture]).toEqual([CHROME_VERSION, PIXEL_CAPTURE]);
    expect(manifest.sets.map((s) => s.dpr)).toEqual([...CALIBRATION_DPRS]);
    for (const s of manifest.sets) {
      const png = readFileSync(glyphCalibrationPath(s.dpr));
      expect(createHash('sha256').update(png).digest('hex'), `DPR ${s.dpr}`).toBe(s.sha256);
      expect(s.flags).toEqual(chromeArgsAt(s.dpr));
      expect([image(s.dpr).width, image(s.dpr).height]).toEqual([s.width, s.height]);
    }
  });
  it('covers 20 to 192 device px at the four quarter-pixel phases, X and XX, in the planned cells', () => {
    expect(Math.min(...CALIBRATION_SIZES_DEVICE_PX)).toBeLessThanOrEqual(20);
    expect(Math.max(...CALIBRATION_SIZES_DEVICE_PX)).toBeGreaterThanOrEqual(192);
    expect(CALIBRATION_PHASES).toEqual([0, 0.25, 0.5, 0.75]);
    for (const s of manifest.sets) {
      const plan = planCells(s.dpr).cells;
      expect(s.cells.map((c) => [c.text, c.size, c.phase])).toEqual(plan.map((c) => [c.text, c.size, c.phase]));
      s.cells.forEach((c, i) => {
        const pen = c.glyphs[0]?.left ?? Number.NaN;
        expect(pen, `${c.text}@${c.size}+${c.phase} at DPR ${s.dpr}`).toBe(plan[i]?.penX);
        expect(pen - Math.floor(pen)).toBe(c.phase);
        expect(c.glyphs.length).toBe(c.text.length);
        // platformFontSize truncates to 1/100 px.
        expect(Math.abs(c.fontSize - c.size)).toBeLessThan(0.0101);
      });
    }
  });
  it('cells do not overlap and Chrome inked nothing outside them', () => {
    for (const s of manifest.sets) {
      expect(overlappingCells(s.cells), `DPR ${s.dpr}`).toEqual([]);
      expect(strayInk(image(s.dpr), s.cells).slice(0, 5), `DPR ${s.dpr}`).toEqual([]);
    }
  });
  it(`Chrome's fringe stays within ${GLYPH_FRINGE_MAX_DEVICE_PX} device px of a glyph box edge, inside the sampler's clearance`, () => {
    expect(GLYPH_FRINGE_MAX_DEVICE_PX).toBeLessThan(SAMPLE_INSET_DEVICE_PX);
    for (const s of manifest.sets) {
      for (const c of s.cells) expect(fringeExtent(image(s.dpr), c), `${c.text}@${c.size}+${c.phase} at DPR ${s.dpr}`).toBeLessThanOrEqual(GLYPH_FRINGE_MAX_DEVICE_PX);
    }
  });
  for (const [axis, what, bound] of [['x', 'x centres', GLYPH_CENTRE_ERROR_MAX_DEVICE_PX], ['y', 'bottom edges', GLYPH_BOTTOM_ERROR_MAX_DEVICE_PX]] as const) {
    it(`Chrome's glyph ${what}, by check (c)'s scanlines, are within ${bound} device px of the geometry`, () => {
      const over: string[] = [];
      let measured = 0;
      for (const s of manifest.sets) {
        for (const c of s.cells) {
          const e = positionErrors(image(s.dpr), c).filter((x) => x.axis === axis);
          expect(e.length, `${c.text}@${c.size}+${c.phase} at DPR ${s.dpr}`).toBe(1);
          measured += e.length;
          for (const x of e) if (Math.abs(x.error) > bound) over.push(`${c.text}@${c.size}+${c.phase} at DPR ${s.dpr}: ${x.error.toFixed(3)}`);
        }
      }
      expect(measured).toBe(manifest.sets.reduce((n, s) => n + s.cells.length, 0));
      expect(over).toEqual([]);
    });
  }
});

describe('--recheck compares the manifest, not only the PNGs', () => {
  it('the committed manifest reproduces itself; a changed cell, sha, flag or missing set is reported', () => {
    const text = readFileSync(glyphCalibrationManifestPath(), 'utf8');
    const m = JSON.parse(text) as CalibrationManifest;
    expect(calibrationRecheck(m, text)).toEqual([]);
    const set = m.sets[0] as CalibrationManifest['sets'][number];
    const cells = set.cells.map((c, i) => (i === 3 ? { ...c, glyphs: c.glyphs.map((g) => ({ ...g, bottom: g.bottom + 1 / 64 })) } : c));
    expect(calibrationRecheck({ ...m, sets: [{ ...set, cells }, ...m.sets.slice(1)] }, text)).toEqual([expect.stringMatching(new RegExp(`^DPR ${set.dpr}: cell 3 `))]);
    expect(calibrationRecheck({ ...m, sets: [{ ...set, sha256: '0' }, ...m.sets.slice(1)] }, text)).toEqual([expect.stringMatching(new RegExp(`^DPR ${set.dpr}: sha256 "0"`))]);
    expect(calibrationRecheck({ ...m, sets: [{ ...set, flags: [] }, ...m.sets.slice(1)] }, text)[0]).toMatch(/: flags \[\]/);
    expect(calibrationRecheck({ ...m, sets: m.sets.slice(1) }, text)).toEqual([`DPR ${set.dpr}: not re-captured`]);
  });
});

describe('the corpus against the calibration', () => {
  it("the corpus's largest glyph, on every target at every device DPR, is within the largest calibrated size", () => {
    let largest = 0;
    const cases = nativeCases();
    for (const target of ['ios', 'android'] as const) {
      for (const dpr of deviceDprs(target)) {
        // TXT1a-2: the calibration is of Ahem's glyphs; real-font text is the R10 text pixel rule's (notes/T056-txt1a-spec.md).
        for (const n of cases.filter((c) => [...inputFaces(programInput(c.programs.uikit, c.case.environment.viewport, dpr))].every((f) => f === 'Ahem'))) {
          for (const l of glyphLines(n.programs[BACKEND_OF[target]], n.case.environment.viewport, dpr)) for (const g of l.glyphs) largest = Math.max(largest, g.right - g.left, g.bottom - g.top);
        }
      }
    }
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThanOrEqual(Math.max(...CALIBRATION_SIZES_DEVICE_PX));
  }, 300_000);
});
