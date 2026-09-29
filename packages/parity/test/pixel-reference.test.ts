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
import { ahemGlyphBoxes, casePoints, checkCasePixels, committedPixels, decodePng, expectedPixelsDir, expectedPixelsPath, glyphLines, PIXEL_MANIFEST, rasterSize, RASTER_RULE, runFileText } from '../src/pixel-reference.ts';
import { generateGlyphSamples, ruleKind, SAMPLE_INSET_DEVICE_PX } from '../src/samples.ts';

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
