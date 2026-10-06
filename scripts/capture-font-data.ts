// Captures the Chrome 145 references of the fonts module (TXT1-C, docs/goals/milestone-2-proof/notes/T004-txt1c-spec.md §3):
// (a) which vendored face Chrome picks for a request, read with CDP CSS.getPlatformFontsForNode; (b) font metrics of every
// vendored face at the sizes and DPRs of the spec; (c) Chrome's CSSOM for @font-face descriptors and the computed font-family
// serialization; (d) the pinned rewrite rendered by Chrome; (e) what Chrome maps each generic to on this platform (data only).
// The vendored fonts are embedded as data: URIs. Each file records the Chrome version, flags, DPRs and font SHA-256 values.
// Run with: node --conditions=dragon-internal scripts/capture-font-data.ts [--check]
// --check captures again into a temporary directory and requires the committed files to be byte-identical.
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHROME_VERSION, PLAYWRIGHT_VERSION, chromeArgsAt, launchChrome } from '../packages/parity/src/chrome.ts';
import { repoPath } from '../packages/parity/src/paths.ts';
import { hostPlatform } from '../packages/parity/src/platform.ts';
import { DESCRIPTOR_NAMES } from '../packages/dragon/src/fonts/font-face.ts';
import { parseFamilyList } from '../packages/dragon/src/fonts/family-list.ts';
import { rewriteFamilyList } from '../packages/dragon/src/fonts/font-map.ts';
import type { FontMap } from '../packages/dragon/src/fonts/font-map.ts';

type Browser = Awaited<ReturnType<typeof launchChrome>>;
type Page = Awaited<ReturnType<Browser['newPage']>>;

export const FONT_FILES = [
  'Inter/Inter-Light.ttf', 'Inter/Inter-Regular.ttf', 'Inter/Inter-Italic.ttf', 'Inter/Inter-Bold.ttf', 'Inter/Inter-BoldItalic.ttf',
  'Roboto/Roboto-Regular.ttf', 'NotoSans/NotoSans-Regular.ttf', 'NotoSansMono/NotoSansMono-Regular.ttf',
  'Lato/Lato-Regular.ttf', 'Lato/Lato-Bold.ttf',
] as const;
const SIZES = [1, 7, 10, 13, 16, 17.5, 23.3, 37, 64, 100];
const DPRS = [1, 2, 2.625, 3];
const CAPTURE_DIR = 'packages/dragon/test/fonts/captures';

const bytesOf = (f: string): Buffer => readFileSync(repoPath(`vendor/fonts/${f}`));
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const fontHashes = Object.fromEntries(FONT_FILES.map((f) => [f, sha(bytesOf(f))]));
const dataUri = (f: string): string => `data:font/ttf;base64,${bytesOf(f).toString('base64')}`;
/** Case CSS names fonts as url("fonts/<file>"); Chrome gets the bytes as data: URIs. */
const embed = (css: string): string => css.replace(/url\("fonts\/([^"]+)"\)/g, (_m, f: string) => `url("${dataUri(f)}")`);

const header = (dprs: readonly number[]) => ({
  chrome: CHROME_VERSION,
  playwright: PLAYWRIGHT_VERSION,
  platform: hostPlatform(),
  launches: dprs.map((dpr) => ({ dpr, flags: chromeArgsAt(dpr) })),
  fonts: fontHashes,
});

// ---------------------------------------------------------------------------------------------------------------- (a)
type Face = { readonly file: string; readonly descriptors?: string };
type Request = { readonly family: string; readonly weight: number; readonly stretch: number; readonly style: string; readonly text: string };
type MatchCase = { readonly id: string; readonly family: string; readonly faces: readonly Face[]; readonly requests: readonly Request[] };

const [LIGHT, REGULAR, ITALIC, BOLD, BOLDITALIC, ROBOTO, NOTO, MONO, LATO, LATO_BOLD] = FONT_FILES;
const T = 'AaBb';
const req = (family: string, weight: number, stretch = 100, style = 'normal', text = T): Request => ({ family, weight, stretch, style, text });
const grid = (family: string, weights: readonly number[], stretches: readonly number[] = [100], styles: readonly string[] = ['normal']): Request[] =>
  weights.flatMap((w) => stretches.flatMap((s) => styles.map((st) => req(family, w, s, st))));
const ALL_WEIGHTS = [1, 100, 200, 300, 350, 399, 400, 420, 450, 480, 500, 501, 550, 600, 650, 700, 750, 800, 900, 1000];
const STRETCHES = [50, 62.5, 70, 75, 80, 87.5, 99, 100, 101, 110, 112.5, 120, 125, 140, 150, 175, 200];
const OBLIQUES = ['normal', 'italic', 'oblique 0deg', 'oblique 5deg', 'oblique 10deg', 'oblique 13deg', 'oblique 13.9deg', 'oblique 14deg', 'oblique 15deg', 'oblique 20deg', 'oblique 25deg', 'oblique 40deg', 'oblique 90deg', 'oblique -5deg', 'oblique -13deg', 'oblique -14deg', 'oblique -15deg', 'oblique -20deg', 'oblique -40deg', 'oblique -90deg'];

const MATCH_CASES: MatchCase[] = [
  { id: 'weight-three', family: 'W1', faces: [{ file: LIGHT, descriptors: 'font-weight:300' }, { file: REGULAR, descriptors: 'font-weight:400' }, { file: BOLD, descriptors: 'font-weight:700' }], requests: grid('W1', ALL_WEIGHTS) },
  { id: 'weight-no-regular', family: 'W2', faces: [{ file: LIGHT, descriptors: 'font-weight:300' }, { file: ROBOTO, descriptors: 'font-weight:600' }, { file: NOTO, descriptors: 'font-weight:800' }], requests: grid('W2', ALL_WEIGHTS) },
  { id: 'weight-band-above-500', family: 'W3', faces: [{ file: ROBOTO, descriptors: 'font-weight:200' }, { file: NOTO, descriptors: 'font-weight:550' }], requests: grid('W3', ALL_WEIGHTS) },
  { id: 'weight-band-inside', family: 'W4', faces: [{ file: LIGHT, descriptors: 'font-weight:350' }, { file: REGULAR, descriptors: 'font-weight:470' }, { file: BOLD, descriptors: 'font-weight:520' }, { file: MONO, descriptors: 'font-weight:900' }], requests: grid('W4', ALL_WEIGHTS) },
  { id: 'weight-ranges', family: 'W5', faces: [{ file: LIGHT, descriptors: 'font-weight:100 350' }, { file: REGULAR, descriptors: 'font-weight:480 450' }, { file: BOLD, descriptors: 'font-weight:600 900' }], requests: grid('W5', ALL_WEIGHTS) },
  { id: 'weight-keywords', family: 'W6', faces: [{ file: REGULAR, descriptors: 'font-weight:normal' }, { file: BOLD, descriptors: 'font-weight:bold' }, { file: ROBOTO, descriptors: 'font-weight:auto' }], requests: grid('W6', ALL_WEIGHTS) },
  { id: 'stretch-five', family: 'X1', faces: [{ file: LIGHT, descriptors: 'font-stretch:50%' }, { file: REGULAR, descriptors: 'font-stretch:condensed' }, { file: BOLD, descriptors: 'font-stretch:100%' }, { file: ROBOTO, descriptors: 'font-stretch:expanded' }, { file: NOTO, descriptors: 'font-stretch:150%' }], requests: grid('X1', [400], STRETCHES) },
  { id: 'stretch-ranges', family: 'X2', faces: [{ file: REGULAR, descriptors: 'font-stretch:75% 90%' }, { file: ROBOTO, descriptors: 'font-stretch:130% 110%' }], requests: grid('X2', [400], STRETCHES) },
  { id: 'stretch-no-normal', family: 'X3', faces: [{ file: LIGHT, descriptors: 'font-stretch:extra-condensed' }, { file: NOTO, descriptors: 'font-stretch:extra-expanded' }], requests: grid('X3', [400], STRETCHES) },
  { id: 'stretch-before-weight', family: 'X4', faces: [{ file: REGULAR, descriptors: 'font-weight:400;font-stretch:100%' }, { file: BOLD, descriptors: 'font-weight:700;font-stretch:125%' }, { file: MONO, descriptors: 'font-weight:900;font-stretch:75%' }], requests: grid('X4', [100, 400, 700, 900], [75, 100, 125, 150]) },
  { id: 'style-all', family: 'S1', faces: [{ file: REGULAR, descriptors: 'font-style:normal' }, { file: ITALIC, descriptors: 'font-style:italic' }, { file: ROBOTO, descriptors: 'font-style:oblique 5deg' }, { file: NOTO, descriptors: 'font-style:oblique -10deg' }, { file: MONO, descriptors: 'font-style:oblique 20deg 30deg' }], requests: grid('S1', [400], [100], OBLIQUES) },
  { id: 'style-normal-and-negative', family: 'S2', faces: [{ file: REGULAR }, { file: NOTO, descriptors: 'font-style:oblique -20deg' }], requests: grid('S2', [400], [100], OBLIQUES) },
  { id: 'style-no-normal', family: 'S3', faces: [{ file: ITALIC, descriptors: 'font-style:italic' }, { file: ROBOTO, descriptors: 'font-style:oblique 10deg' }, { file: MONO, descriptors: 'font-style:oblique -30deg -20deg' }], requests: grid('S3', [400], [100], OBLIQUES) },
  { id: 'style-threshold', family: 'S4', faces: [{ file: ROBOTO, descriptors: 'font-style:oblique 13deg' }, { file: NOTO, descriptors: 'font-style:oblique 15deg' }, { file: MONO, descriptors: 'font-style:oblique -13deg' }, { file: LIGHT, descriptors: 'font-style:oblique -15deg' }], requests: grid('S4', [400], [100], OBLIQUES) },
  { id: 'style-units', family: 'S5', faces: [{ file: ROBOTO, descriptors: 'font-style:oblique 0.2rad' }, { file: NOTO, descriptors: 'font-style:oblique 0.05turn' }, { file: MONO, descriptors: 'font-style:oblique 30grad 40grad' }, { file: REGULAR, descriptors: 'font-style:oblique 0deg' }], requests: grid('S5', [400], [100], OBLIQUES) },
  { id: 'style-weight-stretch', family: 'SW', faces: [{ file: REGULAR }, { file: ITALIC, descriptors: 'font-style:italic' }, { file: BOLD, descriptors: 'font-weight:bold' }, { file: BOLDITALIC, descriptors: 'font-weight:bold;font-style:italic' }, { file: LIGHT, descriptors: 'font-weight:300;font-stretch:condensed' }], requests: grid('SW', [100, 300, 400, 500, 600, 700, 900], [75, 100, 125], ['normal', 'italic', 'oblique 10deg']) },
  { id: 'tie-overlapping-weights', family: 'T1', faces: [{ file: LIGHT, descriptors: 'font-weight:100 500' }, { file: REGULAR, descriptors: 'font-weight:300 900' }, { file: ROBOTO, descriptors: 'font-weight:350 450' }], requests: grid('T1', ALL_WEIGHTS) },
  { id: 'tie-overlapping-all', family: 'T2', faces: [{ file: LIGHT, descriptors: 'font-weight:1 1000;font-stretch:50% 200%;font-style:oblique -90deg 90deg' }, { file: REGULAR, descriptors: 'font-weight:1 1000;font-stretch:50% 200%;font-style:oblique -80deg 80deg' }, { file: ROBOTO, descriptors: 'font-weight:100 900;font-stretch:50% 200%;font-style:oblique -90deg 90deg' }, { file: NOTO, descriptors: 'font-weight:1 1000;font-stretch:75% 125%;font-style:oblique -90deg 90deg' }, { file: MONO, descriptors: 'font-weight:200 800;font-stretch:60% 190%;font-style:oblique -70deg 70deg' }], requests: grid('T2', [100, 400, 700], [75, 100], ['normal', 'italic']) },
  { id: 'tie-equal-distance', family: 'T3', faces: [{ file: ROBOTO, descriptors: 'font-stretch:90%' }, { file: NOTO, descriptors: 'font-stretch:110%' }, { file: LIGHT, descriptors: 'font-weight:300' }, { file: BOLD, descriptors: 'font-weight:500' }], requests: grid('T3', [400], STRETCHES) },
  { id: 'declaration-order', family: 'D1', faces: [{ file: REGULAR }, { file: ROBOTO }, { file: NOTO, descriptors: 'font-weight:700' }, { file: MONO, descriptors: 'font-weight:700' }], requests: grid('D1', [400, 700]) },
  { id: 'unicode-range-split', family: 'U1', faces: [{ file: REGULAR, descriptors: 'unicode-range:U+41-5A' }, { file: ROBOTO, descriptors: 'unicode-range:U+61-7A' }, { file: NOTO, descriptors: 'unicode-range:U+30-39, U+2E' }], requests: [req('U1', 400, 100, 'normal', 'AZaz09.'), req('U1', 400, 100, 'normal', 'Hello 42')] },
  { id: 'unicode-range-override', family: 'U2', faces: [{ file: REGULAR }, { file: ROBOTO, descriptors: 'unicode-range:U+61-7A' }, { file: NOTO, descriptors: 'unicode-range:U+62' }], requests: [req('U2', 400, 100, 'normal', 'ABab'), req('U2', 400, 100, 'normal', 'abc0')] },
  { id: 'unicode-range-with-weight', family: 'U3', faces: [{ file: REGULAR, descriptors: 'font-weight:400;unicode-range:U+0-7F' }, { file: BOLD, descriptors: 'font-weight:700' }, { file: MONO, descriptors: 'font-weight:700;unicode-range:U+30-39' }], requests: [req('U3', 400, 100, 'normal', 'Ab12'), req('U3', 700, 100, 'normal', 'Ab12'), req('U3', 600, 100, 'normal', 'Ab12')] },
  { id: 'family-lists', family: 'L1', faces: [{ file: REGULAR, descriptors: 'unicode-range:U+41-5A' }, { file: ROBOTO, descriptors: 'font-family:"L2"' }, { file: NOTO, descriptors: 'font-family:"serif"' }, { file: MONO, descriptors: 'font-family:"Mixed Case"' }], requests: [
    req('L1, L2', 400, 100, 'normal', 'ABab'), req('L2, L1', 400, 100, 'normal', 'ABab'), req('"serif"', 400), req('serif, L2', 400), req('"Mixed Case"', 400), req('"mixed case", L2', 400), req('Mixed   Case', 400), req('Nope, L2', 400),
  ] },
  // Lato 2.015 (T036): the north star's 'Lato' as its font map will declare it (400 and 700), then undeclared and mixed with Inter.
  { id: 'lato-regular-bold', family: 'Lato', faces: [{ file: LATO, descriptors: 'font-weight:400' }, { file: LATO_BOLD, descriptors: 'font-weight:700' }], requests: grid('Lato', ALL_WEIGHTS, [75, 100, 125], ['normal', 'italic', 'oblique 10deg']) },
  { id: 'lato-no-descriptors', family: 'Lato', faces: [{ file: LATO }, { file: LATO_BOLD }], requests: grid('Lato', [100, 400, 700, 900], [100], ['normal', 'italic']) },
  { id: 'lato-with-inter', family: 'LI', faces: [{ file: LATO, descriptors: 'font-weight:400' }, { file: LATO_BOLD, descriptors: 'font-weight:700' }, { file: LIGHT, descriptors: 'font-weight:300' }, { file: BOLDITALIC, descriptors: 'font-weight:700;font-style:italic' }], requests: grid('LI', ALL_WEIGHTS, [100], ['normal', 'italic']) },
  { id: 'lato-family-list', family: 'Lato', faces: [{ file: LATO, descriptors: 'font-weight:400' }, { file: LATO_BOLD, descriptors: 'font-weight:700' }, { file: REGULAR, descriptors: 'font-family:"Dragon Sans";font-weight:400' }, { file: BOLD, descriptors: 'font-family:"Dragon Sans";font-weight:700' }], requests: [
    req('"Lato", "Dragon Sans"', 400, 100, 'normal', 'Waves ‹ ›'), req('Lato, "Dragon Sans"', 700, 100, 'normal', 'Waves ‹ ›'), req('"Dragon Sans", Lato', 700), req('Nope, Lato', 400), req('Nope, Lato', 700),
  ] },
];

/** The CSS of a case: one @font-face per face, the case family unless the descriptors name another. */
export function caseCss(c: MatchCase): string {
  return c.faces.map((f) => `@font-face{font-family:${JSON.stringify(c.family)};src:url("fonts/${f.file}") format("truetype");${f.descriptors ?? ''}}`).join('\n');
}

type PlatformFont = { readonly familyName: string; readonly postScriptName: string; readonly isCustomFont: boolean; readonly glyphCount: number };

async function platformFonts(page: Page, selectors: readonly string[]): Promise<PlatformFont[][]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const out: PlatformFont[][] = [];
  for (const sel of selectors) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    out.push(fonts.map((f) => ({ familyName: f.familyName, postScriptName: f.postScriptName, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount }))
      .sort((a, b) => (a.postScriptName < b.postScriptName ? -1 : a.postScriptName > b.postScriptName ? 1 : 0)));
  }
  await cdp.detach();
  return out;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

async function newPage(browser: Browser, dpr: number): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
  return context.newPage();
}

async function captureMatching(browser: Browser): Promise<unknown> {
  const page = await newPage(browser, 1);
  const cases = [];
  for (const c of MATCH_CASES) {
    const css = caseCss(c);
    const body = c.requests.map((r, i) => `<div id="r${i}" style="font-family:${escapeAttr(r.family)};font-weight:${r.weight};font-stretch:${r.stretch}%;font-style:${r.style}">${r.text}</div>`).join('');
    await page.setContent(`<!DOCTYPE html><html><head><style>${embed(css)}</style></head><body>${body}</body></html>`);
    await settle(page);
    const fonts = await platformFonts(page, c.requests.map((_r, i) => `#r${i}`));
    cases.push({ id: c.id, css, requests: c.requests.map((r, i) => ({ ...r, chrome: fonts[i] })) });
  }
  await page.context().close();
  return { ...header([1]), cases };
}

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------------------------------------------------------- (b)
type MetricVariant = { readonly id: string; readonly descriptors: string; readonly files: readonly string[] };
const METRIC_VARIANTS: MetricVariant[] = [
  { id: 'plain', descriptors: '', files: FONT_FILES },
  { id: 'ascent-override', descriptors: 'ascent-override:80%', files: [REGULAR, ROBOTO, NOTO] },
  { id: 'descent-override', descriptors: 'descent-override:31%', files: [REGULAR, ROBOTO, NOTO] },
  { id: 'line-gap-override', descriptors: 'line-gap-override:25%', files: [REGULAR, ROBOTO, NOTO] },
  { id: 'all-overrides', descriptors: 'ascent-override:95.5%;descent-override:20.25%;line-gap-override:7%', files: [REGULAR, MONO] },
  { id: 'size-adjust-small', descriptors: 'size-adjust:90%', files: [REGULAR, ROBOTO, NOTO] },
  { id: 'size-adjust-large', descriptors: 'size-adjust:137.5%', files: [REGULAR, MONO] },
  { id: 'size-adjust-and-overrides', descriptors: 'size-adjust:110%;ascent-override:100%;descent-override:25%;line-gap-override:10%', files: [ROBOTO, NOTO] },
];

async function captureMetrics(): Promise<unknown> {
  const rows: unknown[] = [];
  for (const dpr of DPRS) {
    const browser = await launchChrome(dpr);
    try {
      const page = await newPage(browser, dpr);
      for (const v of METRIC_VARIANTS) {
        for (const file of v.files) {
          const blocks = SIZES.map((s, i) => `<div class="b" style="font-size:${s}px" id="s${i}"><span class="m"></span>x<i style="width:1ex"></i><i style="width:1ch"></i><i style="width:1cap"></i></div>`).join('');
          const css = `@font-face{font-family:M;src:url("${dataUri(file)}") format("truetype");${v.descriptors}}body{margin:0}.b{position:absolute;top:0;left:0;font-family:M;line-height:normal;white-space:nowrap}.m{display:inline-block;width:0;height:0}i{display:block;position:absolute}`;
          await page.setContent(`<!DOCTYPE html><html><head><style>${css}</style></head><body>${blocks}</body></html>`);
          await settle(page);
          const got = await page.evaluate(() => [...document.querySelectorAll('div.b')].map((d) => {
            const units = [...d.querySelectorAll('i')].map((i) => ((i as unknown as { computedStyleMap(): { get(p: string): { value: number } } }).computedStyleMap().get('width')).value);
            const box = d.getBoundingClientRect();
            const m = (d.querySelector('.m') as Element).getBoundingClientRect();
            return { ex: units[0], ch: units[1], cap: units[2], height: box.height, baseline: m.top - box.top, top: box.top };
          }));
          got.forEach((g, i) => rows.push({ variant: v.id, descriptors: v.descriptors, file, dpr, size: SIZES[i], ...g }));
        }
      }
      await page.context().close();
    } finally {
      await browser.close();
    }
  }
  return { ...header(DPRS), sizes: SIZES, rows };
}

// ---------------------------------------------------------------------------------------------------------------- (c)
const PARSE_CASES: readonly string[] = [
  'font-family:A;src:url(a.ttf)',
  'font-family:"A b";src:url("a.ttf") format("truetype")',
  'font-family:A  b   c;src:url(a.ttf) format(truetype)',
  'font-family:serif;src:url(a.ttf)',
  'font-family:"serif";src:url(a.ttf)',
  'font-family:inherit;src:url(a.ttf)',
  'font-family:default;src:url(a.ttf)',
  'font-family:default x;src:url(a.ttf)',
  'font-family:ui-monospace;src:url(a.ttf)',
  'font-family:A, B;src:url(a.ttf)',
  'font-family:1A;src:url(a.ttf)',
  'src:url(a.ttf)',
  'font-family:A',
  'font-family:A;src:url(a.ttf) format("woff2"), url(b.ttf) format("embedded-opentype"), url(c.ttf) format(svg), url(d.ttf)',
  'font-family:A;src:url(a.ttf) format("TrueType"), url(b.ttf) format("truetype-variations"), url(c.otf) format(opentype) tech(variations)',
  'font-family:A;src:url(a.ttf) tech(color-svg), url(b.ttf) tech(incremental), url(c.ttf) tech(features-opentype, palettes)',
  'font-family:A;src:url(a.ttf) format(foo), url(b.ttf) format(truetype, opentype), url(c.ttf) format()',
  'font-family:A;src:local(Foo Bar), local("Baz"), local(), url(x.ttf)',
  'font-family:A;src:url(a.ttf) junk, url(b.ttf)',
  'font-family:A;src:junk',
  'font-family:A;src:url(a.ttf);font-weight:bold',
  'font-family:A;src:url(a.ttf);font-weight:100 900',
  'font-family:A;src:url(a.ttf);font-weight:900 100',
  'font-family:A;src:url(a.ttf);font-weight:0',
  'font-family:A;src:url(a.ttf);font-weight:1001',
  'font-family:A;src:url(a.ttf);font-weight:auto',
  'font-family:A;src:url(a.ttf);font-weight:bolder',
  'font-family:A;src:url(a.ttf);font-weight:450.5',
  'font-family:A;src:url(a.ttf);font-weight:400 500 600',
  'font-family:A;src:url(a.ttf);font-weight:700;font-weight:junk',
  'font-family:A;src:url(a.ttf);font-weight:700 !important',
  'font-family:A;src:url(a.ttf);font-style:italic',
  'font-family:A;src:url(a.ttf);font-style:oblique',
  'font-family:A;src:url(a.ttf);font-style:oblique 10deg',
  'font-family:A;src:url(a.ttf);font-style:oblique 30deg 10deg',
  'font-family:A;src:url(a.ttf);font-style:oblique 0deg',
  'font-family:A;src:url(a.ttf);font-style:oblique 0deg 0deg',
  'font-family:A;src:url(a.ttf);font-style:oblique 91deg',
  'font-family:A;src:url(a.ttf);font-style:oblique 1rad',
  'font-family:A;src:url(a.ttf);font-style:oblique 0.5turn',
  'font-family:A;src:url(a.ttf);font-style:auto',
  'font-family:A;src:url(a.ttf);font-style:oblique 10',
  'font-family:A;src:url(a.ttf);font-stretch:condensed',
  'font-family:A;src:url(a.ttf);font-stretch:50% 200%',
  'font-family:A;src:url(a.ttf);font-stretch:200% 50%',
  'font-family:A;src:url(a.ttf);font-stretch:-10%',
  'font-family:A;src:url(a.ttf);font-stretch:auto',
  'font-family:A;src:url(a.ttf);font-stretch:1e2%',
  'font-family:A;src:url(a.ttf);unicode-range:U+0-7F, U+4??, u+1e1ee',
  'font-family:A;src:url(a.ttf);unicode-range:U+7F-0',
  'font-family:A;src:url(a.ttf);unicode-range:U+110000',
  'font-family:A;src:url(a.ttf);unicode-range:U+41',
  'font-family:A;src:url(a.ttf);font-display:swap',
  'font-family:A;src:url(a.ttf);font-display:bogus',
  'font-family:A;src:url(a.ttf);size-adjust:90%',
  'font-family:A;src:url(a.ttf);size-adjust:-1%',
  'font-family:A;src:url(a.ttf);size-adjust:90',
  'font-family:A;src:url(a.ttf);ascent-override:normal;descent-override:12.5%;line-gap-override:0%',
  'font-family:A;src:url(a.ttf);ascent-override:-5%',
  'font-family:A;src:url(a.ttf);font-feature-settings:"liga" 0, "kern"',
  'font-family:A;src:url(a.ttf);font-feature-settings:liga',
  'font-family:A;src:url(a.ttf);font-variation-settings:"wght" 500',
  'font-family:A;src:url(a.ttf);color:red;--x:y',
  'FONT-FAMILY:A;SRC:url(a.ttf);FONT-WEIGHT:BOLD',
];

const FAMILY_LISTS: readonly string[] = [
  'Inter', '"Inter"', 'Inter Display', '"A b", sans-serif', 'serif', '"serif"', 'Serif', 'monospace, "monospace"', 'system-ui', '-webkit-body',
  'math', 'emoji', 'ui-monospace', 'fangsong', 'cursive, fantasy', 'inherit', 'default', 'default x', '1A', 'A, , B', 'A,', '"a\\"b"', 'Ab-c_d, e1',
  'initial x', 'revert-layer', '"x y" z', 'A /* c */ B',
];

async function captureParsing(browser: Browser): Promise<unknown> {
  const page = await newPage(browser, 1);
  const rules = [];
  for (const text of PARSE_CASES) {
    await page.setContent(`<!DOCTYPE html><html><head><style>@font-face{${text}}</style></head><body></body></html>`);
    const got = await page.evaluate((names) => {
      const rule = (document.styleSheets[0] as CSSStyleSheet).cssRules[0] as CSSFontFaceRule | undefined;
      const values = rule === undefined ? null : Object.fromEntries(names.map((n) => [n, rule.style.getPropertyValue(n)]));
      return { values, faces: document.fonts.size };
    }, [...DESCRIPTOR_NAMES]);
    rules.push({ css: text, ...got });
  }
  await page.setContent(`<!DOCTYPE html><html><head></head><body><div style="font-family:sentinel">${FAMILY_LISTS.map((_f, i) => `<p id="f${i}"></p>`).join('')}</div></body></html>`);
  const families = await page.evaluate((lists) => lists.map((l, i) => {
    const p = document.getElementById(`f${i}`) as HTMLElement;
    p.style.setProperty('font-family', l);
    return getComputedStyle(p).fontFamily;
  }), [...FAMILY_LISTS]);
  await page.context().close();
  return { ...header([1]), rules, families: FAMILY_LISTS.map((value, i) => ({ value, parentComputed: 'sentinel', computed: families[i] })) };
}

// ---------------------------------------------------------------------------------------------------------------- (d)
export const PINNED_MAP: FontMap = {
  generics: {
    monospace: { mode: 'pinned', family: 'Dragon Mono', faces: [{ src: `fonts/${MONO}` }] },
    'sans-serif': { mode: 'pinned', family: 'Dragon Sans', faces: [
      { src: `fonts/${LIGHT}`, weight: '300' }, { src: `fonts/${REGULAR}`, weight: '400' }, { src: `fonts/${ITALIC}`, weight: '400', style: 'italic' },
      { src: `fonts/${BOLD}`, weight: '700' }, { src: `fonts/${BOLDITALIC}`, weight: '700', style: 'italic' },
    ] },
    'ui-rounded': { mode: 'pinned', family: 'Dragon Rounded', faces: [{ src: `fonts/${NOTO}` }] },
    serif: { mode: 'platform' },
  },
  families: {
    'Brand Face': { mode: 'pinned', family: 'Dragon Brand', faces: [{ src: `fonts/${ROBOTO}` }] },
    // The north star's 'Lato' (T036, T038): pinned to the vendored Lato 2.015 Regular and Bold under its own name.
    Lato: { mode: 'pinned', family: 'Lato', faces: [{ src: `fonts/${LATO}`, weight: '400' }, { src: `fonts/${LATO_BOLD}`, weight: '700' }] },
  },
};
const PINNED_REQUESTS: readonly Request[] = [
  req('monospace', 400), req('sans-serif', 300), req('sans-serif', 400), req('sans-serif', 400, 100, 'italic'), req('sans-serif', 700), req('sans-serif', 800, 100, 'italic'),
  req('sans-serif', 500), req('ui-rounded', 400), req('"Brand Face", monospace', 400), req('Unknown, monospace', 400), req('monospace, sans-serif', 700),
  req("'Lato', sans-serif", 400), req("'Lato', sans-serif", 700), req('Lato', 400, 100, 'italic'), req('"sans-serif", monospace', 400),
];

async function capturePinned(browser: Browser): Promise<unknown> {
  const page = await newPage(browser, 1);
  const requests = PINNED_REQUESTS.map((r) => {
    const list = parseFamilyList(r.family);
    if (list === null) throw new Error(`invalid family list ${r.family}`);
    const rewrite = rewriteFamilyList(list, PINNED_MAP, new Set(), (src) => src);
    return { ...r, rewritten: rewrite.value, fontFaceRules: rewrite.fontFaceRules };
  });
  const rules = [...new Set(requests.flatMap((r) => r.fontFaceRules))];
  const body = requests.map((r, i) => `<div id="p${i}" style="font-family:${escapeAttr(r.rewritten)};font-weight:${r.weight};font-style:${r.style}">${r.text}</div>`).join('');
  await page.setContent(`<!DOCTYPE html><html><head><style>${embed(rules.join('\n'))}</style></head><body>${body}</body></html>`);
  await settle(page);
  const fonts = await platformFonts(page, requests.map((_r, i) => `#p${i}`));
  await page.context().close();
  return { ...header([1]), map: PINNED_MAP, requests: requests.map((r, i) => ({ ...r, chrome: fonts[i] })) };
}

// ---------------------------------------------------------------------------------------------------------------- (e)
const PLATFORM_KEYS = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong'];

async function capturePlatform(browser: Browser): Promise<unknown> {
  const page = await newPage(browser, 1);
  await page.setContent(`<!DOCTYPE html><html><head></head><body>${PLATFORM_KEYS.map((k, i) => `<div id="g${i}" style="font-family:${k}">Aa</div>`).join('')}</body></html>`);
  await settle(page);
  const fonts = await platformFonts(page, PLATFORM_KEYS.map((_k, i) => `#g${i}`));
  await page.context().close();
  return { ...header([1]), note: 'data for the caveat label only; no pass claim', generics: PLATFORM_KEYS.map((key, i) => ({ key, chrome: fonts[i] })) };
}

// ---------------------------------------------------------------------------------------------------------------- main
async function captureAll(dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const write = (name: string, v: unknown): void => writeFileSync(join(dir, name), `${JSON.stringify(v, null, 1)}\n`);
  const browser = await launchChrome(1);
  try {
    write('matching.json', await captureMatching(browser));
    write('parsing.json', await captureParsing(browser));
    write('pinned.json', await capturePinned(browser));
    write('platform.json', await capturePlatform(browser));
  } finally {
    await browser.close();
  }
  write('metrics.json', await captureMetrics());
}

const check = process.argv.includes('--check');
if (!check) {
  await captureAll(repoPath(CAPTURE_DIR));
  console.log(`font captures written to ${CAPTURE_DIR}`);
} else {
  const tmp = mkdtempSync(join(tmpdir(), 'dragon-font-captures-'));
  try {
    await captureAll(tmp);
    const committed = readdirSync(repoPath(CAPTURE_DIR)).sort();
    const fresh = readdirSync(tmp).sort();
    const differ = fresh.filter((f) => !committed.includes(f) || !readFileSync(join(tmp, f)).equals(readFileSync(repoPath(join(CAPTURE_DIR, f)))));
    const extra = committed.filter((f) => !fresh.includes(f));
    if (differ.length > 0 || extra.length > 0) {
      console.error(`font captures differ from a fresh Chrome capture: ${[...differ, ...extra].join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`font captures byte-identical to a fresh capture (${fresh.length} files)`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
