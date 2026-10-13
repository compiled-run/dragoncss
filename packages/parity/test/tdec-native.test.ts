// TDEC-b on the host (notes/T148J-tdec.md): text-decoration-native's decoration points against the committed Chrome PNGs at every
// device DPR. The model is what the device draws (dragon emit/paint/text-decoration.ts): the page background, then each under and
// overline rect, then the Ahem glyphs, then each line-through rect, where a rect covers the rows of placedDecorations and the
// columns columnAlpha fully covers outside its skip-ink clips, and a covered pixel is the rect's colour blended as Skia blends it
// (blendOver). Every decoration point must equal Chrome exactly, so the rows, the paint order, the skip-ink gaps and the
// transparent line are proven before any device runs. Each raster plant of the module (device-run.ts PLANT_CASES) has a model
// that must fail at every device DPR: decoration-above-text paints the under and overlines after the glyphs, decoration-snap-css-px
// moves each rect's top to a whole css px, decoration-alpha-ignored paints each line opaque.
import { describe, expect, it } from 'vitest';
import { textDecoration as td } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { nativePrograms } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { PLANT_CASES } from '../src/device-run.ts';
import { DPRS } from '../src/dpr.ts';
import { FIXTURE_GROUPS } from '../src/fixtures.ts';
import { nativeCompile } from '../src/native-host.ts';
import type { PlacedDecoration } from '../src/paint-samples/decoration-rects.ts';
import { placedDecorations } from '../src/paint-samples/decoration-rects.ts';
import { casePoints, committedPixels, glyphLines } from '../src/pixel-reference.ts';
import type { GlyphBox } from '../src/samples.ts';

const CASE = 'text-decoration-native';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
const PLANTS = ['decoration-above-text', 'decoration-snap-css-px', 'decoration-alpha-ignored'] as const;
type Plant = (typeof PLANTS)[number] | null;

const WHITE: td.Rgba = { r: 255, g: 255, b: 255, a: 255 };
/** The fixture's text colour: the initial black. */
const INK: td.Rgba = { r: 0, g: 0, b: 0, a: 255 };

const insideGlyph = (x: number, y: number, glyphs: readonly GlyphBox[]): boolean => glyphs.some((g) => x >= g.left && x + 1 <= g.right && y >= g.top && y + 1 <= g.bottom);

/** The rects as a plant places them. */
function plantedRects(rects: readonly PlacedDecoration[], dpr: number, plant: Plant): PlacedDecoration[] {
  return rects.map((r) => {
    if (plant === 'decoration-snap-css-px') return { ...r, top: Math.floor(Math.round(r.top / dpr) * dpr) };
    if (plant === 'decoration-alpha-ignored') return { ...r, color: { ...r.color, a: 255 } };
    return r;
  });
}

/** The model's colour at a pixel: the background, the before-text rects, the glyphs, the line-throughs. */
function modelAt(rects: readonly PlacedDecoration[], glyphs: readonly GlyphBox[], x: number, y: number, plant: Plant): td.Rgba {
  const covers = (r: PlacedDecoration): boolean => y >= r.top && y < r.top + r.height && td.columnAlpha(x, r.left, r.right, r.height) === 256 && !td.columnClipped(x, r.clips);
  const before = rects.filter((r) => r.beforeText);
  const after = rects.filter((r) => !r.beforeText);
  // The decoration-above-text plant puts the under and overline views above the text view, beneath the line-throughs.
  const under = plant === 'decoration-above-text' ? [] : before;
  const over = plant === 'decoration-above-text' ? [...before, ...after] : after;
  let c = WHITE;
  for (const r of under) if (covers(r)) c = td.blendOver(c, r.color, 256);
  if (insideGlyph(x, y, glyphs)) c = INK;
  for (const r of over) if (covers(r)) c = td.blendOver(c, r.color, 256);
  return c;
}

describe('TDEC-b: text-decoration-native\'s decoration points equal the committed Chrome pixels', () => {
  it('is a layout fixture of the text-decoration group whose cases are the plant cases', () => {
    expect(SPEC?.kind).toBe('layout');
    for (const p of PLANTS) expect(PLANT_CASES[p]).toEqual([CASE]);
  });
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}`, () => {
      const compiled = nativeCompile(SPEC, c.environment.direction);
      expect(compiled.diagnostics.filter((d) => d.message.includes('text-decoration')), 'decoration refusals').toEqual([]);
      const programs = nativePrograms(compiled, c.assignment);
      if (programs.kind !== 'ready') throw new Error(programs.reason);
      const p: NativeProgram = programs.programs.uikit;
      const problems: string[] = [];
      const states = new Set<string>();
      for (const dpr of DPRS) {
        const chrome = committedPixels(c.id, dpr);
        if (chrome === null) throw new Error(`${c.id}@${dpr}: no committed Chrome PNG`);
        const rects = placedDecorations(p, c.environment.viewport, dpr);
        const glyphs = glyphLines(p, c.environment.viewport, dpr).flatMap((l) => l.glyphs);
        const caught = new Map<string, number>(PLANTS.map((x) => [x, 0]));
        const points = casePoints(p, c.environment.viewport, dpr).filter((q) => q.rule.startsWith('decoration:'));
        for (const q of points) {
          states.add(q.rule.slice(q.rule.lastIndexOf(':') + 1));
          const i = (q.y * chrome.width + q.x) * 4;
          const got = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2]];
          const differs = (m: td.Rgba): boolean => got[0] !== m.r || got[1] !== m.g || got[2] !== m.b;
          const want = modelAt(rects, glyphs, q.x, q.y, null);
          if (differs(want)) problems.push(`${q.rule} at ${q.x},${q.y} @${dpr}: Chrome ${JSON.stringify(got)}, model ${JSON.stringify(want)}`);
          for (const plant of PLANTS) if (differs(modelAt(plantedRects(rects, dpr, plant), glyphs, q.x, q.y, plant))) caught.set(plant, (caught.get(plant) ?? 0) + 1);
        }
        expect(points.length, `decoration points @${dpr}`).toBeGreaterThan(0);
        for (const plant of PLANTS) expect(caught.get(plant), `${plant} @${dpr}`).toBeGreaterThan(0);
      }
      expect(problems).toEqual([]);
      // Rows beside and inside the lines, under and over glyphs (the paint order), and skip-ink gaps.
      for (const s of ['row', 'above', 'below', 'ink', 'gap']) expect(states.has(s), s).toBe(true);
    });
  }
});
