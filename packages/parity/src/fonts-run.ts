// The web-only lane of the fonts fixtures (fixture-groups/fonts.ts): each case compiles through the parity pipeline, renders Dragon's
// web CSS (its font assets inlined) against the authored document under the stated reference, and must pass chrome-dual exactly and
// render every listed element's text with the expected face in both documents (CSS.getPlatformFontsForNode). linux-dragon-layout is
// not run: native targets refuse every font but Ahem until TXT1a.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import type { CompilerFaults } from 'dragon';
import { compiledFeatures, NO_FAULTS, resolvedColors, resolvedTextColors, textTopology, webClassMap } from 'dragon';
import type { WebCapture } from './capture.ts';
import { captureFixture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf, fixtureInput } from './cases.ts';
import { openPage } from './chrome.ts';
import { compareDual } from './dual.ts';
import type { FontFixture } from './fixture-groups/fonts.ts';
import { fontFaceUrls } from './fixture-reader.ts';
import type { PlatformFont } from './font-reference.ts';
import { applyFontReference, fontDataUrl, pinnedFaceCss, pinnedGenerics, platformFonts, VENDOR_FONTS, vendorFontBytes } from './font-reference.ts';
import type { CaseOutcome } from './pipeline.ts';
import { repoPath } from './paths.ts';
import { compileFixture, webCssOf } from './pipeline.ts';
import { REFERENCE_PLATFORM } from './platform.ts';

/** The authored document as Chrome loads it: each @font-face url() that names a vendored font inlined as a data: URL. */
export function authoredFontHtml(html: string): string {
  const ids = new Map(fontFaceUrls(html).map((u) => [u.specifier, u.id]));
  return html.replace(/@font-face\s*\{[^}]*\}/gi, (rule) => rule.replace(/url\(\s*(?:"([^"\\]*)"|'([^'\\]*)'|([^)"'\s\\]*))\s*\)/gi, (m, a?: string, b?: string, c?: string) => {
    const id = ids.get(a ?? b ?? c ?? '');
    return id === undefined ? m : `url("${fontDataUrl(vendorFontBytes(id.slice(VENDOR_FONTS.length)))}")`;
  }));
}

/** The stated-reference transform of a fixture with a font map; a fixture without one renders as authored. */
export function referenceTransform(f: FontFixture): ((page: Page) => Promise<void>) | undefined {
  if (f.map === null) return undefined;
  const map = f.map;
  const css = pinnedFaceCss(map, (src) => {
    if (!src.startsWith(VENDOR_FONTS)) throw new Error(`the reference map's face ${src} is not a vendored font`);
    return fontDataUrl(vendorFontBytes(src.slice(VENDOR_FONTS.length)));
  });
  const pinned = pinnedGenerics(map);
  return async (page) => {
    await applyFontReference(page, css, pinned);
  };
}

/** The cases of a fonts fixture, with the authored document's font URLs inlined. */
export function fontCases(f: FontFixture): ParityCase[] {
  return casesOf(f.spec, fixtureInput(f.spec)).map((c) => ({ ...c, authoredHtml: authoredFontHtml(c.authoredHtml) }));
}

/**
 * The committed web-only captures and emitted CSS, kept apart from the two-lane corpus's expected/ and emitted/ (whose every case has
 * a layout vector and whose root font is Ahem or the keyed UA font): packages/parity/expected-fonts/<platform>/<case>.web.json and
 * packages/parity/expected-fonts/emitted/<fixture>[-rtl].css, written only by pnpm run parity:capture.
 */
export const fontExpectedDir = (platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-fonts/${platform}`);
export const fontExpectedPath = (caseId: string, platform: string = REFERENCE_PLATFORM): string => `${fontExpectedDir(platform)}/${caseId}.web.json`;
export const fontEmittedDir = (): string => repoPath('packages/parity/expected-fonts/emitted');
export const fontEmittedPath = (fixture: string, direction: 'ltr' | 'rtl' = 'ltr'): string => `${fontEmittedDir()}/${fixture}${direction === 'rtl' ? '-rtl' : ''}.css`;
export const committedFontAuthored = (c: ParityCase): Promise<WebCapture> => Promise.resolve(JSON.parse(readFileSync(fontExpectedPath(c.id), 'utf8')) as WebCapture);

/** The live authored capture of a fonts case, under its stated reference. */
export const liveFontAuthored = (browser: Browser, f: FontFixture) => (c: ParityCase): Promise<WebCapture> =>
  captureFixture(browser, c.id, c.authoredHtml, c.environment, [], referenceTransform(f));

/** The faces of each listed element's text in one rendering. */
async function facesOf(browser: Browser, html: string, c: ParityCase, ids: readonly string[], prepare: ((page: Page) => Promise<void>) | undefined): Promise<PlatformFont[][]> {
  const page = await openPage(browser, html, c.environment);
  try {
    if (prepare !== undefined) await prepare(page);
    return await platformFonts(page, ids.map((id) => `[data-dragon-id="${id}"]`));
  } finally {
    await page.context().close();
  }
}

/** Why a face list is not the expected face: exactly one web font with that postScriptName, or for 'platform' no web font at all. */
export function faceProblem(expected: string, fonts: readonly PlatformFont[]): string | null {
  const got = fonts.map((x) => `${x.postScriptName}${x.isCustomFont ? '' : ' (platform)'}`).join(', ');
  if (expected === 'platform') return fonts.length > 0 && fonts.every((x) => !x.isCustomFont) ? null : `expected a platform face, got [${got}]`;
  return fonts.length === 1 && fonts[0]?.isCustomFont === true && fonts[0].postScriptName === expected ? null : `expected ${expected}, got [${got}]`;
}

export type FontRunOptions = {
  readonly authored: (c: ParityCase) => Promise<WebCapture>;
  readonly faults?: CompilerFaults;
  readonly profiles?: 'enforce' | 'derive';
};

/** Every case of a fonts fixture through the web-only lane. */
export async function runFontFixture(f: FontFixture, browser: Browser, opts: FontRunOptions): Promise<CaseOutcome[]> {
  const out: CaseOutcome[] = [];
  const ids = Object.keys(f.faces);
  for (const c of fontCases(f)) {
    const { compiled } = compileFixture(f.spec, opts.faults ?? NO_FAULTS, opts.profiles ?? 'enforce', c.environment.direction);
    const base = {
      id: c.id, fixture: c.fixture, index: c.index, direction: c.environment.direction, assignment: c.assignment, isInitial: c.isInitial,
      unsupported: null, comparison: null, vector: null, textLines: [], topology: textTopology(compiled, c.assignment),
      features: { ios: [], web: compiledFeatures(compiled, 'web', c.assignment) },
    };
    const fail = (reason: string): CaseOutcome => ({ ...base, dual: null, status: 'fail', reason, lanes: { 'linux-dragon-layout': 'not-run', 'chrome-dual': 'fail' } });
    const css = webCssOf(compiled);
    const classOf = webClassMap(compiled, c.assignment);
    const colors = resolvedColors(compiled, c.assignment);
    const textColors = resolvedTextColors(compiled, c.assignment);
    if (css === null || classOf === null || colors === null || textColors === null) {
      out.push(fail(`web output not ready: ${compiled.diagnostics.filter((d) => d.target !== 'ios').map((d) => `${d.code} ${d.message}`).join('; ')}`));
      continue;
    }
    const compiledHtml = c.compiledHtml(css, classOf);
    const dual = compareDual(await opts.authored(c), await captureFixture(browser, c.id, compiledHtml, c.environment), colors, textColors);
    const authoredFaces = await facesOf(browser, c.authoredHtml, c, ids, referenceTransform(f));
    const compiledFaces = await facesOf(browser, compiledHtml, c, ids, undefined);
    const problems = [...dual.problems];
    ids.forEach((id, i) => {
      const a = authoredFaces[i] ?? [];
      const b = compiledFaces[i] ?? [];
      const expected = f.faces[id] as string;
      const pa = faceProblem(expected, a);
      const pb = faceProblem(expected, b);
      if (pa !== null) problems.push(`${id} authored: ${pa}`);
      if (pb !== null) problems.push(`${id} compiled: ${pb}`);
      if (JSON.stringify(a.map((x) => [x.postScriptName, x.isCustomFont])) !== JSON.stringify(b.map((x) => [x.postScriptName, x.isCustomFont]))) problems.push(`${id}: the two renderings use different faces`);
    });
    const pass = dual.pass && problems.length === 0;
    out.push({ ...base, dual, status: pass ? 'pass' : 'fail', reason: pass ? null : `chrome-dual: ${problems.join('; ')}`, lanes: { 'linux-dragon-layout': 'not-run', 'chrome-dual': pass ? 'pass' : 'fail' } });
  }
  return out;
}
