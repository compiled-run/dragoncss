// TXT-FX on the host: text-fill-stroke-colors against Chrome's pixels at every device DPR, shot here as parity:pixel-capture shoots
// them (chrome.ts launch and page, CDP Page.captureScreenshot, the raster size rule), so the proof needs no regen. Chrome fills glyphs in
// -webkit-text-fill-color (color where it is currentcolor) and paints a currentcolor decoration in the decorating box's fill; native
// fills each text view in the program's text colour (native-program.ts textPaint) and draws decorations from the text-decoration
// write. Every pixel at least MARGIN device px inside an Ahem glyph box must be Chrome's fill: the text colour where it is opaque,
// the paint model's backdrop where it is transparent (the fixture has no translucent fill). un's underline runs beneath its child
// uc's glyphs (skip-ink none): its row points must show un's fill and the write's colour, its ink points uc's fill. The
// textFillIgnored plant (glyphs filled in color) must fail.
import { describe, expect, it } from 'vitest';
import type { CompilerFaults, NativeProgram } from 'dragon';
import { createProjectWith, nativePrograms, NO_FAULTS } from 'dragon';
import type { ParityCase } from '../src/cases.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { DPRS } from '../src/dpr.ts';
import { PROJECT_ID } from '../src/fixture-reader.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { ENVIRONMENT, FIXTURE_GROUPS } from '../src/fixtures.ts';
import { NATIVE_CONFIG } from '../src/native-compile.ts';
import type { RgbaImage } from '../src/native-compare.ts';
import { launchChrome, openPage } from '../src/chrome.ts';
import { atDpr } from '../src/dpr.ts';
import { casePoints, decodePng, glyphLines, rasterSize } from '../src/pixel-reference.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import type { Rgba } from './paint-model.ts';
import { boxes, modelAt } from './paint-model.ts';

const CASE = 'text-fill-stroke-colors';
const SPEC = FIXTURE_GROUPS.flatMap((g) => g.fixtures).find((f) => f.id === CASE);
/** Each text's fill as the fixture writes it (text-fill-stroke-colors.html); null is transparent. */
const FILLS: { readonly [text: string]: Rgba | null } = {
  'red:text0': [204, 0, 0, 255],
  'tr:text0': null,
  'hsl:text0': [0, 128, 0, 255],
  'inh:text0': [0, 102, 204, 255],
  'cc:text0': [128, 0, 128, 255],
  'uc:text0': [170, 0, 170, 255],
  'bg:text0': [0, 102, 204, 255],
  'mix:text0': [0, 0, 0, 255],
  'sp:text0': [153, 0, 153, 255],
  'mix:text1': [0, 0, 0, 255],
  'ra:text0': [10, 127, 94, 255],
  'rb:text0': [10, 127, 94, 255],
};
/** un's fill, which its currentcolor underline is painted in (its color is blue). */
const UNDERLINE: Rgba = [255, 165, 0, 255];
/** The model judges a pixel only when it is this far (device px) inside a glyph box. */
const MARGIN = 1;

function compile(spec: FixtureSpec, direction: 'ltr' | 'rtl', faults: CompilerFaults) {
  const project = createProjectWith({ projectId: PROJECT_ID, targets: { ...NATIVE_CONFIG } }, { faults, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: 'ahem', foldViewport: ENVIRONMENT.viewport, interactionLanes: true });
  return project.compile(fixtureInput(spec));
}

/** Each text's colour in the program, both backends equal. */
function textColours(p: { readonly uikit: NativeProgram; readonly 'android-views': NativeProgram }): Map<string, Rgba> {
  const of = (prog: NativeProgram): Map<string, Rgba> => new Map(prog.nodes.flatMap((n) => n.writes.flatMap((w) => (w.kind === 'text-color' ? [[n.id, [w.color.r, w.color.g, w.color.b, w.color.alpha] as Rgba] as const] : []))));
  const ios = of(p.uikit);
  expect([...of(p['android-views'])]).toEqual([...ios]);
  return ios;
}

/** Chrome's pixels of a case at a DPR, shot as parity:pixel-capture shoots them. */
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

const at = (img: RgbaImage, x: number, y: number): string => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]].join();
};

/** Every judged glyph pixel against Chrome: [mismatches, judged pixels per text]. */
function judge(chrome: RgbaImage, p: NativeProgram, dpr: number): { readonly mismatches: string[]; readonly judged: Map<string, number> } {
  const colours = new Map(p.nodes.flatMap((n) => n.writes.flatMap((w) => (w.kind === 'text-color' ? [[n.id, w.color] as const] : []))));
  const list = boxes(p, ENVIRONMENT.viewport, dpr);
  const mismatches: string[] = [];
  const judged = new Map<string, number>();
  for (const l of glyphLines(p, ENVIRONMENT.viewport, dpr)) {
    const text = l.id.slice(0, l.id.lastIndexOf(':line'));
    const c = colours.get(text);
    if (c === undefined) throw new Error(`${text}: no text colour`);
    for (const g of l.glyphs) {
      for (let y = Math.ceil(g.top + MARGIN); y + 1 <= g.bottom - MARGIN; y++) {
        for (let x = Math.ceil(g.left + MARGIN); x + 1 <= g.right - MARGIN; x++) {
          if (x < 0 || y < 0 || x >= chrome.width || y >= chrome.height) continue;
          const want = c.alpha === 255 ? [c.r, c.g, c.b].join() : c.alpha === 0 ? modelAt(list, x, y).slice(0, 3).join() : null;
          if (want === null) throw new Error(`${text}: a translucent text colour, which this model does not composite`);
          judged.set(text, (judged.get(text) ?? 0) + 1);
          const got = at(chrome, x, y);
          if (got !== want) mismatches.push(`${text} ${x},${y}: ${want} expected, Chrome has ${got}`);
        }
      }
    }
  }
  return { mismatches, judged };
}

describe('TXT-FX: text-fill-stroke-colors\' glyph fills equal Chrome\'s pixels', () => {
  it('is a layout fixture in both directions', () => {
    expect(SPEC?.kind === 'layout' ? SPEC.environments : null).toEqual(['ltr', 'rtl']);
  });
  if (SPEC === undefined) return;
  for (const c of casesOf(SPEC, fixtureInput(SPEC))) {
    it(`${c.id} at ${DPRS.join(', ')}: every glyph pixel is the fill, a currentcolor underline is the decorating box's fill; the textFillIgnored plant fails`, async () => {
      const programOf = (faults: CompilerFaults) => {
        const compiled = compile(SPEC, c.environment.direction, faults);
        expect(compiled.diagnostics.filter((d) => d.severity === 'error').map((d) => `${String(d.target)} ${d.code} ${d.message}`)).toEqual([]);
        const p = nativePrograms(compiled, c.assignment);
        if (p.kind !== 'ready') throw new Error(`${c.id}: ${p.reason}`);
        return p.programs;
      };
      // The page is shot as authored, with no prepare script (parity:pixel-capture runs one first where a case has it).
      expect(c.authoredPrepare).toBeNull();
      const real = programOf(NO_FAULTS);
      const planted = programOf({ ...NO_FAULTS, textFillIgnored: true });
      const colours = textColours(real);
      expect(Object.fromEntries([...colours].map(([k, v]) => [k, v[3] === 0 ? null : v]))).toEqual(FILLS);
      for (const dpr of DPRS) {
        const chrome = await shoot(c, dpr);
        const r = judge(chrome, real.uikit, dpr);
        expect(r.mismatches.slice(0, 10), `DPR ${dpr}`).toEqual([]);
        // Every text with ink is judged over most of its glyphs (each X is 20 css px square).
        for (const t of Object.keys(FILLS)) expect(r.judged.get(t) ?? 0, `${t} DPR ${dpr}`).toBeGreaterThan(200 * dpr * dpr);
        // The plant fills every filled text in color; its glyphs differ from Chrome's wherever color and the fill differ.
        expect(judge(chrome, planted.uikit, dpr).mismatches.length, `DPR ${dpr} plant`).toBeGreaterThan(9 * 200 * dpr * dpr);
        // un's underline: un's fill between the glyphs (row points), uc's fill over it where the glyphs cover it (ink points).
        const w = real.uikit.nodes.flatMap((n) => n.writes).find((x) => x.kind === 'text-decoration');
        expect(w?.kind === 'text-decoration' ? w.entries.map((e) => [e.text, e.color.r, e.color.g, e.color.b, e.color.alpha]) : null).toEqual([['uc:text0', ...UNDERLINE]]);
        const points = casePoints(real.uikit, ENVIRONMENT.viewport, dpr).filter((q) => q.rule.startsWith('decoration:uc:text0:'));
        const rows = points.filter((q) => q.rule.endsWith(':row'));
        const inks = points.filter((q) => q.rule.endsWith(':ink'));
        expect(rows.length, `DPR ${dpr} row points`).toBeGreaterThan(0);
        expect(inks.length, `DPR ${dpr} ink points`).toBeGreaterThan(0);
        for (const q of rows) expect(`${q.rule} ${at(chrome, q.x, q.y)}`).toBe(`${q.rule} ${UNDERLINE.slice(0, 3).join()}`);
        for (const q of inks) expect(`${q.rule} ${at(chrome, q.x, q.y)}`).toBe(`${q.rule} ${(FILLS['uc:text0'] as Rgba).slice(0, 3).join()}`);
      }
    }, 300_000);
  }
});
