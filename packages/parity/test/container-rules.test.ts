// CQ: @container rules against the pinned Chrome's committed resize captures. cq-rules' script crosses every width its queries
// switch at: after the start and every step, the band runtime's program is the per-case program of the band holding the size, and
// its engine frames and background colours equal Chrome's at DPR 1, 2, 2.625 and 3; the compiled web rendering equals the authored
// one (chrome-dual). Each planted compiler fault fails the lanes on Chrome's frames or colours. No Chrome runs here.
import { describe, expect, it } from 'vitest';
import { mediaFeatures, NO_FAULTS } from 'dragon';
import { nativeCompile } from '../src/native-compile.ts';
import { committedResize, RESIZE_DPRS, resizeCaseReport, resizeCases, scriptPoints } from '../src/resize-capture.ts';

const cases = resizeCases().filter((c) => c.spec.id === 'cq-rules');

describe('CQ: @container rules against Chrome 145', () => {
  it('cq-rules runs in both directions with the @container profile row', () => {
    expect(cases.map((c) => c.id)).toEqual(['cq-rules~resize', 'cq-rules-rtl~resize']);
    for (const c of cases) expect(mediaFeatures(c.compiled), c.id).toEqual(['at-rule:@container', 'at-rule:@media', 'media-feature:width']);
  });

  it('the band runtime lays out every step as Chrome does, at every DPR', () => {
    for (const c of cases) {
      const r = resizeCaseReport(c);
      expect(r.failures, c.id).toEqual([]);
      expect(r.samples, c.id).toBe(scriptPoints(c).length * RESIZE_DPRS.length * 2);
    }
  });

  for (const plant of ['containerShiftDropped', 'containerSelfQueried'] as const) {
    it(`the planted ${plant} is caught`, () => {
      for (const c of cases) {
        // Its own id, so the band program cache holds the planted compile apart; the captures are the case's.
        const planted = { ...c, id: `${c.id}+${plant}`, compiled: nativeCompile(c.spec, c.direction, false, { ...NO_FAULTS, [plant]: true }) };
        const r = resizeCaseReport(planted, [1], undefined, (_id, rendering, dpr) => committedResize(c.id, rendering, dpr));
        expect(r.failures.some((f) => /edge delta|background-color chrome/.test(f)), `${c.id} ${plant}`).toBe(true);
      }
    });
  }
});
