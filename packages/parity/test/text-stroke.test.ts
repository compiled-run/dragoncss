// TXT-FX on the host: text-stroke-ahem against Chrome's pixels at every device DPR, shot here as parity:pixel-capture shoots them
// (chrome.ts launch and page, CDP Page.captureScreenshot, the raster size rule), so the proof needs no regen. Chrome fills each line
// fragment and then strokes its glyph outlines with a miter join (GraphicsContext::DrawTextPasses); the native view does the same
// with the program's text-stroke write (dragon emit/native-support.ts DragonTextView). The model is each Ahem box (glyphLines less
// the stroke it grows by), its ring from half the device width outside to half inside in the stroke colour (the width the expected
// dump has each view stroke at, which the devices dump from their own stroke), the rest of the box in
// the fill, and the paint model's page around it. Every pixel at least MARGIN device px inside a ring must be the stroke colour,
// inside a box and clear of every ring the fill, clear of every box and ring the page; each text's outer edge through a glyph's
// middle must sit within half a device px of the model's. The textStrokeAccepted plant (no stroke drawn) must fail. The pl text's
// transparent stroke draws nothing: it is judged as fill and page.
import { describe, expect, it } from 'vitest';
import type { CompilerFaults, NativeProgram } from 'dragon';
import { appliedValue, createProjectWith, nativePrograms, NO_FAULTS } from 'dragon';
import type { ParityCase } from '../src/cases.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { launchChrome, openPage } from '../src/chrome.ts';
import { atDpr, DPRS } from '../src/dpr.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { expectedEngine, NATIVE_CONFIG } from '../src/native-host.ts';
import { decodePng, glyphLines, glyphStrokes, rasterSize } from '../src/pixel-reference.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import type { Box } from './paint-model.ts';
import { boxes, modelAt } from './paint-model.ts';

const CASE = 'text-stroke-ahem';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
/** Every stroked text of text-stroke-ahem.html and its width in css px. */
const STROKED: { readonly [text: string]: number } = { 'inh:text0': 3, 's2:text0': 2, 's4:text0': 4, 's8:text0': 8, 's1:text0': 1, 'cur:text0': 2, 'sp:text0': 3 };
/** The model judges a pixel only when it is this far (device px) inside its region or clear of it. */
const MARGIN = 1;

type Rect = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
type Rgb = readonly [number, number, number];
/** One glyph as the device draws it: its upright Ahem box, its ring's outer and inner rects (equal to the box when unstroked), and its colours. */
type Ink = { readonly text: string; readonly line: string; readonly box: Rect; readonly outer: Rect; readonly inner: Rect; readonly fill: Rgb; readonly stroke: Rgb | null };

function compile(spec: FixtureSpec, direction: 'ltr' | 'rtl', faults: CompilerFaults) {
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: spec.kind === 'layout' ? spec.rootFont : 'ahem', foldViewport: ENVIRONMENT.viewport, interactionLanes: true });
  return project.compile(fixtureInput(spec));
}

/** Chrome's pixels of a page at a DPR, shot as parity:pixel-capture shoots them. */
async function shoot(c: ParityCase, dpr: number): Promise<RgbaImage> {
  const browser = await launchChrome(dpr);
  try {
    const page = await openPage(browser, c.authoredHtml, atDpr(c.environment, dpr));
    const cdp = await page.context().newCDPSession(page);
    const r = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
    const img = decodePng(Buffer.from(r.data, 'base64'));
    const want = rasterSize(c.environment.viewport, dpr);
    if (img.width !== want.width || img.height !== want.height) throw new Error(`${c.id}@${dpr}: Chrome captured ${img.width}x${img.height}, the raster rule is ${want.width}x${want.height}`);
    return img;
  } finally {
    await browser.close();
  }
}

const grow = (r: Rect, d: number): Rect => ({ left: r.left - d, top: r.top - d, right: r.right + d, bottom: r.bottom + d });
/** Whether pixel (x, y) lies inside r shrunk by m. */
const inside = (x: number, y: number, r: Rect, m: number): boolean => x >= r.left + m && x + 1 <= r.right - m && y >= r.top + m && y + 1 <= r.bottom - m;
/** Whether pixel (x, y) grown by m meets r (an empty r meets nothing). */
const meets = (x: number, y: number, r: Rect, m: number): boolean => r.left < r.right && r.top < r.bottom && x - m < r.right && x + 1 + m > r.left && y - m < r.bottom && y + 1 + m > r.top;

/**
 * Each stroked text's width in device px at a DPR as the expected dump has both views stroke it (appliedValue's deviceWidth, which
 * the device dumps from its own stroke paint and layer scale): the model's ring is this wide, so a view that strokes at another
 * width fails the device dump and this width fails Chrome's pixels.
 */
function deviceStrokes(p: NativeProgram, dpr: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of p.nodes) {
    for (const w of n.writes) {
      if (w.kind !== 'text-stroke') continue;
      const at = (backend: 'uikit' | 'android-views'): number => (appliedValue(expectedEngine(), backend, w, dpr, NO_GEOMETRY) as { deviceWidth: number }).deviceWidth;
      if (at('uikit') !== at('android-views')) throw new Error(`${n.id}@${dpr}: uikit strokes ${at('uikit')} device px, android-views ${at('android-views')}`);
      out.set(n.id, at('uikit'));
    }
  }
  return out;
}
const NO_GEOMETRY = { border: [0, 0, 0, 0], box: { x: 0, y: 0, width: 0, height: 0 }, size: [0, 0], fontSize: null, replaced: null, scroll: null } as unknown as Parameters<typeof appliedValue>[4];

/** The glyphs of a program at a DPR, with each text's fill and stroke from its writes. */
function inks(p: NativeProgram, dpr: number): Ink[] {
  const strokes = deviceStrokes(p, dpr);
  const colours = new Map<string, { fill: Rgb; stroke: Rgb | null }>();
  for (const n of p.nodes) {
    const fill = n.writes.find((w) => w.kind === 'text-color');
    const stroke = n.writes.find((w) => w.kind === 'text-stroke');
    if (fill?.kind !== 'text-color') continue;
    colours.set(n.id, { fill: [fill.color.r, fill.color.g, fill.color.b], stroke: stroke?.kind === 'text-stroke' ? [stroke.color.r, stroke.color.g, stroke.color.b] : null });
  }
  return glyphLines(p, ENVIRONMENT.viewport, dpr).flatMap((l) => {
    const text = l.id.slice(0, l.id.lastIndexOf(':line'));
    const c = colours.get(text);
    if (c === undefined) throw new Error(`${text}: no text colour`);
    const h = (strokes.get(text) ?? 0) / 2;
    // glyphLines grows each Ahem box by half the css width * DPR; the model's box is that less half the device width.
    const grown = ((glyphStrokes(p).get(text) ?? 0) * dpr) / 2;
    return l.glyphs.map((g) => {
      const box = grow(g, -grown);
      const outer = grow(box, h);
      return { text, line: l.id, box, outer, inner: grow(box, -h), fill: c.fill, stroke: c.stroke };
    });
  });
}

const rgbAt = (img: RgbaImage, x: number, y: number): Rgb => {
  const i = (y * img.width + x) * 4;
  return [img.data[i] as number, img.data[i + 1] as number, img.data[i + 2] as number];
};
const same = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * Whether (x, y) is at least MARGIN clear of every edge of ring k: well outside it, well inside its fill, or well inside a ring of
 * the same colour. Chrome strokes each glyph on its own, so where one glyph's anti-aliased stroke edge falls on another's opaque
 * ring the source-over rounding leaves the pixel a unit off the stroke colour; the model does not judge those edge pixels.
 */
function clearOfEdges(x: number, y: number, k: Ink, colour: Rgb): boolean {
  if (!meets(x, y, k.outer, MARGIN) || inside(x, y, k.inner, MARGIN)) return true;
  return inside(x, y, k.outer, MARGIN) && !meets(x, y, k.inner, MARGIN) && same(k.stroke as Rgb, colour);
}

/** Every pixel the model judges against Chrome's: the mismatches, and the judged stroke and fill pixels of each text and of the page. */
function judge(chrome: RgbaImage, glyphs: readonly Ink[], page: readonly Box[]): { readonly mismatches: string[]; readonly stroke: Map<string, number>; readonly fill: Map<string, number>; readonly background: number } {
  const mismatches: string[] = [];
  const stroke = new Map<string, number>();
  const fill = new Map<string, number>();
  let background = 0;
  const rings = glyphs.filter((g) => g.stroke !== null);
  for (let y = 0; y < chrome.height; y++) {
    for (let x = 0; x < chrome.width; x++) {
      const got = rgbAt(chrome, x, y);
      let want: Rgb | null = null;
      let what = '';
      const ring = rings.find((g) => inside(x, y, g.outer, MARGIN) && !meets(x, y, g.inner, MARGIN));
      if (ring !== undefined) {
        if (!rings.every((k) => k === ring || clearOfEdges(x, y, k, ring.stroke as Rgb))) continue;
        want = ring.stroke as Rgb;
        what = `${ring.line} stroke`;
        stroke.set(ring.text, (stroke.get(ring.text) ?? 0) + 1);
      } else {
        const g = glyphs.find((k) => inside(x, y, k.inner, MARGIN));
        if (g !== undefined && !rings.some((k) => meets(x, y, k.outer, MARGIN) && !inside(x, y, k.inner, MARGIN))) {
          want = g.fill;
          what = `${g.line} fill`;
          fill.set(g.text, (fill.get(g.text) ?? 0) + 1);
        } else if (!glyphs.some((k) => meets(x, y, k.outer, MARGIN))) {
          const m = modelAt(page, x, y);
          want = [m[0], m[1], m[2]];
          what = 'page';
          background++;
        }
      }
      if (want !== null && !same(want, got)) mismatches.push(`${x},${y} ${what}: model ${want.join()}, Chrome ${got.join()}`);
    }
  }
  return { mismatches, stroke, fill, background };
}

/**
 * Where Chrome's stroke ends along one row through a glyph's middle, in device px: from a pixel in the stroke colour outward, the
 * last pixel in it plus the share of the next that is stroke over the page (on the channel where the two differ most).
 */
function strokeEdge(chrome: RgbaImage, from: number, y: number, step: 1 | -1, inner: Rgb, outer: Rgb): number {
  const k0 = [0, 1, 2].reduce((a, k) => (Math.abs((inner[k] as number) - (outer[k] as number)) > Math.abs((inner[a] as number) - (outer[a] as number)) ? k : a), 0);
  let x = from;
  while (same(rgbAt(chrome, x + step, y), inner)) x += step;
  const v = rgbAt(chrome, x + step, y)[k0] as number;
  const share = (v - (outer[k0] as number)) / ((inner[k0] as number) - (outer[k0] as number));
  return step === 1 ? x + 1 + share : x - share;
}

describe('TXT-FX: text-stroke-ahem\'s stroked glyphs equal Chrome\'s pixels', () => {
  it('is a layout fixture in both directions', () => {
    expect(SPEC?.kind === 'layout' ? SPEC.environments : null).toEqual(['ltr', 'rtl']);
  });
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}: every judged pixel and stroke edge is Chrome's; the textStrokeAccepted plant fails`, async () => {
      expect(c.authoredPrepare).toBeNull();
      const programOf = (faults: CompilerFaults): NativeProgram => {
        const compiled = compile(SPEC, c.environment.direction, faults);
        expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`)).toEqual([]);
        const p = nativePrograms(compiled, c.assignment);
        if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
        // Both backends stroke the same texts with the same width and colour.
        const writes = (prog: NativeProgram): string[] => prog.nodes.flatMap((n) => n.writes.flatMap((w) => (w.kind === 'text-stroke' ? [`${n.id} ${w.width} ${w.color.r},${w.color.g},${w.color.b},${w.color.alpha}`] : [])));
        expect(writes(p.programs['android-views'])).toEqual(writes(p.programs.uikit));
        return p.programs.uikit;
      };
      const real = programOf(NO_FAULTS);
      const plant = programOf({ ...NO_FAULTS, textStrokeAccepted: true });
      expect(Object.fromEntries(glyphStrokes(real))).toEqual(STROKED);
      expect(glyphStrokes(plant).size).toBe(0);
      const problems: string[] = [];
      for (const dpr of DPRS) {
        const chrome = await shoot(c, dpr);
        const page = boxes(real, c.environment.viewport, dpr);
        const glyphs = inks(real, dpr);
        const r = judge(chrome, glyphs, page);
        console.log(`text-stroke ${c.id}@${dpr}: ${r.mismatches.length} mismatches, stroke ${JSON.stringify(Object.fromEntries(r.stroke))}, fill ${JSON.stringify(Object.fromEntries(r.fill))}, page ${r.background}`);
        if (r.mismatches.length > 0) problems.push(`${c.id}@${dpr}: ${r.mismatches.length} mismatches, first ${r.mismatches.slice(0, 5).join('; ')}`);
        for (const [text, width] of Object.entries(STROKED)) {
          // A band at least MARGIN clear of both its edges holds a whole pixel once it is 2 * MARGIN + 1 device px wide.
          if (width * dpr >= 2 * MARGIN + 2 && (r.stroke.get(text) ?? 0) < 40 * dpr) problems.push(`${c.id}@${dpr}: only ${r.stroke.get(text) ?? 0} stroke pixels of ${text} judged`);
          if ((r.fill.get(text) ?? 0) < 400 * dpr * dpr) problems.push(`${c.id}@${dpr}: only ${r.fill.get(text) ?? 0} fill pixels of ${text} judged`);
        }
        if (r.background < (chrome.width * chrome.height) / 2) problems.push(`${c.id}@${dpr}: only ${r.background} page pixels judged`);
        const planted = judge(chrome, inks(plant, dpr), boxes(plant, c.environment.viewport, dpr));
        if (planted.mismatches.length < 100 * dpr) problems.push(`${c.id}@${dpr}: the textStrokeAccepted plant gives only ${planted.mismatches.length} mismatches`);
        // The outer edge of each line's leftmost and rightmost glyph, through its middle row: Chrome's within half a device px of the model's.
        const lines = new Map<string, Ink[]>();
        for (const g of glyphs) if (g.stroke !== null) lines.set(g.line, [...(lines.get(g.line) ?? []), g]);
        for (const [line, gs] of lines) {
          const first = gs.reduce((a, g) => (g.box.left < a.box.left ? g : a));
          const last = gs.reduce((a, g) => (g.box.right > a.box.right ? g : a));
          const y = Math.floor((first.box.top + first.box.bottom) / 2);
          const side = (g: Ink, step: 1 | -1, model: number): void => {
            // Start on the pixel just inside the box edge, which the stroke covers whole.
            const from = step === 1 ? Math.ceil(g.box.right) - 1 : Math.floor(g.box.left);
            const out = modelAt(page, step === 1 ? Math.ceil(model) + 1 : Math.floor(model) - 2, y);
            const at = strokeEdge(chrome, from, y, step, g.stroke as Rgb, [out[0], out[1], out[2]]);
            if (Math.abs(at - model) > 0.5) problems.push(`${c.id}@${dpr}: ${line} ${step === 1 ? 'right' : 'left'} stroke edge at ${at.toFixed(2)}, the model's ${model.toFixed(2)}`);
          };
          side(first, -1, first.outer.left);
          side(last, 1, last.outer.right);
        }
      }
      expect(problems).toEqual([]);
    }, 600_000);
  }
});
