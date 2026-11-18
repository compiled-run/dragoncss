// TDEC-d on real faces, measured and not yet proven: Skia's glyph intercepts (layout glyph-intercepts.ts, a port of
// get_glyph_run_intercepts and SkGlyph's path gap at Skia 2ab8add5, with Blink's ClipDecorationLine band) over Inter and Lato
// descenders, against Chrome's committed renderings. The engine misses a few columns at clip ends, so the compiler keeps refusing an
// auto underline on a real face (skip-ink-intercepts); this test pins how far the port gets, so a change shows.
import { describe, expect, it } from 'vitest';
import { checkDecorations, committedDecorations, compileHtml, DECORATION_DPRS, predictDecorations, realSkipCases } from '../src/decoration-capture.ts';

describe('skip-ink over real faces (TDEC-d, not proven)', () => {
  it('matches all but a few columns of Chrome\'s decoration pixels; the misses are pinned per capture', () => {
    let pixels = 0;
    const misses: Record<string, number> = {};
    for (const { fixture, case: c } of realSkipCases()) {
      for (const dpr of DECORATION_DPRS) {
        const p = predictDecorations(fixture, c, dpr);
        if (p.kind !== 'rects') throw new Error(`${c.id}@${dpr}: ${p.detail}`);
        const cap = committedDecorations(c.id, dpr);
        if (cap === null) throw new Error(`${c.id}@${dpr} is not captured`);
        const r = checkDecorations(cap.decorated, cap.stripped, p.rects, { r: 255, g: 255, b: 255, a: 255 });
        pixels += r.decorationPixels;
        if (r.problems.length > 0) misses[`${c.id}@${dpr}`] = r.problems.length;
      }
    }
    expect(pixels).toBe(55_694);
    expect(misses).toEqual({
      'text-decoration-real-skip@1': 2,
      'text-decoration-real-skip@3': 8,
      'text-decoration-real-skip@2.625': 9,
      'text-decoration-real-skip-rtl@1': 1,
      'text-decoration-real-skip-rtl@3': 10,
      'text-decoration-real-skip-rtl@2.625': 17,
    });
  }, 300_000);

  it('the compiler still refuses an auto underline on a real face for the native targets', () => {
    for (const { fixture, case: c } of realSkipCases()) {
      const compiled = compileHtml(fixture, c.authoredHtml, c.environment.direction);
      const refused = compiled.diagnostics.filter((d) => d.target === 'ios' && d.message.includes('skip-ink-intercepts'));
      expect(refused.length, c.id).toBeGreaterThan(0);
    }
  }, 300_000);
});
