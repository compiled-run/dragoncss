// The lanes of the env() fixtures (fixture-groups/env.ts): Chrome renders both documents with the fixture's safe-area insets (CDP
// Emulation.setSafeAreaInsetsOverride), and every case must pass chrome-dual exactly. linux-dragon-layout lays out the native lowering
// with the same insets in its input, as a native mount feeds the root view's measured insets (DragonTree.safeArea, dragonSafeArea in
// emit/native-support.ts), and compares it with the authored capture; a case that passes both proves its ios rows.
import { readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import type { EngineFaults, LayoutUnsupported } from '@dragon/layout';
import { absoluteRects, layoutWithFaults, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import type { CompilerFaults } from 'dragon';
import { compiledFeatures, iosLayoutProjection, NO_FAULTS, resolvedColors, resolvedTextColors, textTopology, webClassMap } from 'dragon';
import type { WebCapture } from './capture.ts';
import { captureFixture, captureJson } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { casesOf, fixtureInput } from './cases.ts';
import { CHROME_VERSION } from './chrome.ts';
import type { Comparison } from './compare.ts';
import { compareLayout } from './compare.ts';
import { compareDual } from './dual.ts';
import type { EnvFixture, SafeAreaInsets } from './fixture-groups/env.ts';
import type { CaseOutcome } from './pipeline.ts';
import { compileFixture, webCssOf } from './pipeline.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { referenceShapedMeasurer } from './text-shaper-host.ts';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** A capture of an env() case: the Chrome capture and the insets Chrome reported while it was taken. */
export type EnvCapture = WebCapture & { readonly safeArea: SafeAreaInsets };

/** Insets the override accepts: whole, non-negative CSS px. */
export function checkedInsets(s: SafeAreaInsets): SafeAreaInsets {
  for (const side of SIDES) if (!Number.isInteger(s[side]) || s[side] < 0) throw new Error(`safe-area inset ${side} must be a whole, non-negative CSS px, got ${String(s[side])}`);
  return s;
}

/** The insets each env(safe-area-inset-*) reports in a page, measured with a probe element that is removed afterwards. */
export async function reportedInsets(page: Page): Promise<SafeAreaInsets> {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = { top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft) };
    probe.remove();
    return out;
  });
}

/** Sets the page's safe-area insets, waits two frames, and checks Chrome reports exactly them; throws otherwise. */
export function withSafeArea(insets: SafeAreaInsets): (page: Page) => Promise<void> {
  const s = checkedInsets(insets);
  return async (page) => {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: s.top, right: s.right, bottom: s.bottom, left: s.left } });
    } finally {
      await cdp.detach();
    }
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const got = await reportedInsets(page);
    if (SIDES.some((side) => got[side] !== s[side])) throw new Error(`Chrome reports safe-area insets ${JSON.stringify(got)}, not the requested ${JSON.stringify(s)}`);
  };
}

export const envCases = (f: EnvFixture): ParityCase[] => casesOf(f.spec, fixtureInput(f.spec));

/**
 * The committed web-only captures and emitted CSS: packages/parity/expected-env/<platform>/<case>.web.json and
 * packages/parity/expected-env/emitted/<fixture>[-rtl].css, written only by pnpm run parity:capture.
 */
export const envExpectedDir = (platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-env/${platform}`);
export const envExpectedPath = (caseId: string, platform: string = REFERENCE_PLATFORM): string => `${envExpectedDir(platform)}/${caseId}.web.json`;
export const envEmittedDir = (): string => repoPath('packages/parity/expected-env/emitted');
export const envEmittedPath = (fixture: string, direction: 'ltr' | 'rtl' = 'ltr'): string => `${envEmittedDir()}/${fixture}${direction === 'rtl' ? '-rtl' : ''}.css`;

/** One rendering of a case under the fixture's insets. */
async function captureWithInsets(browser: Browser, c: ParityCase, html: string, f: EnvFixture): Promise<EnvCapture> {
  const capture = await captureFixture(browser, c.id, html, c.environment, c.computedExtra, withSafeArea(f.safeArea));
  return { ...capture, safeArea: f.safeArea };
}

/** The live authored capture of an env case. */
export const liveEnvAuthored = (browser: Browser, f: EnvFixture) => (c: ParityCase): Promise<EnvCapture> => captureWithInsets(browser, c, c.authoredHtml, f);

/** The committed authored capture of an env case, checked: its case, direction, viewport, Chrome, insets and canonical bytes. */
export function readEnvCapture(c: ParityCase, f: EnvFixture, text: string): EnvCapture {
  const where = envExpectedPath(c.id);
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as WebCapture).nodes)) throw new Error(`${where}: not a capture`);
  const cap = raw as EnvCapture;
  if (cap.fixture !== c.id || cap.direction !== c.environment.direction || cap.chrome !== CHROME_VERSION) throw new Error(`${where}: captured for ${String(cap.fixture)} ${String(cap.direction)} in Chrome ${String(cap.chrome)}, not ${c.id} ${c.environment.direction} in ${CHROME_VERSION}`);
  if (cap.viewport?.width !== c.environment.viewport.width || cap.viewport.height !== c.environment.viewport.height) throw new Error(`${where}: viewport is not the case's`);
  if (typeof cap.safeArea !== 'object' || cap.safeArea === null || SIDES.some((s) => cap.safeArea[s] !== f.safeArea[s])) throw new Error(`${where}: captured with safe-area insets ${JSON.stringify(cap.safeArea)}, not the fixture's ${JSON.stringify(f.safeArea)}`);
  if (cap.nodes.length === 0) throw new Error(`${where}: no nodes`);
  if (captureJson(cap) !== text) throw new Error(`${where}: not in the form parity:capture writes`);
  return cap;
}

export const committedEnvAuthored = (f: EnvFixture) => (c: ParityCase): Promise<EnvCapture> => Promise.resolve(readEnvCapture(c, f, readFileSync(envExpectedPath(c.id), 'utf8')));

export type EnvRunOptions = {
  readonly authored: (c: ParityCase) => Promise<WebCapture>;
  readonly faults?: CompilerFaults;
  readonly engineFaults?: EngineFaults;
  readonly profiles?: 'enforce' | 'derive';
};

/** Every case of an env fixture through both lanes, each under the fixture's insets. */
export async function runEnvFixture(f: EnvFixture, browser: Browser, opts: EnvRunOptions): Promise<CaseOutcome[]> {
  const out: CaseOutcome[] = [];
  const engineFaults = opts.engineFaults ?? NO_ENGINE_FAULTS;
  for (const c of envCases(f)) {
    const { compiled } = compileFixture(f.spec, opts.faults ?? NO_FAULTS, opts.profiles ?? 'enforce', c.environment.direction);
    const projection = iosLayoutProjection(compiled, c.environment, c.assignment);
    const base = {
      id: c.id, fixture: c.fixture, index: c.index, direction: c.environment.direction, assignment: c.assignment, isInitial: c.isInitial,
      vector: null, textLines: [], topology: textTopology(compiled, c.assignment),
      features: { ios: projection.kind === 'ready' ? compiledFeatures(compiled, 'ios', c.assignment) : [], web: compiledFeatures(compiled, 'web', c.assignment) },
    };
    const css = webCssOf(compiled);
    const classOf = webClassMap(compiled, c.assignment);
    const colors = resolvedColors(compiled, c.assignment);
    const textColors = resolvedTextColors(compiled, c.assignment);
    if (css === null || classOf === null || colors === null || textColors === null) {
      const errors = compiled.diagnostics.filter((d) => d.target !== 'ios').map((d) => `${d.code} ${d.message}`).join('; ');
      out.push({ ...base, unsupported: null, comparison: null, dual: null, status: 'fail', reason: `web output not ready: ${errors}`, lanes: { 'linux-dragon-layout': 'not-run', 'chrome-dual': 'fail' } });
      continue;
    }
    const authored = await opts.authored(c);
    const reasons: string[] = [];

    // Lane linux-dragon-layout: the native lowering with the fixture's insets as the mount's measured ones.
    let layout: 'pass' | 'fail' = 'fail';
    let comparison: Comparison | null = null;
    let unsupported: LayoutUnsupported | null = null;
    if (projection.kind === 'blocked') {
      reasons.push(`linux-dragon-layout: ios output blocked: ${projection.reason}`);
    } else {
      const validated = validateLayoutInput(JSON.parse(JSON.stringify({ ...projection.input, safeArea: f.safeArea })));
      if (!validated.ok) {
        reasons.push(`linux-dragon-layout: layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}`);
      } else {
        const result = layoutWithFaults(validated.input, referenceShapedMeasurer(engineFaults), engineFaults);
        if (result.kind === 'unsupported') {
          unsupported = result.unsupported;
          reasons.push(`linux-dragon-layout: LayoutUnsupported ${unsupported.code} at ${unsupported.nodeId}: ${unsupported.detail}`);
        } else {
          comparison = compareLayout(authored, absoluteRects(result.boxes), validated.input, c.environment);
          if (comparison.pass) layout = 'pass';
          else reasons.push(`linux-dragon-layout: ${comparison.problems.join('; ')}`);
        }
      }
    }

    // Lane chrome-dual.
    const dual = compareDual(authored, await captureWithInsets(browser, c, c.compiledHtml(css, classOf), f), colors, textColors, c.computedExtra);
    if (!dual.pass) reasons.push(`chrome-dual: ${dual.problems.join('; ')}`);
    const pass = layout === 'pass' && dual.pass;
    out.push({ ...base, unsupported, comparison, dual, status: pass ? 'pass' : 'fail', reason: pass ? null : reasons.join(' | '), lanes: { 'linux-dragon-layout': layout, 'chrome-dual': dual.pass ? 'pass' : 'fail' } });
  }
  return out;
}
