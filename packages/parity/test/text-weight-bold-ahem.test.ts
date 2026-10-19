// TXT-W synthetic bold on the host: text-weight-bold-ahem against the committed Chrome PNGs at every device DPR. Chrome draws Ahem's one
// regular face in Skia's fake bold where the computed weight is 600 or more and font-synthesis-weight allows it: each outline stroked
// and filled with a miter join at size * scale (1/24 to 9px, 1/32 from 36px), so an Ahem box grows by half that width on every side;
// native strokes the glyphs the program's synthetic-bold write names (dragon emit/native-support.ts DragonTextView). The model is what
// the device draws: glyphLines' boxes, grown by the write, black on the white page. Every pixel the model covers fully must be Chrome's
// ink and every pixel it leaves clear must be Chrome's background, and each emboldened edge must sit where Chrome's partial pixel puts
// it, so where Chrome emboldens and by how much are proven before any device runs. The ahemBoldUnstroked and ahemSyntheticBoldFrom700
// plants must fail.
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
import { committedPixels, glyphBolds, glyphLines } from '../src/pixel-reference.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import type { GlyphBox } from '../src/samples.ts';

const CASE = 'text-weight-bold-ahem';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
/** The texts Chrome emboldens: the computed weight is 600 or more and font-synthesis-weight is auto (text-weight-bold-ahem.html). */
const BOLD = ['kb', 'w700', 'w600', 'w900', 'w1000', 'sa', 'fw', 'bd', 'b', 'strong', 'sp', 'rb', 'ca', 'arow', 'g96', 'g64', 'g40', 'g24', 'g16'].map((id) => `${id}:text0`).sort();
/** The texts at weight 600 to 699, which the ahemSyntheticBoldFrom700 plant leaves unemboldened. */
const W600 = ['w600', 'sp', 'g64'].map((id) => `${id}:text0`).sort();
/** The model judges a pixel only when it is this far (device px) inside a glyph box or clear of every one. */
const MARGIN = 1;

function compile(spec: FixtureSpec, direction: 'ltr' | 'rtl', faults: CompilerFaults) {
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.kind === 'layout' ? spec.rootFont : 'ahem', foldViewport: ENVIRONMENT.viewport, interactionLanes: true });
  return project.compile(fixtureInput(spec));
}

/** One glyph as the device draws it (device px) and whether its text is emboldened. */
type Ink = GlyphBox & { readonly bold: boolean };

function inks(p: NativeProgram, dpr: number): Ink[] {
  const bolds = glyphBolds(p);
  return glyphLines(p, ENVIRONMENT.viewport, dpr).flatMap((l) => l.glyphs.map((g) => ({ ...g, bold: bolds.has(l.id.slice(0, l.id.lastIndexOf(':line'))) })));
}

/**
 * Every pixel the model judges, against Chrome's: [mismatches, judged ink pixels of emboldened glyphs, judged background pixels]. A pixel
 * at least m inside a box must be black; a pixel whose square grown by m misses every box must be white.
 */
function judge(chrome: RgbaImage, glyphs: readonly Ink[], m: number): { readonly mismatches: string[]; readonly boldInk: number; readonly background: number } {
  const { width, height, data } = chrome;
  const rgb = (x: number, y: number): string => {
    const i = (y * width + x) * 4;
    return `${data[i]},${data[i + 1]},${data[i + 2]}`;
  };
  const near = new Uint8Array(width * height);
  const mismatches: string[] = [];
  let boldInk = 0;
  for (const g of glyphs) {
    // The pixels whose square grown by m reaches the box: x + 1 + m > left and x - m < right.
    for (let y = Math.max(0, Math.floor(g.top - m - 1) + 1); y < Math.min(height, Math.ceil(g.bottom + m)); y++) {
      for (let x = Math.max(0, Math.floor(g.left - m - 1) + 1); x < Math.min(width, Math.ceil(g.right + m)); x++) near[y * width + x] = 1;
    }
    for (let y = Math.max(0, Math.ceil(g.top + m)); y + 1 <= g.bottom - m && y < height; y++) {
      for (let x = Math.max(0, Math.ceil(g.left + m)); x + 1 <= g.right - m && x < width; x++) {
        if (g.bold) boldInk++;
        if (rgb(x, y) !== '0,0,0') mismatches.push(`${x},${y}: ink expected, Chrome has ${rgb(x, y)}`);
      }
    }
  }
  let background = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (near[y * width + x] === 1) continue;
      background++;
      if (rgb(x, y) !== '255,255,255') mismatches.push(`${x},${y}: background expected, Chrome has ${rgb(x, y)}`);
    }
  }
  return { mismatches, boldInk, background };
}

/**
 * Where Chrome's ink ends along one row or column through a glyph's middle, in device px: the last fully black pixel's far edge plus the
 * coverage of the partial pixel after it (255 minus its grey, over 255). Gamma and antialiasing move a partial pixel's grey, so this is
 * an estimate within one pixel of the edge, which is all the check below asks of it.
 */
function inkEdge(chrome: RgbaImage, from: number, fixed: number, step: 1 | -1, horizontal: boolean): number {
  const at = (k: number): number => {
    const [x, y] = horizontal ? [k, fixed] : [fixed, k];
    return chrome.data[(y * chrome.width + x) * 4] as number;
  };
  let k = from;
  while (at(k + step) === 0) k += step;
  const partial = 1 - at(k + step) / 255;
  return step === 1 ? k + 1 + partial : k - partial;
}

describe('TXT-W: text-weight-bold-ahem\'s emboldened glyphs equal the committed Chrome pixels', () => {
  it('is a layout fixture in both directions', () => {
    expect(SPEC?.kind).toBe('layout');
  });
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}; the ahemBoldUnstroked and ahemSyntheticBoldFrom700 plants fail`, () => {
      const programOf = (faults: CompilerFaults): NativeProgram => {
        const compiled = compile(SPEC, c.environment.direction, faults);
        expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`)).toEqual([]);
        const p = nativePrograms(compiled, c.assignment);
        if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
        // The two backends embolden the same texts by the same rule (each write's key and detail name its own backend's call).
        const bolds = (prog: NativeProgram): string[] => [...glyphBolds(prog)].map(([id, b]) => `${id} ${b.keys.join()} ${b.values.join()}`);
        expect(bolds(p.programs['android-views'])).toEqual(bolds(p.programs.uikit));
        return p.programs.uikit;
      };
      const real = programOf(NO_FAULTS);
      const unstroked = programOf({ ...NO_FAULTS, ahemBoldUnstroked: true });
      const from700 = programOf({ ...NO_FAULTS, ahemSyntheticBoldFrom700: true });
      expect([...glyphBolds(real).keys()].sort()).toEqual(BOLD);
      expect(glyphBolds(unstroked).size).toBe(0);
      expect([...glyphBolds(from700).keys()].sort()).toEqual(BOLD.filter((id) => !W600.includes(id)));
      for (const dpr of DPRS) {
        const chrome = committedPixels(c.id, dpr);
        if (chrome === null) throw new Error(`${c.id}: no committed Chrome PNG at DPR ${dpr}`);
        const glyphs = inks(real, dpr);
        const r = judge(chrome, glyphs, MARGIN);
        expect(r.mismatches.slice(0, 10), `DPR ${dpr}`).toEqual([]);
        // Each emboldened text holds at least one Ahem box of 10 css px, most of which the model judges.
        expect(r.boldInk, `DPR ${dpr}`).toBeGreaterThan(BOLD.length * 40 * dpr * dpr);
        expect(r.background, `DPR ${dpr}`).toBeGreaterThan((chrome.width * chrome.height) / 2);
        expect(judge(chrome, inks(unstroked, dpr), MARGIN).mismatches.length, `DPR ${dpr} unstroked plant`).toBeGreaterThan(100 * dpr);
        expect(judge(chrome, inks(from700, dpr), MARGIN).mismatches.length, `DPR ${dpr} from-700 plant`).toBeGreaterThan(50 * dpr);
        // Each edge of every glyph of 24 css px and up, through its middle: Chrome's ink ends within half a device px of the model's
        // emboldened edge, and the unemboldened edge is further than that wherever the stroke reaches past it by a pixel or more.
        const plain = inks(unstroked, dpr);
        for (const [n, g] of glyphs.entries()) {
          if (!g.bold || g.bottom - g.top < 24 * dpr) continue;
          const u = plain[n] as GlyphBox;
          const midX = Math.floor((g.left + g.right) / 2);
          const midY = Math.floor((g.top + g.bottom) / 2);
          const edges: [string, number, number, number][] = [
            ['right', inkEdge(chrome, midX, midY, 1, true), g.right, u.right],
            ['left', inkEdge(chrome, midX, midY, -1, true), g.left, u.left],
            ['bottom', inkEdge(chrome, midY, midX, 1, false), g.bottom, u.bottom],
            ['top', inkEdge(chrome, midY, midX, -1, false), g.top, u.top],
          ];
          // An edge another glyph comes within 2 device px of (the next X of a word, a line above) has no clear side to read.
          const crowded = (side: string): boolean => glyphs.some((o, k) => k !== n && (side === 'right' || side === 'left'
            ? o.top <= midY && midY < o.bottom && (side === 'right' ? o.left < g.right + 2 && o.right > g.right : o.right > g.left - 2 && o.left < g.left)
            : o.left <= midX && midX < o.right && (side === 'bottom' ? o.top < g.bottom + 2 && o.bottom > g.bottom : o.bottom > g.top - 2 && o.top < g.top)));
          // An edge within 2 device px of the image's border (the stroke of a glyph at the page's left reaches past x = 0) is clipped.
          const clipped = (model: number, upright: number, horizontal: boolean): boolean => Math.min(model, upright) < 2 || Math.max(model, upright) > (horizontal ? chrome.width : chrome.height) - 2;
          for (const [side, got, model, upright] of edges.filter(([side, , model, upright]) => !crowded(side) && !clipped(model, upright, side === 'right' || side === 'left'))) {
            expect(Math.abs(got - model), `DPR ${dpr} glyph ${n} ${side}: Chrome ${got}, model ${model}`).toBeLessThanOrEqual(0.5);
            if (Math.abs(model - upright) >= 1) expect(Math.abs(got - upright), `DPR ${dpr} glyph ${n} ${side} unemboldened`).toBeGreaterThan(0.5);
          }
        }
      }
    }, 300_000);
  }
});
