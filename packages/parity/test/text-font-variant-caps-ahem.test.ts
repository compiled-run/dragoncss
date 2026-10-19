// TXT-FONTFEAT small caps on the host: text-font-variant-caps-ahem against the committed Chrome PNGs at every device DPR. Ahem has no
// smcp feature, so Chrome synthesizes small capitals: it splits the text where a code point's case behaviour changes
// (SmallCapsIterator) and shapes each lowercase run uppercased in SimpleFontData::SmallCapsFontData, at lroundf(computed size * 0.7f),
// on the primary font's baseline (HarfBuzzShaper::ShapeSegment). Native draws each glyph at the size the shaped run gives it (dragon
// emit/native-support.ts DragonTextView, layout shaping.ts pieceGlyphs sizes). The model is what the device draws: each glyph's box,
// at its run's size, black on the white page. Every pixel the model covers fully must be Chrome's ink and every pixel it leaves clear
// must be Chrome's background, so which letters Chrome shrinks, to what size and where on the line are proven before any device runs.
// The smallCapsUnsynthesized plant (small caps reach the engine as normal) must fail. Check (c) of the drawn model against Chrome must
// pass on the device points of both backends.
import { describe, expect, it } from 'vitest';
import type { LayoutBox } from '@dragon/layout';
import type { CompilerFaults, NativeProgram } from 'dragon';
import { createProjectWith, nativePrograms, NO_FAULTS, programInput } from 'dragon';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import { NATIVE_CONFIG } from '../src/native-compile.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { readSamples } from '../src/native-compare.ts';
import { checkCasePixels, committedPixels, devicePoints, rasterSize, uprightGlyphLines } from '../src/pixel-reference.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import type { GlyphBox } from '../src/samples.ts';

const CASE = 'text-font-variant-caps-ahem';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
/**
 * The texts Chrome draws in small capitals (text-font-variant-caps-ahem.html): font-variant-caps, font-variant or font set small-caps,
 * inherited through blocks, inline boxes and flex items, and font-synthesis-small-caps is auto. nsyn and fsn turn synthesis off;
 * inhn, rb and arb set caps back to normal; inl's own texts are normal around its small-caps span.
 */
const SMALL_CAPS = ['sc', 'fv', 'f15', 's13', 's16', 'narrow', 'up', 'sp', 'ra', 'ca', 'cb', 'arow', 'sha'].map((id) => `${id}:text0`).sort();
/** The model judges a pixel only when it is this far (device px) inside a glyph or clear of every one. */
const MARGIN = 1;

function compile(spec: FixtureSpec, direction: 'ltr' | 'rtl', faults: CompilerFaults) {
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.kind === 'layout' ? spec.rootFont : 'ahem', foldViewport: ENVIRONMENT.viewport, interactionLanes: true });
  return project.compile(fixtureInput(spec));
}

/** The ids of the program's text leaves the engine lays out in small capitals. */
function smallCapsLeaves(p: NativeProgram): string[] {
  const out: string[] = [];
  const inline = (c: Exclude<LayoutBox['children'][number], LayoutBox>): void => {
    if (c.kind === 'text' && c.smallCaps) out.push(c.id);
    else if (c.kind === 'inline') for (const k of c.children) inline(k);
  };
  const walk = (b: LayoutBox): void => {
    for (const c of b.children) {
      if (c.kind === 'box') walk(c);
      else inline(c);
    }
  };
  walk(programInput(p, ENVIRONMENT.viewport, 1).root);
  return out.sort();
}

/** One glyph as the device draws it, and whether it is in a small-caps text. */
type Ink = GlyphBox & { readonly smallCaps: boolean };

function inks(p: NativeProgram, dpr: number): Ink[] {
  const small = new Set(smallCapsLeaves(p));
  return uprightGlyphLines(p, ENVIRONMENT.viewport, dpr).flatMap((l) => l.glyphs.map((g) => ({ ...g, smallCaps: small.has(l.id.slice(0, l.id.lastIndexOf(':line'))) })));
}

const inside = (g: GlyphBox, x: number, y: number, m: number): boolean => x >= g.left + m && x + 1 <= g.right - m && y >= g.top + m && y + 1 <= g.bottom - m;
const clear = (g: GlyphBox, x: number, y: number, m: number): boolean => x + 1 + m <= g.left || x - m >= g.right || y + 1 + m <= g.top || y - m >= g.bottom;

/** Every pixel the model judges, against Chrome's: [mismatches, judged ink pixels of small-caps texts, judged background pixels]. */
function judge(chrome: RgbaImage, glyphs: readonly Ink[]): { readonly mismatches: string[]; readonly smallCapsInk: number; readonly background: number } {
  const mismatches: string[] = [];
  let smallCapsInk = 0;
  let background = 0;
  for (let y = 0; y < chrome.height; y++) {
    for (let x = 0; x < chrome.width; x++) {
      const i = (y * chrome.width + x) * 4;
      const rgb = [chrome.data[i], chrome.data[i + 1], chrome.data[i + 2]].join();
      const hit = glyphs.find((g) => inside(g, x, y, MARGIN));
      if (hit !== undefined) {
        if (hit.smallCaps) smallCapsInk++;
        if (rgb !== '0,0,0') mismatches.push(`${x},${y}: ink expected, Chrome has ${rgb}`);
      } else if (glyphs.every((g) => clear(g, x, y, MARGIN))) {
        background++;
        if (rgb !== '255,255,255') mismatches.push(`${x},${y}: background expected, Chrome has ${rgb}`);
      }
    }
  }
  return { mismatches, smallCapsInk, background };
}

const programOf = (spec: FixtureSpec, c: ReturnType<typeof casesOf>[number], faults: CompilerFaults): { readonly uikit: NativeProgram; readonly android: NativeProgram } => {
  const compiled = compile(spec, c.environment.direction, faults);
  expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`)).toEqual([]);
  const p = nativePrograms(compiled, c.assignment);
  if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
  return { uikit: p.programs.uikit, android: p.programs['android-views'] };
};

describe('TXT-FONTFEAT: text-font-variant-caps-ahem\'s small capitals equal the committed Chrome pixels', () => {
  it('is a layout fixture in both directions', () => {
    expect(SPEC?.kind).toBe('layout');
  });
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}; the smallCapsUnsynthesized plant fails`, () => {
      const real = programOf(SPEC, c, NO_FAULTS);
      const planted = programOf(SPEC, c, { ...NO_FAULTS, smallCapsUnsynthesized: true });
      // Both backends lay out the same small-caps texts; the plant lays out none.
      expect(smallCapsLeaves(real.uikit)).toEqual(SMALL_CAPS);
      expect(smallCapsLeaves(real.android)).toEqual(SMALL_CAPS);
      expect(smallCapsLeaves(planted.uikit)).toEqual([]);
      for (const dpr of DPRS) {
        const chrome = committedPixels(c.id, dpr);
        if (chrome === null) throw new Error(`${c.id}: no committed Chrome PNG at DPR ${dpr}`);
        const r = judge(chrome, inks(real.uikit, dpr));
        expect(r.mismatches.slice(0, 10), `DPR ${dpr}`).toEqual([]);
        // Each small-caps text holds at least two Ahem boxes of 7 css px or more, most of which the model judges.
        expect(r.smallCapsInk, `DPR ${dpr}`).toBeGreaterThan(SMALL_CAPS.length * 40 * dpr * dpr);
        expect(r.background, `DPR ${dpr}`).toBeGreaterThan(chrome.width * chrome.height / 2);
        expect(judge(chrome, inks(planted.uikit, dpr)).mismatches.length, `DPR ${dpr} plant`).toBeGreaterThan(SMALL_CAPS.length * 10);
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
        for (let x = Math.max(0, Math.floor(g.left)); x < Math.min(width, Math.ceil(g.right)); x++) {
          for (let sx = 0; sx < S; sx++) {
            const xx = x + (sx + 0.5) / S;
            if (xx >= g.left && xx < g.right) hits[y * width + x] = (hits[y * width + x] as number) + 1;
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

describe('TXT-FONTFEAT: the device points of text-font-variant-caps-ahem pass against Chrome', () => {
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id}: check (c) of the drawn model against Chrome passes on the device points at ${DPRS.join(', ')}, and the plant's fails`, () => {
      const real = programOf(SPEC, c, NO_FAULTS);
      const planted = programOf(SPEC, c, { ...NO_FAULTS, smallCapsUnsynthesized: true });
      for (const prog of [real.uikit, real.android]) {
        for (const dpr of DPRS) {
          const chrome = committedPixels(c.id, dpr);
          if (chrome === null) throw new Error(`${c.id}: no committed Chrome PNG at DPR ${dpr}`);
          const size = rasterSize(ENVIRONMENT.viewport, dpr);
          const points = devicePoints(prog, ENVIRONMENT.viewport, dpr);
          const r = checkCasePixels(readSamples(drawn(prog, dpr), points), points, chrome, size, size);
          expect(r.problems, `${prog.backend} DPR ${dpr}`).toEqual([]);
          expect(r.compared, `${prog.backend} DPR ${dpr}`).toBeGreaterThan(500);
        }
      }
      for (const dpr of DPRS) {
        const chrome = committedPixels(c.id, dpr) as RgbaImage;
        const size = rasterSize(ENVIRONMENT.viewport, dpr);
        const points = devicePoints(planted.uikit, ENVIRONMENT.viewport, dpr);
        expect(checkCasePixels(readSamples(drawn(planted.uikit, dpr), points), points, chrome, size, size).problems.length, `plant DPR ${dpr}`).toBeGreaterThan(0);
      }
    }, 300_000);
  }
});
