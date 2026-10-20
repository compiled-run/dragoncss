// TXT-FX on the host: text-shadow-wrap's shadows on wrapped Ahem lines against Chrome's pixels at every device DPR, shot here as
// parity:pixel-capture shoots them (chrome.ts launch and page, CDP Page.captureScreenshot, the raster size rule), so the proof needs
// no regen. The device draws each line's shadow as its own layer (dragon emit/paint/text-shadow.ts dragonPlaceTextShadow): the
// translated paint-shadow.ts textShadowLayerOver over the line, over the backdrop its container and the container's ancestors paint,
// composited the way the platforms composite a premultiplied layer, with the lines' layers in line order beneath the text view.
// (a) At every clean pixel of every shadowed line (paint-samples/text-shadow.ts shadowedLines) the largest channel difference must
// be 0 (GATE_CHANNEL_DELTA), and every line needs clean pixels and sample points. (b) Every pixel at least MARGIN device px inside a
// glyph box is the text's black in Chrome: no later line's shadow is painted over a line above, so the text view drawn over every
// shadow agrees (analysis/text-shadow.ts wrapRefusal). (c) The bound is needed: at line-height normal Chrome paints the glow of a
// line over the glyphs of the line above (pixels black without the shadow are not black with it), and iOS and Android refuse it.
import { describe, expect, it } from 'vitest';
import { NO_SHADOW_FAULTS, textShadowLayerOver } from '@dragon/layout';
import type { BackdropFill, ShadowLayer } from '@dragon/layout';
import type { NativeProgram } from 'dragon';
import { createProjectWith, nativePrograms, NO_FAULTS } from 'dragon';
import type { ParityCase } from '../src/cases.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { launchChrome, openPage } from '../src/chrome.ts';
import { GATE_CHANNEL_DELTA } from '../src/compare.ts';
import { atDpr, DPRS } from '../src/dpr.ts';
import { PROJECT_ID, fixtureToInput } from '../src/fixture-reader.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { NATIVE_CONFIG, nativeCompile } from '../src/native-host.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { shadowedLines } from '../src/paint-samples/text-shadow.ts';
import { caseBoxes, casePoints, decodePng, glyphLines, rasterSize } from '../src/pixel-reference.ts';
import type { Box, Rgba } from './paint-model.ts';
import { boxes, modelAt } from './paint-model.ts';

const CASE = 'text-shadow-wrap';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
/** The shadowed texts of the fixture and the least lines each takes at 130px (text-shadow-wrap.html). */
const TEXTS: { readonly [text: string]: number } = { 'inh:text0': 2, 'hard:text0': 3, 'soft:text0': 3, 'two:text0': 2, 'glow:text0': 2, 'num:text0': 3 };
/** The model judges a glyph pixel only when it is this far (device px) inside a glyph box. */
const MARGIN = 1;

/** Chrome's pixels of a page at a DPR, shot as parity:pixel-capture shoots them. */
async function shoot(c: ParityCase, html: string, dpr: number): Promise<RgbaImage> {
  const browser = await launchChrome(dpr);
  try {
    const page = await openPage(browser, html, atDpr(c.environment, dpr));
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

/** A platform's source-over of a premultiplied layer pixel over an opaque backdrop, rounded to nearest. */
function platformOver(l: ShadowLayer, x: number, y: number, under: Rgba): number[] {
  if (x < l.left || x >= l.right || y < l.top || y >= l.bottom) return [under[0], under[1], under[2]];
  const i = 4 * ((y - l.top) * (l.right - l.left) + (x - l.left));
  const a = l.rgba[i + 3] as number;
  return [0, 1, 2].map((k) => Math.round((l.rgba[i + k] as number) + ((under[k] as number) * (255 - a)) / 255));
}

/** The backdrop fills the device gathers for a text's shadows: each ancestor's background, outermost first, then its container's. */
function backdropOf(list: readonly Box[], container: string): BackdropFill[] {
  const chain: Box[] = [];
  for (let id: string | null = container; id !== null; ) {
    const a = list.find((x) => x.node.id === id);
    if (a === undefined) break;
    chain.unshift(a);
    id = a.node.parent;
  }
  return chain.flatMap((a) => {
    const bg = a.node.writes.find((w) => w.kind === 'background-color');
    if (bg === undefined || bg.kind !== 'background-color') return [];
    return [{ left: a.l, top: a.t, right: a.r, bottom: a.b, radii: a.radii === null ? [0, 0, 0, 0, 0, 0, 0, 0] : a.radii.slice(0, 8), r: bg.color.r, g: bg.color.g, b: bg.color.b, a: bg.color.alpha }];
  });
}

const at = (img: RgbaImage, x: number, y: number): number[] => [0, 1, 2].map((k) => img.data[(y * img.width + x) * 4 + k] as number);

/** Glyph interior pixels of a program at a DPR that are not the text's black in Chrome, and how many were judged. */
function glyphMismatches(chrome: RgbaImage, p: NativeProgram, viewport: { readonly width: number; readonly height: number }, dpr: number): { readonly bad: string[]; readonly judged: number } {
  const bad: string[] = [];
  let judged = 0;
  for (const l of glyphLines(p, viewport, dpr)) {
    for (const g of l.glyphs) {
      for (let y = Math.ceil(g.top + MARGIN); y + 1 <= g.bottom - MARGIN; y++) {
        for (let x = Math.ceil(g.left + MARGIN); x + 1 <= g.right - MARGIN; x++) {
          if (x < 0 || y < 0 || x >= chrome.width || y >= chrome.height) continue;
          judged++;
          const got = at(chrome, x, y);
          if (got.some((v) => v !== 0)) bad.push(`${l.id} ${x},${y}: Chrome has ${got.join()}`);
        }
      }
    }
  }
  return { bad, judged };
}

describe('TXT-FX text-shadow on wrapped lines: each line\'s layer against Chrome', () => {
  it('the fixture is registered in both directions', () => {
    expect(SPEC?.kind === 'layout' ? SPEC.environments : null).toEqual(['ltr', 'rtl']);
  });
  if (SPEC === undefined) throw new Error(`no fixture ${CASE}`);
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}: every clean pixel equals Chrome, and every glyph is drawn over every shadow`, async () => {
      expect(c.authoredPrepare).toBeNull();
      const programs = nativePrograms(nativeCompile(SPEC, c.environment.direction), c.assignment);
      if (programs.kind !== 'ready') throw new Error(programs.reason);
      const p = programs.programs.uikit;
      const viewport = c.environment.viewport;
      const problems: string[] = [];
      for (const dpr of DPRS) {
        const chrome = await shoot(c, c.authoredHtml, dpr);
        const list = boxes(p, viewport, dpr);
        const lines = shadowedLines(p, viewport, dpr, caseBoxes(p, viewport, dpr));
        for (const [text, least] of Object.entries(TEXTS)) {
          const n = lines.filter((l) => l.text === text).length;
          if (n < least) problems.push(`${c.id}@${dpr}: ${text} has ${n} shadowed lines, not at least ${least}`);
        }
        const points = casePoints(p, viewport, dpr).filter((q) => q.rule.startsWith('text-shadow:'));
        let max = 0;
        let worst = '';
        let pixels = 0;
        for (const l of lines) {
          if (l.clean.length === 0) problems.push(`${c.id}@${dpr}: ${l.id} has no clean shadow pixel`);
          if (!points.some((q) => q.rule.startsWith(`text-shadow:${l.id}:`))) problems.push(`${c.id}@${dpr}: ${l.id} has no text-shadow point`);
          const over = textShadowLayerOver(l.cps, l.xs, l.size, l.baseline, l.shadows, dpr, NO_SHADOW_FAULTS, backdropOf(list, l.container));
          for (const [x, y] of l.clean) {
            const got = at(chrome, x, y);
            const want = platformOver(over, x, y, modelAt(list, x, y));
            const d = Math.max(...want.map((v, k) => Math.abs(v - (got[k] as number))));
            pixels++;
            if (d > max) {
              max = d;
              worst = `${l.id} ${x},${y} Chrome ${JSON.stringify(got)} reference ${JSON.stringify(want)}`;
            }
          }
        }
        console.log(`text-shadow-wrap ${c.id}@${dpr}: ${lines.length} lines, ${pixels} clean pixels, max channel difference ${max}${max > 0 ? ` (${worst})` : ''}`);
        if (max > GATE_CHANNEL_DELTA) problems.push(`${c.id}@${dpr}: ${max} > ${GATE_CHANNEL_DELTA} at ${worst}`);
        const g = glyphMismatches(chrome, p, viewport, dpr);
        if (g.bad.length > 0) problems.push(`${c.id}@${dpr}: ${g.bad.length} glyph pixels are not black, first ${g.bad.slice(0, 3).join('; ')}`);
        if (g.judged < 1000 * dpr * dpr) problems.push(`${c.id}@${dpr}: only ${g.judged} glyph pixels judged`);
      }
      expect(problems).toEqual([]);
    }, 600_000);
  }

  it('the bound is needed: at line-height normal Chrome paints a line\'s glow over the glyphs of the line above, and iOS and Android refuse it', async () => {
    const c = casesOf(SPEC, fixtureInput(SPEC)).find((x) => x.environment.direction === 'ltr') as ParityCase;
    // The fixture with glow alone, at line-height normal (Ahem's line box is its em, so the lines touch).
    const only = (html: string, shadow: string): string =>
      html
        .replace('line-height: 40px;', 'line-height: normal;')
        .replace('.glow { text-shadow: 0 0 8px #f80; }', `.glow { text-shadow: ${shadow}; }`)
        .replace(/<div data-dragon-id="(?!glow")[^\n]*\n/g, '');
    const glow = only(c.authoredHtml, '0 0 8px #f80');
    const none = only(c.authoredHtml, 'none');
    expect(glow).toContain('line-height: normal;');
    expect(glow.match(/data-dragon-id="glow"/g)?.length).toBe(1);
    expect(glow.match(/<div /g)?.length).toBe(1);
    const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults: NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: REFERENCE_PLATFORM, rootFont: SPEC.kind === 'layout' ? SPEC.rootFont : 'ahem', foldViewport: ENVIRONMENT.viewport });
    const refused = project.compile(fixtureToInput(`${CASE}-close`, glow)).diagnostics.filter((d) => d.severity === 'error' && d.message.includes('may reach the glyphs of the line above'));
    expect([...new Set(refused.map((d) => d.target))].sort()).toEqual(['android', 'ios']);
    // Chrome: a pixel black with no shadow is not black under the glow, so a later line's glow is painted over glyphs above it.
    const a = await shoot(c, glow, 2);
    const b = await shoot(c, none, 2);
    let covered = 0;
    let ink = 0;
    for (let y = 0; y < a.height; y++) {
      for (let x = 0; x < a.width; x++) {
        if (!at(b, x, y).every((v) => v === 0)) continue;
        ink++;
        if (!at(a, x, y).every((v) => v === 0)) covered++;
      }
    }
    console.log(`text-shadow-wrap close: ${covered} of ${ink} glyph pixels covered by a shadow`);
    expect(ink).toBeGreaterThan(1000);
    expect(covered).toBeGreaterThan(0);
  }, 300_000);
});
