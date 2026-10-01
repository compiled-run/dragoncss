// The Chrome pixel reference and the points protocol (notes/T015-p4-review-p5-plan.md section 4 item 5): one committed PNG per case
// per device DPR at the raster size rule, the manifest's sha256 and sizes, the glyph rule from engine data and the font's glyph boxes
// (Ahem only), the run file the apps read, and check (c) against the committed PNGs.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NativeProgram } from 'dragon';
import { chromeArgsAt, CHROME_VERSION } from '../src/chrome.ts';
import { DPRS } from '../src/dpr.ts';
import { readBreakVector } from '../src/line-breaks.ts';
import { readSamples } from '../src/native-compare.ts';
import { nativeCases } from '../src/native-host.ts';
import { repoPath } from '../src/paths.ts';
import type { PixelManifest } from '../src/pixel-reference.ts';
import type { BottomScanlines } from '../src/pixel-reference.ts';
import { PLANT_CASE } from '../src/device-run.ts';
import { ahemGlyphBoxes, BOTTOM_SCANLINES_PATH, casePoints, caseSamples, checkCasePixels, committedPixels, decodePng, expectedPixelsDir, expectedPixelsPath, glyphLines, PIXEL_MANIFEST, rasterSize, RASTER_RULE, runFileText } from '../src/pixel-reference.ts';
import { BACKEND_OF } from '../src/native-host.ts';
import { deviceDprs } from '../src/targets.ts';
import type { SamplePoint } from '../src/samples.ts';
import { generateGlyphSamples, GLYPH_EDGE_RULE, glyphClearance, ruleKind, SAMPLE_INSET_DEVICE_PX } from '../src/samples.ts';

const cases = nativeCases();
const I = SAMPLE_INSET_DEVICE_PX;

describe('committed Chrome pixels', () => {
  const manifest = JSON.parse(readFileSync(PIXEL_MANIFEST(), 'utf8')) as PixelManifest;
  it('the raster rule: ceil(viewport x DPR), so the 2.625 root of a 400x300 viewport is 1050x788', () => {
    expect(rasterSize({ width: 400, height: 300 }, 2.625)).toEqual({ width: 1050, height: 788 });
    expect(rasterSize({ width: 400, height: 300 }, 3)).toEqual({ width: 1200, height: 900 });
    expect(manifest.rasterRule).toBe(RASTER_RULE);
  });
  it('one PNG per case per device DPR, each at the raster size, with the manifest sha256, Chrome version and flags', () => {
    expect(manifest.chrome).toBe(CHROME_VERSION);
    expect(manifest.sets.map((s) => s.dpr)).toEqual([...DPRS]);
    for (const s of manifest.sets) {
      expect(s.flags).toEqual(chromeArgsAt(s.dpr));
      expect(s.cases.map((c) => c.case)).toEqual(cases.map((n) => n.case.id));
      expect(readdirSync(expectedPixelsDir(s.dpr)).filter((f) => f.endsWith('.png')).length).toBe(cases.length);
      for (const c of s.cases) {
        const png = readFileSync(expectedPixelsPath(c.case, s.dpr));
        expect(createHash('sha256').update(png).digest('hex'), `${c.case}@${s.dpr}`).toBe(c.sha256);
        const n = cases.find((x) => x.case.id === c.case);
        expect([c.width, c.height]).toEqual(Object.values(rasterSize(n?.case.environment.viewport ?? { width: 0, height: 0 }, s.dpr)));
      }
    }
  });
  it('the committed set is at most 50 MB', () => {
    const size = (dir: string): number => readdirSync(dir).reduce((n, f) => n + (statSync(join(dir, f)).isDirectory() ? size(join(dir, f)) : statSync(join(dir, f)).size), 0);
    expect(size(repoPath('packages/parity/expected-pixels'))).toBeLessThanOrEqual(50e6);
  });
  it('the PNG reader reads what Chrome wrote', () => {
    const img = decodePng(readFileSync(expectedPixelsPath('color-border-sides', 3)));
    expect([img.width, img.height, img.data.length]).toEqual([1200, 900, 1200 * 900 * 4]);
    expect([...img.data.slice(0, 4)]).toEqual([255, 255, 255, 255]);
  });
});

describe('the glyph rule', () => {
  it("Ahem's glyph boxes from the font: X is the em square, the space is blank", () => {
    const b = ahemGlyphBoxes();
    expect(b.get(0x58)).toEqual({ xMin: 0, yMin: -200, xMax: 1000, yMax: 800 });
    expect(b.get(0x20)).toBeNull();
  });
  it('interior points clear of every glyph edge by the inset; one scanline across the first left and the last right glyph edge', () => {
    const line = { id: 't:text0:line0', glyphs: [{ left: 10.25, right: 40.25, top: 5, bottom: 35 }, { left: 40.25, right: 70.25, top: 5, bottom: 35 }] };
    const pts = generateGlyphSamples([line], { width: 200, height: 100 });
    expect(generateGlyphSamples([line], { width: 200, height: 100 })).toEqual(pts);
    const interior = pts.filter((p) => ruleKind(p.rule) === 'glyph');
    expect(interior.map((p) => p.rule)).toEqual(['glyph:t:text0:line0:0', 'glyph:t:text0:line0:1']);
    line.glyphs.forEach((g, k) => {
      const p = interior[k];
      expect(p !== undefined && p.x >= g.left + I && p.x + 1 <= g.right - I && p.y >= g.top + I && p.y + 1 <= g.bottom - I).toBe(true);
    });
    const left = pts.filter((p) => p.rule === 'edge:t:text0:line0:glyph-left');
    const right = pts.filter((p) => p.rule === 'edge:t:text0:line0:glyph-right');
    expect(left[0]?.x).toBeLessThanOrEqual(10.25 - I - 1);
    expect(left[left.length - 1]?.x).toBeGreaterThanOrEqual(10.25 + I);
    expect(right[0]?.x).toBeGreaterThanOrEqual(70.25 + I);
    expect(right[right.length - 1]?.x).toBeLessThanOrEqual(70.25 - I - 1);
    expect(left.every((p, i) => i === 0 || p.x === (left[i - 1]?.x ?? 0) + 1)).toBe(true);
  });
  it('every case at every device DPR gets glyph points from engine data; text-wrap-spaces has them on every line inside the raster', () => {
    const n = cases.find((c) => c.case.id === 'text-wrap-spaces');
    if (n === undefined) throw new Error('no text-wrap-spaces');
    const pts = casePoints(n.programs.uikit, n.case.environment.viewport, 3);
    const lines = glyphLines(n.programs.uikit, n.case.environment.viewport, 3);
    expect(lines.length).toBe(readBreakVector('text-wrap-spaces', 3)?.texts.reduce((k, t) => k + t.lines.length, 0));
    const size = rasterSize(n.case.environment.viewport, 3);
    const inside = lines.filter((l) => l.glyphs.some((g) => g.right <= size.width && g.bottom <= size.height));
    expect(inside.length).toBeGreaterThan(0);
    for (const l of inside) expect(pts.some((p) => p.rule.startsWith(`glyph:${l.id}:`)), l.id).toBe(true);
    for (const l of lines.filter((x) => !inside.includes(x))) expect(pts.some((p) => p.rule.startsWith(`glyph:${l.id}:`)), l.id).toBe(false);
    expect(pts.filter((p) => p.rule.endsWith(':glyph-left')).length).toBeGreaterThan(0);
    for (const dpr of DPRS) for (const c of cases) expect(() => casePoints(c.programs.uikit, c.case.environment.viewport, dpr), `${c.case.id}@${dpr}`).not.toThrow();
  });
  it('refuses a family other than Ahem', () => {
    const n = cases.find((c) => c.case.id === 'text-wrap-spaces');
    if (n === undefined) throw new Error('no text-wrap-spaces');
    const other = JSON.parse(JSON.stringify(n.programs.uikit).replaceAll('"family":"Ahem"', '"family":"Inter"')) as NativeProgram;
    expect(() => glyphLines(other, n.case.environment.viewport, 3)).toThrow(/refuses the font family Inter/);
  });
});

describe('the glyph clearance over the corpus (T093 ruling A)', () => {
  // Per target and device DPR, the rules whose point no along-position keeps clear of the engine's glyph boxes, by rule kind
  // (edge:glyph is a glyph-edge scanline), and of those the edge and border rules that kept clear pixels as "<rule>:clear" colour
  // points (addendum F2). A change here changes what the device lanes compare; it needs a written reason. REPL-a: +4 edge
  // dropped and +4 rescued per DPR, the two edges of the text beside the replaced-demo cover in its ltr and rtl cases. FORM-a A3:
  // only the 10 controls cases' rules (their button text sits close to button edges): with them filtered out the old pins hold.
  const DROPPED = {
    ios: {
      2: { dropped: { edge: 1268, 'edge:glyph': 918, glyph: 31, clip: 4, border: 22, interior: 5 }, rescued: { edge: 1227 } },
      3: { dropped: { edge: 1275, 'edge:glyph': 880, glyph: 25, border: 24, interior: 5, clip: 2 }, rescued: { edge: 1245, border: 22 } },
    },
    android: {
      2: { dropped: { edge: 1268, 'edge:glyph': 918, glyph: 31, clip: 4, border: 22, interior: 5 }, rescued: { edge: 1227 } },
      3: { dropped: { edge: 1275, 'edge:glyph': 880, glyph: 25, border: 24, interior: 5, clip: 2 }, rescued: { edge: 1245, border: 22 } },
      2.625: { dropped: { edge: 1241, 'edge:glyph': 900, glyph: 33, outside: 6, clip: 13, border: 22, interior: 5 }, rescued: { edge: 1108 } },
    },
  } as const;
  const bottoms = JSON.parse(readFileSync(BOTTOM_SCANLINES_PATH(), 'utf8')) as BottomScanlines;
  for (const target of ['ios', 'android'] as const) {
    it(`${target}: dropped and rescued rules and per-case glyph-bottom scanlines are pinned; every point is clear of every glyph box edge but a glyph-edge scanline's own`, () => {
      const got: Record<string, { dropped: Record<string, number>; rescued: Record<string, number> }> = {};
      const gotBottoms: Record<string, Record<string, [number, number]>> = {};
      for (const dpr of deviceDprs(target)) {
        const dropped: Record<string, number> = {};
        const rescued: Record<string, number> = {};
        const perCase: Record<string, [number, number]> = {};
        for (const n of cases) {
          const p = n.programs[BACKEND_OF[target]];
          const r = caseSamples(p, n.case.environment.viewport, dpr);
          for (const d of r.dropped) {
            const k = `${ruleKind(d)}${GLYPH_EDGE_RULE.test(d) ? ':glyph' : ''}`;
            dropped[k] = (dropped[k] ?? 0) + 1;
          }
          for (const d of r.rescued) rescued[ruleKind(d)] = (rescued[ruleKind(d)] ?? 0) + 1;
          const lines = glyphLines(p, n.case.environment.viewport, dpr);
          const glyphs = lines.flatMap((l) => l.glyphs);
          const rules = new Set(r.points.map((q) => q.rule));
          const inked = lines.filter((l) => l.glyphs.length > 0);
          if (inked.length > 0) perCase[n.case.id] = [inked.filter((l) => rules.has(`edge:${l.id}:glyph-bottom`)).length, inked.length];
          const unclear = (q: SamplePoint) => glyphs.filter((g) => glyphClearance(q.x, q.y, g) < I).length;
          const scanlines = new Map<string, SamplePoint[]>();
          for (const q of r.points) {
            if (GLYPH_EDGE_RULE.test(q.rule)) scanlines.set(q.rule, [...(scanlines.get(q.rule) ?? []), q]);
            else if (unclear(q) > 0) throw new Error(`${target} ${n.case.id}@${dpr}: ${q.rule} at ${q.x},${q.y} is within ${I} device px of a glyph box edge`);
          }
          for (const [rule, line] of scanlines) {
            const ends = [line[0], line[line.length - 1]] as SamplePoint[];
            if (ends.some((q) => unclear(q) > 0) || line.some((q) => unclear(q) > 1)) throw new Error(`${target} ${n.case.id}@${dpr}: ${rule} is not clear of the other glyph boxes`);
          }
        }
        got[String(dpr)] = { dropped, rescued };
        gotBottoms[String(dpr)] = perCase;
        // The plant case has a glyph-bottom scanline and an x centre pair on every line (addendum F1).
        const plant = cases.find((c) => c.case.id === PLANT_CASE);
        if (plant === undefined) throw new Error(`no plant case ${PLANT_CASE}`);
        const plantLines = glyphLines(plant.programs[BACKEND_OF[target]], plant.case.environment.viewport, dpr).filter((l) => l.glyphs.length > 0);
        const plantRules = new Set(casePoints(plant.programs[BACKEND_OF[target]], plant.case.environment.viewport, dpr).map((q) => q.rule));
        expect(plantLines.length).toBeGreaterThan(0);
        for (const l of plantLines) for (const side of ['bottom', 'left', 'right']) expect(plantRules.has(`edge:${l.id}:glyph-${side}`), `${PLANT_CASE}@${dpr} ${l.id} glyph-${side}`).toBe(true);
      }
      expect(got).toEqual(JSON.parse(JSON.stringify(DROPPED[target])));
      // Regenerate with pnpm run parity:glyph-b3 -- --write-bottom-pins, and give a written reason for every change.
      expect(gotBottoms).toEqual(bottoms[target]);
    });
  }
});

describe('the points protocol and check (c)', () => {
  it('the run file names the cases in order, then each point, then the hold flag; a tab in an id is refused', () => {
    expect(runFileText([{ id: 'a', points: [{ x: 1, y: 2, rule: 'interior:n1' }] }, { id: 'b#0', points: [] }], true)).toBe('case\ta\npoint\ta\t1\t2\tinterior:n1\ncase\tb#0\nhold\t1\n');
    expect(() => runFileText([{ id: 'a\tb', points: [] }], false)).toThrow(/tab or newline/);
  });
  it("samples read from Chrome's own PNG pass (c); a capture of the wrong size fails before any colour", () => {
    const n = cases.find((c) => c.case.id === 'color-border-sides');
    const img = committedPixels('color-border-sides', 2.625);
    if (n === undefined || img === null) throw new Error('no color-border-sides pixels');
    const pts = casePoints(n.programs['android-views'], n.case.environment.viewport, 2.625);
    const want = rasterSize(n.case.environment.viewport, 2.625);
    expect(checkCasePixels(readSamples(img, pts), pts, img, want, want).problems).toEqual([]);
    expect(checkCasePixels(readSamples(img, pts), pts, img, want, { width: 1050, height: 787 }).problems).toEqual(['the native capture is 1050x787, the raster rule 1050x788']);
  });
});
