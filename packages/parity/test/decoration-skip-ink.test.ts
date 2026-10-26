// TDEC-d for pinned faces against a live Chrome 145: text-decoration-skip-ink-lato (fixture-groups/fonts.ts SKIP_INK_FIXTURES)
// puts Lato descenders through auto underlines. Chrome renders each case as authored and stripped at DPR 1, 2, 3 and 2.625, as
// pnpm run parity:decoration-capture does, and the engine's rects, clipped by Skia's glyph intercepts over Lato's glyf outlines
// (layout glyph-intercepts.ts), must paint exactly the decoration pixels. Each planted intercept fault must break a case. The
// native compiler still refuses skip-ink on a real face (computed-checks.ts) until real-face text ships on device (TXT1a-2).
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { glyphIntercepts as gi } from '@dragon/layout';
import { captureFixture } from '../src/capture.ts';
import { CHROME_VERSION, launchChrome } from '../src/chrome.ts';
import type { ParityCase } from '../src/cases.ts';
import { checkDecorations, compileHtml, DECORATION_DPRS, predictDecorations, strippedHtml } from '../src/decoration-capture.ts';
import { layoutFrames, shootDecoration } from '../src/decoration-shoot.ts';
import { atDpr, zoomGuard } from '../src/dpr.ts';
import type { FontFixture } from '../src/fixture-groups/fonts.ts';
import { SKIP_INK_FIXTURES } from '../src/fixture-groups/fonts.ts';
import { fontCases, referenceTransform } from '../src/fonts-run.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { decodePng } from '../src/pixel-reference.ts';
import { hostPlatform, requireReferencePlatform } from '../src/platform.ts';

const WHITE = { r: 255, g: 255, b: 255, a: 255 };
type Shot = { readonly fixture: FontFixture; readonly case: ParityCase; readonly dpr: number; readonly decorated: RgbaImage; readonly stripped: RgbaImage; readonly sameLayout: boolean };
const shots: Shot[] = [];

beforeAll(async () => {
  requireReferencePlatform(hostPlatform());
  for (const dpr of DECORATION_DPRS) {
    const browser: Browser = await launchChrome(dpr);
    try {
      expect(browser.version()).toBe(CHROME_VERSION);
      if (dpr !== 1) await zoomGuard(browser, dpr);
      for (const fixture of SKIP_INK_FIXTURES) {
        for (const c of fontCases(fixture)) {
          const prepare = referenceTransform(fixture);
          const stripped = strippedHtml(c.authoredHtml);
          const a = await captureFixture(browser, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], prepare);
          const b = await captureFixture(browser, c.id, stripped, atDpr(c.environment, dpr), [], prepare);
          const decorated = decodePng(await shootDecoration(browser, c.authoredHtml, c, dpr, prepare));
          const plain = decodePng(await shootDecoration(browser, stripped, c, dpr, prepare));
          shots.push({ fixture, case: c, dpr, decorated, stripped: plain, sameLayout: layoutFrames(a.nodes) === layoutFrames(b.nodes) });
        }
      }
    } finally {
      await browser.close();
    }
  }
}, 900_000);

afterAll(() => {
  shots.length = 0;
});

/** Each shot's mismatches under the intercept faults, and how many of its rects the intercepts clip. */
function run(faults: gi.InterceptFaults): { readonly failed: string[]; readonly clipped: number; readonly pixels: number } {
  const failed: string[] = [];
  let clipped = 0;
  let pixels = 0;
  for (const s of shots) {
    const p = predictDecorations(s.fixture, s.case, s.dpr, undefined, undefined, faults);
    if (p.kind !== 'rects') {
      failed.push(`${s.case.id}@${s.dpr}: refused: ${p.detail}`);
      continue;
    }
    clipped += p.rects.filter((r) => r.clips.length > 0).length;
    const r = checkDecorations(s.decorated, s.stripped, p.rects, WHITE);
    pixels += r.matched;
    if (r.problems.length > 0 || r.matched !== r.decorationPixels) failed.push(`${s.case.id}@${s.dpr}: ${r.matched}/${r.decorationPixels}; ${r.problems.slice(0, 3).join('; ')}`);
  }
  return { failed, clipped, pixels };
}

describe('TDEC-d: skip-ink intercepts of Lato glyphs against a live Chrome 145', () => {
  it('Chrome lays out each stripped copy as its decorated case, at every DPR, in both directions', () => {
    expect(shots.length).toBe(SKIP_INK_FIXTURES.flatMap((f) => fontCases(f)).length * DECORATION_DPRS.length);
    expect(shots.filter((s) => !s.sameLayout).map((s) => `${s.case.id}@${s.dpr}`)).toEqual([]);
  });

  it('the engine paints every decoration pixel exactly, its underlines clipped by the glyph intercepts', () => {
    const r = run(gi.NO_INTERCEPT_FAULTS);
    expect(r.failed).toEqual([]);
    // Every case's underline is crossed by a descender at every DPR.
    expect(r.clipped).toBeGreaterThanOrEqual(shots.length);
    expect(r.pixels).toBeGreaterThan(10_000);
  });

  it('each planted intercept fault breaks a case', () => {
    for (const k of ['inkBoxNotOutline', 'bandUnscaled'] as const) {
      expect(run({ ...gi.NO_INTERCEPT_FAULTS, [k]: true }).failed.length, k).toBeGreaterThan(0);
    }
  });

  it('the native compile still refuses skip-ink on the real face (skip-ink-intercepts), until TXT1a-2 ships real-face text', () => {
    for (const fixture of SKIP_INK_FIXTURES) {
      const c = fontCases(fixture)[0] as ParityCase;
      const out = compileHtml(fixture, c.authoredHtml, c.environment.direction);
      expect(out.diagnostics.filter((d) => d.target === 'ios').some((d) => d.message.includes('skip-ink-intercepts'))).toBe(true);
    }
  });
});
