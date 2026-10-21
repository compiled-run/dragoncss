// CQ: cqw and cqi against the pinned Chrome's committed resize captures. cq-units' script crosses both @media bands and card's
// max-width clamp: after the start and every step, the band runtime lays out every box sized in a container query unit as Chrome
// does at DPR 1, 2, 2.625 and 3, and the compiled web rendering equals the authored one (chrome-dual). Each planted compiler fault
// fails the lanes on Chrome's frames. No Chrome runs here.
import { describe, expect, it } from 'vitest';
import { NO_FAULTS } from 'dragon';
import { nativeCompile } from '../src/native-compile.ts';
import { committedResize, RESIZE_DPRS, resizeCaseReport, resizeCases, scriptPoints } from '../src/resize-capture.ts';

const cases = resizeCases().filter((c) => c.spec.id === 'cq-units');

describe('CQ: container query units against Chrome 145', () => {
  it('cq-units runs in both directions, compiled with no error', () => {
    expect(cases.map((c) => c.id)).toEqual(['cq-units~resize', 'cq-units-rtl~resize']);
    for (const c of cases) expect(c.compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message), c.id).toEqual([]);
  });

  it('the band runtime lays out every step as Chrome does, at every DPR', () => {
    for (const c of cases) {
      const r = resizeCaseReport(c);
      expect(r.failures, c.id).toEqual([]);
      expect(r.samples, c.id).toBe(scriptPoints(c).length * RESIZE_DPRS.length * 2);
    }
  });

  for (const plant of ['containerShiftDropped', 'containerUnitUnclamped'] as const) {
    it(`the planted ${plant} is caught`, () => {
      for (const c of cases) {
        // Its own id, so the band program cache holds the planted compile apart; the captures are the case's.
        const planted = { ...c, id: `${c.id}+${plant}`, compiled: nativeCompile(c.spec, c.direction, false, { ...NO_FAULTS, [plant]: true }) };
        const r = resizeCaseReport(planted, [1], undefined, (_id, rendering, dpr) => committedResize(c.id, rendering, dpr));
        expect(r.failures.some((f) => /edge delta/.test(f)), `${c.id} ${plant}`).toBe(true);
      }
    });
  }
});
