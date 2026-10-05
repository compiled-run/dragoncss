// MQ-R1 (notes/T067-mq-r-spec.md R5, R7 (a), R13): the resize host lanes. Every resize script runs on the band runtime reference
// and in Chrome (committed captures, pnpm run parity:resize-capture): after the start and every step the runtime's program is the
// per-case program of (app assignment, the partition's band of the size), and its engine frames and background colours equal
// Chrome's at DPR 1, 2, 2.625 and 3; the compiled web rendering equals the authored one (chrome-dual). Each planted fault fails the
// lanes; the media profile rows are exactly what profile:rows derives from the passing cases.
import { describe, expect, it } from 'vitest';
import { androidProfile, iosProfile, MEDIA_CONTEXT, mediaFeatures, NO_BAND_RUNTIME_FAULTS, nativeBandOfViewport, nativeBands, webProfile } from 'dragon';
import type { ResizeCapture } from '../src/resize-capture.ts';
import { committedResize, RESIZE_BACKENDS, RESIZE_DPRS, resizeCaptureProblem, resizeCaseReport, resizeCases, resizeReport, scriptPoints, scriptProblem } from '../src/resize-capture.ts';
import { RESIZE_SCRIPTS, resizeSizeProblem } from '../src/fixture-groups/media-runtime.ts';
import { deriveMediaRows } from '../src/profile-rows.ts';

const cases = resizeCases();
const byId = (id: string) => {
  const c = cases.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no resize case ${id}`);
  return c;
};

describe('the resize scripts', () => {
  it('stay on the 8 css px grid within the 400x400 every portrait stage holds, and name real fixtures and states', () => {
    for (const s of RESIZE_SCRIPTS) expect(scriptProblem(s), s.fixture).toBeNull();
    expect([[401, 304], [404, 304], [300, 304], [0, 304], [400, 7.5]].map(([width, height]) => resizeSizeProblem({ width: width as number, height: height as number }) !== null)).toEqual([true, true, true, true, true]);
    expect(resizeSizeProblem({ width: 400, height: 400 })).toBeNull();
    expect(cases.map((c) => c.id)).toEqual(RESIZE_SCRIPTS.flatMap((s) => [`${s.fixture}~resize`, `${s.fixture}-rtl~resize`]));
  });
  it('visit every band of their fixture, so every band the native output ships is proven', () => {
    for (const c of cases) {
      const bands = nativeBands(c.compiled);
      const reached = new Set(scriptPoints(c).map((p) => nativeBandOfViewport(c.compiled, p.size)));
      expect([...reached].sort(), c.id).toEqual(Array.from({ length: bands === null ? 1 : bands.table.bands.length }, (_, k) => k));
    }
  });
});

describe('the resize host lanes against the committed Chrome traces', () => {
  const report = resizeReport();
  it('pass on every case at every DPR: the R5 oracle, frames exact in zoomed LU, background colours and chrome-dual', () => {
    expect(report.failures).toEqual([]);
    expect(report.passing.map((c) => c.id)).toEqual(cases.map((c) => c.id));
    const points = cases.reduce((n, c) => n + scriptPoints(c).length, 0);
    // Each sample and oracle point is judged on both backends' band programs (uikit and android-views).
    expect([report.samples, report.oracle, report.dual]).toEqual([points * RESIZE_DPRS.length * RESIZE_BACKENDS.length, points * RESIZE_DPRS.length * RESIZE_BACKENDS.length, points]);
    expect(report.boxes).toBeGreaterThan(report.samples);
    expect(report.colors).toBeGreaterThan(report.samples);
  }, 600_000);
  it('run the android-views band program too: a fault planted in it alone fails the lanes', () => {
    const c = byId('mqr-width-switch~resize');
    expect(resizeCaseReport(c, [1]).failures).toEqual([]);
    expect(RESIZE_BACKENDS).toEqual(['uikit', 'android-views']);
    const r = resizeCaseReport(c, [1], { ...NO_BAND_RUNTIME_FAULTS, bandDeltaDropped: true });
    expect(r.failures.some((f) => f.includes(' android-views step '))).toBe(true);
    expect(r.failures.some((f) => f.includes(' uikit step '))).toBe(true);
  });
  for (const fault of ['bandBoundaryExclusive', 'bandStale', 'resizeSkipsRelayout', 'bandDeltaDropped'] as const) {
    it(`the planted ${fault} fails them`, () => {
      const r = resizeCaseReport(byId('mqr-width-switch~resize'), [1], { ...NO_BAND_RUNTIME_FAULTS, [fault]: true });
      expect(r.failures.length, fault).toBeGreaterThan(0);
      // Not only the oracle: Chrome's frames or colours disagree too.
      expect(r.failures.some((f) => /not exact in zoomed LU|background-color chrome|node/.test(f)), fault).toBe(true);
    });
  }
  const tampered = (edit: (c: ResizeCapture) => ResizeCapture) => (id: string, r: 'authored' | 'compiled', dpr: number): ResizeCapture | null => {
    const c = committedResize(id, r, dpr);
    return c === null ? null : edit(c);
  };
  it('a capture with a box moved by one px fails the frames; a compiled capture that differs fails chrome-dual; a missing one fails', () => {
    const c = byId('mqr-nested~resize');
    const moved = tampered((cap) => (cap.rendering !== 'authored' ? cap : { ...cap, samples: cap.samples.map((s, i) => (i !== 2 ? s : { ...s, nodes: s.nodes.map((n) => (n.id === 'b' ? { ...n, width: n.width + 1 } : n)) })) }));
    expect(resizeCaseReport(c, [2], NO_BAND_RUNTIME_FAULTS, moved).failures.some((f) => f.startsWith(`${c.id} DPR 2 uikit step 2 (352x304)`))).toBe(true);
    const dual = tampered((cap) => (cap.rendering !== 'compiled' ? cap : { ...cap, samples: cap.samples.slice(0, -1) }));
    expect(resizeCaseReport(c, [1], NO_BAND_RUNTIME_FAULTS, dual).failures.some((f) => f.includes('chrome-dual'))).toBe(true);
    expect(resizeCaseReport(c, [3], NO_BAND_RUNTIME_FAULTS, () => null).failures).toEqual([`${c.id} DPR 3: no committed resize capture (pnpm run parity:resize-capture)`]);
    // A capture of the same steps from another start size is another script.
    const restarted = tampered((cap) => ({ ...cap, start: { width: 392, height: 304 } }));
    expect(resizeCaseReport(c, [2], NO_BAND_RUNTIME_FAULTS, restarted).failures).toEqual([`${c.id} DPR 2: the capture is of another script (7 samples; the script has 7) (pnpm run parity:resize-capture)`]);
  });
  it('a committed capture file is checked field by field before the lanes read it', () => {
    const good = committedResize('mqr-nested~resize', 'authored', 2) as ResizeCapture;
    expect(resizeCaptureProblem(good, 'mqr-nested~resize', 'authored', 2)).toBeNull();
    expect(resizeCaptureProblem(good, 'mqr-nested~resize', 'authored', 3)).toMatch(/not the authored resize capture of mqr-nested~resize at DPR 3/);
    expect(resizeCaptureProblem({ ...good, start: null }, 'mqr-nested~resize', 'authored', 2)).toMatch(/start/);
    const bad = (edit: (n: Record<string, unknown>) => Record<string, unknown>) => ({ ...good, samples: good.samples.map((s, i) => (i === 1 ? { ...s, nodes: s.nodes.map((n, j) => (j === 0 ? edit({ ...n }) : n)) } : s)) });
    expect(resizeCaptureProblem(bad((n) => ({ ...n, width: '3' })), 'mqr-nested~resize', 'authored', 2)).toMatch(/sample 1: node html has a non-numeric box/);
    expect(resizeCaptureProblem(bad((n) => ({ ...n, computed: { 'background-color': 3 } })), 'mqr-nested~resize', 'authored', 2)).toMatch(/computed values that are not strings/);
    expect(resizeCaptureProblem({ ...good, samples: [{ size: { width: 1 } }] }, 'mqr-nested~resize', 'authored', 2)).toMatch(/sample 0 has no size or nodes/);
  });
});

describe('media rows (profile:rows from the resize lanes, T067 R13)', () => {
  const passing = resizeReport().passing.map((c) => ({ id: c.id, features: mediaFeatures(c.compiled) }));
  const rowsOf = <R extends { readonly context: string }>(rows: readonly R[]): R[] => rows.filter((r) => r.context === MEDIA_CONTEXT);
  it('are exactly what profile:rows derives from the passing resize cases, per target, and prove @media width and height natively', () => {
    expect(rowsOf(webProfile.rows)).toEqual(deriveMediaRows('web', passing));
    expect(rowsOf(iosProfile.rows)).toEqual(deriveMediaRows('ios', passing));
    expect(rowsOf(androidProfile.rows)).toEqual(deriveMediaRows('android', passing));
    for (const profile of [iosProfile, androidProfile]) {
      expect(rowsOf(profile.rows).map((r) => [r.feature, r.status, r.proofs.map((p) => [p.aspect, p.lane])])).toEqual(['at-rule:@media', 'media-feature:height', 'media-feature:width'].map((f) => [f, 'exact', [['layout', 'linux-dragon-layout']]]));
    }
  }, 600_000);
  it('name exactly the passing cases that use their key; a case without @media proves none', () => {
    for (const row of rowsOf(iosProfile.rows)) for (const p of row.proofs) expect(p.cases, row.feature).toEqual(passing.filter((c) => c.features.includes(row.feature)).map((c) => c.id));
    expect(mediaFeatures(byId('mqr-vw-relayout~resize').compiled)).toEqual([]);
  });
});
