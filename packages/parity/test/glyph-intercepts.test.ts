// TDEC-d for pinned faces (layout glyph-intercepts.ts), offline: the glyf reader against the faces' own glyph bounds, the gap
// of Skia's calculate_path_gap on shapes worked by hand, and Ahem's intercepts from its outlines against its ink boxes, which
// the committed Ahem skip-ink captures prove. The live Chrome proof over Lato is decoration-skip-ink.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { glyphIntercepts as gi } from '@dragon/layout';
import { checkDecorations, committedDecorations, DECORATION_DPRS, decorationCases, predictDecorations } from '../src/decoration-capture.ts';
import { repoPath } from '../src/paths.ts';

const bytesOf = (file: string): number[] => Array.from(readFileSync(repoPath(file)));
const u16 = (b: readonly number[], i: number): number => (b[i] as number) * 256 + (b[i + 1] as number);
const i16 = (b: readonly number[], i: number): number => (u16(b, i) >= 32768 ? u16(b, i) - 65536 : u16(b, i));

/** The glyf header bounds [xMin, yMin, xMax, yMax] of every glyph with outlines, by glyph id, and the count of glyphs. */
function glyfBounds(b: readonly number[]): { readonly count: number; readonly bounds: Map<number, number[]> } {
  const tables = new Map<string, number>();
  for (let i = 0; i < u16(b, 4); i++) tables.set(String.fromCharCode(...b.slice(12 + i * 16, 16 + i * 16)), u16(b, 20 + i * 16) * 65536 + u16(b, 22 + i * 16));
  const head = tables.get('head') as number;
  const loca = tables.get('loca') as number;
  const glyf = tables.get('glyf') as number;
  const count = u16(b, (tables.get('maxp') as number) + 4);
  const long = i16(b, head + 50) === 1;
  const at = (g: number): number => (long ? u16(b, loca + g * 4) * 65536 + u16(b, loca + g * 4 + 2) : u16(b, loca + g * 2) * 2);
  const bounds = new Map<number, number[]>();
  for (let g = 0; g < count; g++) {
    if (at(g + 1) <= at(g)) continue;
    const o = glyf + at(g);
    bounds.set(g, [i16(b, o + 2), i16(b, o + 4), i16(b, o + 6), i16(b, o + 8)]);
  }
  return { count, bounds };
}

/** Whether a glyph is a composite with a component carrying WE_HAVE_A_SCALE, an x and y scale or a two by two. */
function isScaledComposite(b: readonly number[], glyph: number): boolean {
  const tables = new Map<string, number>();
  for (let i = 0; i < u16(b, 4); i++) tables.set(String.fromCharCode(...b.slice(12 + i * 16, 16 + i * 16)), u16(b, 20 + i * 16) * 65536 + u16(b, 22 + i * 16));
  const long = i16(b, (tables.get('head') as number) + 50) === 1;
  const loca = tables.get('loca') as number;
  const o = (tables.get('glyf') as number) + (long ? u16(b, loca + glyph * 4) * 65536 + u16(b, loca + glyph * 4 + 2) : u16(b, loca + glyph * 2) * 2);
  if (i16(b, o) >= 0) return false;
  let at = o + 10;
  let scaled = false;
  for (;;) {
    const flags = u16(b, at);
    at += 4 + ((flags & 1) !== 0 ? 4 : 2);
    if ((flags & 0x08) !== 0) at += 2;
    else if ((flags & 0x40) !== 0) at += 4;
    else if ((flags & 0x80) !== 0) at += 8;
    if ((flags & 0xc8) !== 0) scaled = true;
    if ((flags & 0x20) === 0) return scaled;
  }
}

describe('TDEC-d glyph intercepts over glyf outlines', () => {
  it("reads every Lato and Ahem glyph's contours, whose points span the glyph's glyf bounds", () => {
    for (const file of ['vendor/fonts/Lato/Lato-Regular.ttf', 'vendor/fonts/Lato/Lato-Bold.ttf', 'vendor/fonts/Ahem.ttf']) {
      const b = bytesOf(file);
      expect(gi.glyfUnitsPerEm(b), file).toBeGreaterThan(0);
      const { count, bounds } = glyfBounds(b);
      let read = 0;
      const unread: number[] = [];
      for (let g = 0; g < count; g++) {
        const segs = gi.glyfOutline(b, g);
        if (segs === null) {
          unread.push(g);
          continue;
        }
        read++;
        const want = bounds.get(g);
        if (want === undefined) {
          expect(segs, `${file} ${g}`).toEqual([]);
          continue;
        }
        // Each contour is its point count, then x, y and on-curve per point; the points span the glyph's glyf bounds.
        const xs: number[] = [];
        const ys: number[] = [];
        for (let i = 0; i < segs.length; ) {
          const n = segs[i] as number;
          expect(n, `${file} glyph ${g}`).toBeGreaterThan(0);
          for (let k = 0; k < n; k++) {
            xs.push(segs[i + 1 + k * 3] as number);
            ys.push(segs[i + 2 + k * 3] as number);
          }
          i += 1 + n * 3;
        }
        expect([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], `${file} glyph ${g}`).toEqual(want);
      }
      // The few glyphs left unread are composites with a component scale (the caller refuses them); none is a Latin letter.
      expect(read + unread.length, file).toBe(count);
      expect(unread.length, file).toBeLessThanOrEqual(2);
      expect(unread.every((g) => isScaledComposite(b, g)), `${file} ${unread.join(', ')}`).toBe(true);
    }
  });

  it('takes the gap of a square and of a quad bowl as calculate_path_gap does', () => {
    // A 1000-unit square at 64 px is 64 px wide, y from -64 to 0: a band inside it crosses both sides.
    const square = [4, 0, 0, 1, 1000, 0, 1, 1000, 1000, 1, 0, 1000, 1];
    expect(gi.glyphGap(square, 1000, -40, -20, gi.NO_INTERCEPT_FAULTS)).toEqual([0, 64]);
    expect(gi.glyphGap(square, 1000, 2, 4, gi.NO_INTERCEPT_FAULTS)).toEqual([]);
    // A bowl from (0, 0) through (500, -1000) to (1000, 0) font units is, at 64 px with y down, x = 64 t and y = 128 t (1 - t),
    // 32 px deep: the band [16, 24] is widest at its top edge, where t = 0.5 -+ sqrt(0.25 - 16 / 128).
    const bowl = [3, 0, 0, 1, 500, -1000, 0, 1000, 0, 1];
    const gap = gi.glyphGap(bowl, 1000, 16, 24, gi.NO_INTERCEPT_FAULTS);
    expect(gap[0]).toBeCloseTo(64 * (0.5 - Math.sqrt(0.25 - 16 / 128)), 4);
    expect(gap[1]).toBeCloseTo(64 * (0.5 + Math.sqrt(0.25 - 16 / 128)), 4);
    // The planted ink-box fault takes the whole x extent instead.
    expect(gi.glyphGap(bowl, 1000, 16, 24, { ...gi.NO_INTERCEPT_FAULTS, inkBoxNotOutline: true })).toEqual([0, 64]);
  });

  it("Ahem's intercepts from its glyf outlines clip exactly what its ink boxes do, and match the committed Ahem skip-ink captures", () => {
    const WHITE = { r: 255, g: 255, b: 255, a: 255 };
    let clipped = 0;
    for (const { fixture, case: c } of decorationCases().filter((x) => x.fixture.spec.id === 'text-decoration-ahem-auto' || x.fixture.spec.id === 'text-decoration-ahem-skip')) {
      for (const dpr of DECORATION_DPRS) {
        const boxes = predictDecorations(fixture, c, dpr);
        const outlines = predictDecorations(fixture, c, dpr, undefined, undefined, undefined, true);
        if (boxes.kind !== 'rects' || outlines.kind !== 'rects') throw new Error(`${c.id}@${dpr} refused`);
        expect(outlines.rects.map((r) => r.clips), `${c.id}@${dpr}`).toEqual(boxes.rects.map((r) => r.clips));
        clipped += outlines.rects.filter((r) => r.clips.length > 0).length;
        const cap = committedDecorations(c.id, dpr);
        if (cap === null) throw new Error(`${c.id}@${dpr} is not captured`);
        const r = checkDecorations(cap.decorated, cap.stripped, outlines.rects, WHITE);
        expect(r.problems, `${c.id}@${dpr}`).toEqual([]);
      }
    }
    expect(clipped).toBeGreaterThan(50);
  }, 600_000);
});
