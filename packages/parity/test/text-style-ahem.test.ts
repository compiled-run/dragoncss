// TXT-W synthetic oblique on the host: text-style-ahem against the committed Chrome PNGs at every device DPR. Chrome draws Ahem's one
// regular face sheared by Skia's skewX(-1/4) where the computed slope is 14deg or more and font-synthesis-style allows it; native
// draws the glyphs the program's synthetic-oblique write shears (dragon emit/native-support.ts DragonTextView). The model is what the
// device draws: each glyph box sheared about its baseline origin by the write's shear, black on the white page. Every pixel the model
// covers fully must be Chrome's ink and every pixel it leaves clear must be Chrome's background, so where Chrome shears, by how much
// and about which origin are proven before any device runs. The ahemObliqueUnsheared plant (no shear write) must fail.
// Chrome on darwin grows every glyph edge by a fraction of a device px (the fringe of T093 addendum F1), upright or sheared, so the
// device lanes' points keep SAMPLE_INSET_DEVICE_PX off every glyph edge: a sheared glyph's slanted sides run through its bounding box,
// and its points keep off those sides too. Check (c) of the drawn model (the model at exact coverage) against Chrome must pass on the
// device points; with each sheared glyph taken as its bounding box it must fail.
import { describe, expect, it } from 'vitest';
import type { CompilerFaults, NativeProgram } from 'dragon';
import { createProjectWith, nativePrograms, NO_FAULTS } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import { NATIVE_CONFIG } from '../src/native-compile.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { readSamples } from '../src/native-compare.ts';
import { caseBoxes, checkCasePixels, committedPixels, devicePoints, glyphLines, glyphShears, rasterSize, uprightGlyphLines } from '../src/pixel-reference.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { sampleBoxes, sampleGlyphs } from '../src/samples.ts';

const CASE = 'text-style-ahem';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
/** The texts Chrome shears: the computed slope is 14deg or more and font-synthesis-style is auto (text-style-ahem.html). */
const SHEARED = ['it', 'ob', 'o14', 'o20', 'o90', 'orad', 'sa', 'wa', 'fs', 'fws', 'em', 'i', 'sp', 'rb', 'ca', 'arow'].map((id) => `${id}:text0`).sort();
/** The model judges a pixel only when it is this far (device px) inside a sheared glyph or clear of every one. */
const MARGIN = 1;

function compile(spec: FixtureSpec, direction: 'ltr' | 'rtl', faults: CompilerFaults) {
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.kind === 'layout' ? spec.rootFont : 'ahem', foldViewport: ENVIRONMENT.viewport, interactionLanes: true });
  return project.compile(fixtureInput(spec));
}

/** One glyph as the device draws it: its upright box (device px), the baseline it is sheared about and the shear. */
type Ink = { readonly left: number; readonly right: number; readonly top: number; readonly bottom: number; readonly baseline: number; readonly k: number };

function inks(p: NativeProgram, dpr: number): Ink[] {
  const shears = glyphShears(p);
  return uprightGlyphLines(p, ENVIRONMENT.viewport, dpr).flatMap((l) => {
    const k = shears.get(l.id.slice(0, l.id.lastIndexOf(':line'))) ?? 0;
    return l.glyphs.map((g) => ({ ...g, baseline: l.baseline, k }));
  });
}

/** The ink's x range at a device y (x moves by k times the height above the baseline). */
const span = (g: Ink, y: number): readonly [number, number] => [g.left + g.k * (g.baseline - y), g.right + g.k * (g.baseline - y)];

/** Whether the pixel [x, x + 1) x [y, y + 1) is at least m inside the sheared glyph (the x range is linear in y, so its two rows bound it). */
function inside(g: Ink, x: number, y: number, m: number): boolean {
  if (y < g.top + m || y + 1 > g.bottom - m) return false;
  return [y, y + 1].every((yy) => {
    const [l, r] = span(g, yy);
    return x >= l + m && x + 1 <= r - m;
  });
}

/** Whether the pixel grown by m misses the sheared glyph. */
function clear(g: Ink, x: number, y: number, m: number): boolean {
  const y0 = Math.max(y - m, g.top);
  const y1 = Math.min(y + 1 + m, g.bottom);
  if (y0 >= y1) return true;
  const [l0, r0] = span(g, y0);
  const [l1, r1] = span(g, y1);
  return x + 1 + m <= Math.min(l0, l1) || x - m >= Math.max(r0, r1);
}

/** Every pixel the model judges, against Chrome's: [mismatches, judged ink pixels of sheared glyphs, judged background pixels]. */
function judge(chrome: RgbaImage, glyphs: readonly Ink[]): { readonly mismatches: string[]; readonly shearedInk: number; readonly background: number } {
  const mismatches: string[] = [];
  let shearedInk = 0;
  let background = 0;
  for (let y = 0; y < chrome.height; y++) {
    for (let x = 0; x < chrome.width; x++) {
      const i = (y * chrome.width + x) * 4;
      const rgb = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2]].join();
      const hit = glyphs.find((g) => inside(g, x, y, MARGIN));
      if (hit !== undefined) {
        if (hit.k !== 0) shearedInk++;
        if (rgb !== '0,0,0') mismatches.push(`${x},${y}: ink expected, Chrome has ${rgb}`);
      } else if (glyphs.every((g) => clear(g, x, y, MARGIN))) {
        background++;
        if (rgb !== '255,255,255') mismatches.push(`${x},${y}: background expected, Chrome has ${rgb}`);
      }
    }
  }
  return { mismatches, shearedInk, background };
}

describe('TXT-W: text-style-ahem\'s sheared glyphs equal the committed Chrome pixels', () => {
  it('is a layout fixture in both directions', () => {
    expect(SPEC?.kind).toBe('layout');
  });
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}; the ahemObliqueUnsheared plant fails`, () => {
      const programOf = (faults: CompilerFaults): NativeProgram => {
        const compiled = compile(SPEC, c.environment.direction, faults);
        expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`)).toEqual([]);
        const p = nativePrograms(compiled, c.assignment);
        if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
        // The two backends shear the same texts by the same amount (each write's key and detail name its own backend's call).
        const shears = (prog: NativeProgram): string[] => prog.nodes.flatMap((n) => n.writes.flatMap((w) => (w.kind === 'synthetic-oblique' ? [`${n.id} ${w.shear}`] : [])));
        expect(shears(p.programs['android-views'])).toEqual(shears(p.programs.uikit));
        return p.programs.uikit;
      };
      const real = programOf(NO_FAULTS);
      const planted = programOf({ ...NO_FAULTS, ahemObliqueUnsheared: true });
      expect([...glyphShears(real).keys()].sort()).toEqual(SHEARED);
      expect([...glyphShears(real).values()].every((k) => k === 0.25)).toBe(true);
      expect(glyphShears(planted).size).toBe(0);
      for (const dpr of DPRS) {
        const chrome = committedPixels(c.id, dpr);
        if (chrome === null) throw new Error(`${c.id}: no committed Chrome PNG at DPR ${dpr}`);
        const r = judge(chrome, inks(real, dpr));
        expect(r.mismatches.slice(0, 10), `DPR ${dpr}`).toEqual([]);
        // Each sheared text holds at least one Ahem box of 10 css px, most of which the model judges.
        expect(r.shearedInk, `DPR ${dpr}`).toBeGreaterThan(SHEARED.length * 40 * dpr * dpr);
        expect(r.background, `DPR ${dpr}`).toBeGreaterThan(chrome.width * chrome.height / 2);
        expect(judge(chrome, inks(planted, dpr)).mismatches.length, `DPR ${dpr} plant`).toBeGreaterThan(SHEARED.length * 10);
      }
    }, 300_000);
  }
});

/** The model drawn at exact coverage (an 8 x 8 grid per device px), black ink on white, as the device draws it. */
function drawn(p: NativeProgram, dpr: number): RgbaImage {
  const { width, height } = rasterSize(ENVIRONMENT.viewport, dpr);
  const S = 8;
  const hits = new Uint16Array(width * height);
  for (const g of inks(p, dpr)) {
    for (let y = Math.max(0, Math.floor(g.top)); y < Math.min(height, Math.ceil(g.bottom)); y++) {
      for (let sy = 0; sy < S; sy++) {
        const yy = y + (sy + 0.5) / S;
        if (yy < g.top || yy >= g.bottom) continue;
        const [l, r] = span(g, yy);
        for (let x = Math.max(0, Math.floor(l)); x < Math.min(width, Math.ceil(r)); x++) {
          for (let sx = 0; sx < S; sx++) {
            const xx = x + (sx + 0.5) / S;
            if (xx >= l && xx < r) hits[y * width + x] = (hits[y * width + x] as number) + 1;
          }
        }
      }
    }
  }
  const data = new Uint8Array(width * height * 4);
  hits.forEach((h, i) => {
    const v = Math.round(255 * (1 - Math.min(1, h / (S * S))));
    data.set([v, v, v, 255], i * 4);
  });
  return { width, height, data };
}

describe('TXT-W: the device points keep off the slanted sides of text-style-ahem\'s sheared glyphs', () => {
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id}: check (c) of the drawn model against Chrome passes on the device points at ${DPRS.join(', ')}, and fails on bounding boxes`, () => {
      const p = nativePrograms(compile(SPEC, c.environment.direction, NO_FAULTS), c.assignment);
      if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
      for (const prog of [p.programs.uikit, p.programs['android-views']]) {
        for (const dpr of DPRS) {
          const chrome = committedPixels(c.id, dpr);
          if (chrome === null) throw new Error(`${c.id}: no committed Chrome PNG at DPR ${dpr}`);
          const size = rasterSize(ENVIRONMENT.viewport, dpr);
          const model = drawn(prog, dpr);
          const points = devicePoints(prog, ENVIRONMENT.viewport, dpr);
          const r = checkCasePixels(readSamples(model, points), points, chrome, size, size);
          expect(r.problems, `${prog.backend} DPR ${dpr}`).toEqual([]);
          expect(r.compared, `${prog.backend} DPR ${dpr}`).toBeGreaterThan(500);
          // The same rules with each sheared glyph as its bounding box: points on the slanted sides compare Chrome's fringe.
          const boxed = glyphLines(prog, ENVIRONMENT.viewport, dpr).map((l) => ({ id: l.id, glyphs: l.glyphs.map(({ left, top, right, bottom }) => ({ left, top, right, bottom })) }));
          const plain = [...sampleBoxes(caseBoxes(prog, ENVIRONMENT.viewport, dpr), size, boxed.flatMap((l) => l.glyphs)).points, ...sampleGlyphs(boxed, size).points];
          expect(checkCasePixels(readSamples(model, plain), plain, chrome, size, size).problems.length, `${prog.backend} DPR ${dpr} bounding boxes`).toBeGreaterThan(0);
        }
      }
    }, 300_000);
  }
});
