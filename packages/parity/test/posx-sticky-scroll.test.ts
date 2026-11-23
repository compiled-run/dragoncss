// POSX-s scroll: stickyShift (layout.ts) at the scroll offsets Chrome reached places every sticky box of the sticky scroll fixtures
// where Chrome 145 draws it (committed expected-sticky-scroll captures, page CSS px, at DPR 1 and 2), the engine's own at-rest
// placement being stickyShift at offset 0. A planted fault, the scroll offset ignored, must move a box.
import { describe, expect, it } from 'vitest';
import { fromRaw, LU_PER_PX, stickyConstraints, stickyShift } from '@dragon/layout';
import { nativePrograms, programInput } from 'dragon';
import { expectedEngine, nativeCompile } from '../src/native-host.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { committedStickyScroll, STICKY_SCROLL_DPRS, STICKY_SCROLL_FIXTURES, stickyScrollCases } from '../src/sticky-scroll.ts';

const mismatches = (ignoreScroll: boolean): string[] => {
  const out: string[] = [];
  const engine = expectedEngine();
  for (const c of stickyScrollCases()) {
    const spec = FIXTURES.find((f) => c.id === f.id || c.id === `${f.id}-rtl`);
    if (spec === undefined) throw new Error(`${c.id}: no fixture`);
    const programs = nativePrograms(nativeCompile(spec, c.environment.direction), c.assignment);
    if (programs.kind !== 'ready') throw new Error(`${c.id}: ${programs.reason}`);
    for (const dpr of STICKY_SCROLL_DPRS) {
      const constraints = stickyConstraints(programInput(programs.programs.uikit, c.environment.viewport, dpr), engine.measurer);
      const capture = committedStickyScroll(c.id, dpr);
      for (const step of capture.steps) {
        if (step.boxes.length !== constraints.length) out.push(`${c.id}@${dpr}: Chrome has ${step.boxes.length} sticky boxes, the engine ${constraints.length}`);
        for (const [id, x, y] of step.boxes) {
          const k = constraints.find((q) => q.id === id);
          if (k === undefined) {
            out.push(`${c.id}@${dpr}: no constraint for ${id}`);
            continue;
          }
          const lu = (css: number) => fromRaw(Math.round(css * dpr * LU_PER_PX));
          const s = stickyShift(k, lu(ignoreScroll ? 0 : step.scrollX), lu(ignoreScroll ? 0 : step.scrollY));
          const gotX = (k.x + s.dx) / LU_PER_PX / dpr;
          const gotY = (k.y + s.dy) / LU_PER_PX / dpr;
          if (gotX !== x || gotY !== y) out.push(`${c.id}@${dpr} scroll ${step.scrollY}: ${id} at ${gotX}, ${gotY}, Chrome ${x}, ${y}`);
        }
      }
    }
  }
  return out;
};

describe('POSX-s scroll: sticky boxes at scroll offsets of the viewport, against Chrome', () => {
  it('covers the sticky scroll fixtures, each scrolling past its sticky ranges', () => {
    expect(stickyScrollCases().map((c) => c.id)).toEqual(STICKY_SCROLL_FIXTURES.flatMap((f) => [f, `${f}-rtl`]));
    expect(committedStickyScroll('sticky-scroll', 1).steps.some((s) => s.scrollY > 300)).toBe(true);
  });
  it('places every sticky box where Chrome draws it at every captured offset', () => {
    expect(mismatches(false)).toEqual([]);
  });
  it('the scroll offset ignored moves a box', () => {
    expect(mismatches(true).length).toBeGreaterThan(0);
  });
});
