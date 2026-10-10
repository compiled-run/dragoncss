// The lanes of the text-latin registry (fixture-groups/text-latin.ts; notes/T083-txt1a-1.md). Each case compiles with the reference
// font map for web, ios and android; native is blocked only by its deferred font refusals, so the engine lays out the engine
// projection (engineLayoutProjection) with the Node HarfBuzz host. The case must then pass linux-dragon-layout exactly (every
// compared edge equal at 1/64 px), chrome-dual exactly, the face check (CSS.getPlatformFontsForNode) in both documents, and the
// engine's line breaks must equal Chrome's. DPR 2, 3 and 2.625 run the DPR lane on their own captures. No native lane runs.
import { existsSync, readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import type { EngineFaults, GlyphShaper, LayoutInput, LayoutRect, LayoutUnsupported } from '@dragon/layout';
import type { Comparison } from './compare.ts';
import { compareLayout } from './compare.ts';
import { absoluteRects, layout, layoutWithFaults, NO_ENGINE_FAULTS, shapedMeasurerFor, validateLayoutInput } from '@dragon/layout';
import type { CompilerFaults, Compiled, Diagnostic, FrontEndResult } from 'dragon';
import { createProjectWith, engineLayoutProjection, nativeLayoutProjection, NO_FAULTS, webClassMap } from 'dragon';
import type { CapturedNode, WebCapture } from './capture.ts';
import { captureFixture, captureJson } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { CHROME_VERSION, openPage } from './chrome.ts';
import type { DprCaseOutcome } from './dpr.ts';
import { atDpr, dprLabel, runDprCase } from './dpr.ts';
import { ENVIRONMENT, FIXTURES } from './fixtures.ts';
import type { TextLatinFixture } from './fixture-groups/text-latin.ts';
import { withFontMapAssets } from './fixture-groups/fonts.ts';
import { faceProblem, fontCases, readFontCapture, referenceTransform } from './fonts-run.ts';
import type { PlatformFont } from './font-reference.ts';
import { platformFonts } from './font-reference.ts';
import type { BreakVector, ChromeBreakText, ChromeBreaks } from './line-breaks.ts';
import { breakVector, chromeBreaksText, compareVectorWithChrome, engineTextLines, leafTexts } from './line-breaks.ts';
import { fixtureInput } from './cases.ts';
import { PROJECT_ID } from './fixture-reader.ts';
import { repoPath } from './paths.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import type { CaseOutcome, RunOptions } from './pipeline.ts';
import { runCase, webCssOf } from './pipeline.ts';
import { hostShaper, REFERENCE_LANGUAGE, referenceShapedMeasurer, shapedFaceOf } from './text-shaper-host.ts';

/** Every DPR the registry runs at: 1, then the DPR lane's. */
export const TEXT_LATIN_DPRS: readonly number[] = [1, 2, 3, 2.625];

/** packages/parity/expected-text-latin/<platform>/dpr-<d>/<case>.web.json and .breaks.json, written only by the capture CLIs. */
export const textLatinDir = (dpr: number, platform: string = REFERENCE_PLATFORM): string => repoPath(`packages/parity/expected-text-latin/${platform}/${dprLabel(dpr)}`);
export const textLatinCapturePath = (caseId: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${textLatinDir(dpr, platform)}/${caseId}.web.json`;
export const textLatinBreaksPath = (caseId: string, dpr: number, platform: string = REFERENCE_PLATFORM): string => `${textLatinDir(dpr, platform)}/${caseId}.breaks.json`;
export const textLatinEmittedPath = (fixture: string, direction: 'ltr' | 'rtl'): string => repoPath(`packages/parity/expected-text-latin/emitted/${fixture}${direction === 'rtl' ? '-rtl' : ''}.css`);
/** packages/layout/vectors/text-latin/dpr-<d>/<case>.json: the engine input and output with the shape transcript (R3). */
export const textLatinVectorPath = (caseId: string, dpr: number): string => repoPath(`packages/layout/vectors/text-latin/${dprLabel(dpr)}/${caseId}.json`);

/**
 * A text-latin compile: web and ios (as pipeline.ts compiles FIXTURES; the android profile holds every row unsupported until a
 * native android case passes) with the fixture's font map and its faces as snapshot assets.
 */
export function compileTextLatin(f: TextLatinFixture, direction: 'ltr' | 'rtl', faults: CompilerFaults = NO_FAULTS, profiles: 'enforce' | 'derive' = 'enforce'): { input: FrontEndResult; compiled: Compiled<'ios' | 'web'> } {
  const input = f.map === null ? fixtureInput(f.spec) : withFontMapAssets(fixtureInput(f.spec), f.map);
  const rootFont = f.spec.kind === 'layout' ? f.spec.rootFont : 'ahem';
  const project = createProjectWith(
    { projectId: PROJECT_ID, targets: { ios: { minimum: '15.0' }, web: {} }, ...(f.map === null ? {} : { fonts: f.map }) },
    { faults, profiles, direction, platform: REFERENCE_PLATFORM, rootFont, foldViewport: ENVIRONMENT.viewport },
  );
  return { input, compiled: project.compile(input) };
}

/** The cases of a text-latin fixture (authored documents with their font URLs inlined). */
export const textLatinCases = (f: TextLatinFixture): ParityCase[] => fontCases(f);

/** Every face family the engine input of a projection names. */
function inputFaces(input: LayoutInput): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v !== 'object' || v === null) return;
    const o = v as Record<string, unknown>;
    if (typeof o['family'] === 'string' && typeof o['size'] === 'number') out.add(o['family']);
    for (const x of Object.values(o)) walk(x);
  };
  walk(input.root);
  return out;
}

/**
 * The admission guard of the registry (notes/T083-txt1a-1.md): a case belongs here only when its web output is ready, the engine
 * projection is ready and the native one blocked, every diagnostic that blocks ios or android is a DRAGON_UNSUPPORTED_FONT, the
 * engine lays out at least one face other than Ahem, and no FIXTURES fixture has its id. Returns the reasons it is not admitted.
 */
export function admissionProblems(f: TextLatinFixture, compiled: Compiled<'ios' | 'web'>, c: ParityCase): string[] {
  const problems: string[] = [];
  if (FIXTURES.some((x) => x.id === f.spec.id)) problems.push(`${f.spec.id} is also a FIXTURES fixture`);
  if (compiled.outputs.web.kind !== 'ready') problems.push('the web output is not ready');
  const engine = engineLayoutProjection(compiled, c.environment, c.assignment);
  const native = nativeLayoutProjection(compiled, c.environment, c.assignment);
  if (engine.kind !== 'ready') problems.push(`the engine projection is blocked: ${engine.reason}`);
  if (native.kind !== 'blocked') problems.push('the native projection is ready, so the case belongs in FIXTURES');
  const blocking = compiled.diagnostics.filter((d: Diagnostic) => d.severity === 'error' && (d.target === null || d.target === 'ios'));
  if (blocking.length === 0) problems.push('ios is not blocked');
  for (const d of blocking) if (!isNativeFontRefusal(d)) problems.push(`ios is blocked by ${d.code}: ${d.message}`);
  if (engine.kind === 'ready' && ![...inputFaces(engine.input)].some((x) => x !== 'Ahem')) problems.push('the engine lays out no face other than Ahem');
  return problems;
}

/** A native font refusal: DRAGON_UNSUPPORTED_FONT, or a profile refusal of a font-family feature (no native font row is proven yet). */
export const isNativeFontRefusal = (d: Diagnostic): boolean =>
  d.code === 'DRAGON_UNSUPPORTED_FONT' || ((d.code === 'DRAGON_UNSUPPORTED_VALUE' || d.code === 'DRAGON_UNPROVEN_CONTEXT') && d.profile !== null && d.profile.feature.startsWith('font-family:'));

/** Throws unless the case is admitted. */
export function requireAdmitted(f: TextLatinFixture, compiled: Compiled<'ios' | 'web'>, c: ParityCase): void {
  const p = admissionProblems(f, compiled, c);
  if (p.length > 0) throw new Error(`${c.id} is not a text-latin case: ${p.join('; ')}`);
}

/** The authored capture of a case at a DPR, live: the stated reference applied before the page is read. */
export const liveTextLatinCapture = (browser: Browser, f: TextLatinFixture, c: ParityCase, dpr: number): Promise<WebCapture> =>
  captureFixture(browser, c.id, c.authoredHtml, atDpr(c.environment, dpr), [], referenceTransform(f));

/**
 * Chrome's breaks of the open page as line-breaks.ts captureBreakTexts reads them, with the generated hyphen of a soft hyphen break
 * taken out: a text node's lines are its client rects joined per line (a hyphen rect shares its line's top), and a unit after
 * U+00AD takes the line of its last rect, since Chrome lists the previous line's hyphen first in that unit's Range.
 */
async function captureLatinBreakTexts(page: Page): Promise<ChromeBreakText[]> {
  return page.evaluate(() => {
    const out: { id: string; data: string; lines: number; units: number[]; blank: number[] }[] = [];
    const isBlank = (t: string): boolean => t.replace(/[ \t\n\r\f]+/g, ' ').trim() === '';
    for (const el of Array.from(document.querySelectorAll('[data-dragon-id]'))) {
      const id = el.getAttribute('data-dragon-id') as string;
      let k = 0;
      let spaces = 0;
      for (const child of Array.from(el.childNodes)) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const t = child as Text;
        const whole = document.createRange();
        whole.selectNodeContents(t);
        const lines: DOMRect[] = [];
        for (const r of Array.from(whole.getClientRects())) {
          const last = lines[lines.length - 1];
          if (last !== undefined && Math.abs(last.y - r.y) < 0.001 && Math.abs(last.height - r.height) < 0.001) continue;
          lines.push(r);
        }
        const blankNode = isBlank(t.data);
        const textId = blankNode ? `${id}:space${spaces++}` : `${id}:text${k++}`;
        if (blankNode && lines.length === 0) continue;
        const units: number[] = [];
        const blank: number[] = [];
        for (let i = 0; i < t.data.length; i++) {
          const r = document.createRange();
          r.setStart(t, i);
          r.setEnd(t, i + 1);
          const rects = Array.from(r.getClientRects());
          const pick = i > 0 && t.data.charCodeAt(i - 1) === 0xad && rects.length > 1 ? rects[rects.length - 1] : rects[0];
          if (pick === undefined || lines.length === 0) {
            units.push(-1);
            continue;
          }
          const cy = pick.y + pick.height / 2;
          let best = 0;
          lines.forEach((l, j) => {
            const b = lines[best] as DOMRect;
            if (Math.abs(l.y + l.height / 2 - cy) < Math.abs(b.y + b.height / 2 - cy)) best = j;
          });
          units.push(best);
          if (pick.width === 0) blank.push(i);
        }
        out.push({ id: textId, data: t.data, lines: lines.length, units, blank });
      }
    }
    return out;
  });
}

/** Chrome's breaks of a case at a DPR, live, under the stated reference (captureLatinBreakTexts). */
export async function liveTextLatinBreaks(browser: Browser, f: TextLatinFixture, c: ParityCase, dpr: number): Promise<ChromeBreaks> {
  const page = await openPage(browser, c.authoredHtml, atDpr(c.environment, dpr));
  try {
    const prepare = referenceTransform(f);
    if (prepare !== undefined) await prepare(page);
    return { case: c.id, chrome: CHROME_VERSION, dpr, texts: await captureLatinBreakTexts(page) };
  } finally {
    await page.context().close();
  }
}

/** The committed authored capture of a case at a DPR, checked as the fonts captures are (case, direction, Chrome, canonical bytes). */
export function committedTextLatinCapture(c: ParityCase, dpr: number): WebCapture {
  const path = textLatinCapturePath(c.id, dpr);
  if (!existsSync(path)) throw new Error(`no committed capture ${path}; run node --conditions=dragon-internal packages/parity/src/cli/text-latin-capture.ts`);
  const cap = readFontCapture(c, readFileSync(path, 'utf8'));
  if (cap.devicePixelRatio !== dpr) throw new Error(`${path}: captured at DPR ${cap.devicePixelRatio}, not ${dpr}`);
  return cap;
}

/** The committed Chrome breaks of a case at a DPR, checked against the case and in the form the capture writes. */
export function committedTextLatinBreaks(c: ParityCase, dpr: number): ChromeBreaks {
  const path = textLatinBreaksPath(c.id, dpr);
  if (!existsSync(path)) throw new Error(`no committed breaks ${path}`);
  const text = readFileSync(path, 'utf8');
  const b = JSON.parse(text) as ChromeBreaks;
  if (b.case !== c.id || b.dpr !== dpr || b.chrome !== CHROME_VERSION || !Array.isArray(b.texts)) throw new Error(`${path}: not the breaks of ${c.id} at DPR ${dpr} in Chrome ${CHROME_VERSION}`);
  if (chromeBreaksText(b) !== text) throw new Error(`${path}: not in the form the capture writes`);
  return b;
}

/**
 * Chrome's client rects of a text node list the generated hyphen of a soft hyphen break as a rect of its own, right after the text
 * of its line (a generated FragmentItem), while the engine's line piece holds the hyphen's inline size, as LineBreaker's text
 * result does. The capture's line rects of a text node are compared after joining each rect that starts where the one before it on
 * the same line ends (within 1/1000 px, the float noise of a non-integer DPR).
 */
export function joinHyphenRects(cap: WebCapture): WebCapture {
  const nodes: CapturedNode[] = [];
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.001;
  let group = '';
  let j = 0;
  for (const n of cap.nodes) {
    const m = n.kind === 'line' ? /^(.*:text\d+):line\d+$/.exec(n.id) : null;
    if (m === null) {
      nodes.push(n);
      group = '';
      continue;
    }
    const owner = m[1] as string;
    if (owner !== group) {
      group = owner;
      j = 0;
    }
    const prev = nodes[nodes.length - 1];
    if (j > 0 && prev !== undefined && near(prev.y, n.y) && near(prev.height, n.height) && near(prev.x + prev.width, n.x)) {
      nodes[nodes.length - 1] = { ...prev, width: n.x + n.width - prev.x };
      continue;
    }
    nodes.push({ ...n, id: `${owner}:line${j}` });
    j++;
  }
  return { ...cap, nodes };
}

/** The faces of each listed element's text in one rendering. */
async function facesOf(browser: Browser, html: string, c: ParityCase, ids: readonly string[], prepare: ReturnType<typeof referenceTransform>): Promise<PlatformFont[][]> {
  const page = await openPage(browser, html, c.environment);
  try {
    if (prepare !== undefined) await prepare(page);
    return await platformFonts(page, ids.map((id) => `[data-dragon-id="${id}"]`));
  } finally {
    await page.context().close();
  }
}

export type TextLatinOptions = {
  readonly authored: (c: ParityCase, dpr: number) => Promise<WebCapture>;
  readonly breaks: (c: ParityCase, dpr: number) => Promise<ChromeBreaks>;
  readonly faults?: CompilerFaults;
  readonly engineFaults?: EngineFaults;
  readonly profiles?: 'enforce' | 'derive';
};

/** The engine's breaks of an input against Chrome's: the problems, and how many text nodes were compared. */
export function breakProblems(caseId: string, dpr: number, input: LayoutInput, chrome: ChromeBreaks, faults: EngineFaults = NO_ENGINE_FAULTS): { readonly vector: BreakVector; readonly compared: number; readonly problems: readonly string[] } {
  const texts = engineTextLines(input, referenceShapedMeasurer(faults));
  const vector = breakVector(caseId, dpr, texts);
  const r = compareVectorWithChrome(vector, chrome, leafTexts(input.root));
  return { vector, compared: r.compared, problems: r.problems.map((p) => `${p.text}: ${p.detail}`) };
}

/** linux-dragon-layout on the engine projection with the host's HarfBuzz: every compared edge equal to Chrome's at 1/64 px. */
export function engineLane(c: ParityCase, compiled: Compiled<'ios' | 'web'>, authored: WebCapture, faults: EngineFaults): { readonly pass: boolean; readonly reason: string | null; readonly comparison: Comparison | null; readonly unsupported: LayoutUnsupported | null; readonly vector: { readonly input: LayoutInput; readonly output: readonly LayoutRect[] } | null } {
  const projection = engineLayoutProjection(compiled, c.environment, c.assignment);
  if (projection.kind === 'blocked') return { pass: false, reason: `linux-dragon-layout: no engine projection: ${projection.reason}`, comparison: null, unsupported: null, vector: null };
  const validated = validateLayoutInput(JSON.parse(JSON.stringify(projection.input)));
  if (!validated.ok) return { pass: false, reason: `linux-dragon-layout: layout input rejected: ${validated.errors.map((e) => `${e.path} ${e.code}`).join('; ')}`, comparison: null, unsupported: null, vector: null };
  const result = layoutWithFaults(validated.input, referenceShapedMeasurer(faults), faults);
  if (result.kind === 'unsupported') {
    const u = result.unsupported;
    return { pass: false, reason: `linux-dragon-layout: LayoutUnsupported ${u.code} at ${u.nodeId} (${u.specSection}): ${u.detail}`, comparison: null, unsupported: u, vector: null };
  }
  const comparison = compareLayout(authored, absoluteRects(result.boxes), validated.input, c.environment);
  const problems = [...comparison.problems];
  for (const n of comparison.nodes) if (n.dragon !== null && !n.exactLu) problems.push(`${n.id} is not exact at 1/64 px (chrome ${JSON.stringify(n.chrome)}, dragon ${JSON.stringify(n.dragon)})`);
  const pass = comparison.pass && problems.length === 0;
  return { pass, reason: pass ? null : `linux-dragon-layout: ${problems.join('; ')}`, comparison, unsupported: null, vector: pass ? { input: validated.input, output: result.boxes } : null };
}

/** Every case of a text-latin fixture at DPR 1: both lanes exactly, the face check and the break check. */
export async function runTextLatinFixture(f: TextLatinFixture, browser: Browser, opts: TextLatinOptions): Promise<CaseOutcome[]> {
  const out: CaseOutcome[] = [];
  const ids = Object.keys(f.faces);
  for (const c of textLatinCases(f)) {
    const { compiled } = compileTextLatin(f, c.environment.direction, opts.faults ?? NO_FAULTS, opts.profiles ?? 'enforce');
    requireAdmitted(f, compiled, c);
    const run: RunOptions = { authored: (k) => opts.authored(k, 1), faults: opts.faults ?? NO_FAULTS, engineFaults: opts.engineFaults ?? NO_ENGINE_FAULTS, profiles: opts.profiles ?? 'enforce' };
    const two = compiled;
    const raw = await runCase(c, two, webCssOf(two), browser, run, engineLayoutProjection);
    const authored = await opts.authored(c, 1);
    // linux-dragon-layout again against the capture with its hyphen rects joined (joinHyphenRects); chrome-dual stays raw.
    const engine = engineLane(c, two, joinHyphenRects(authored), run.engineFaults);
    const faceProblems: string[] = [];
    const unlisted = [...new Set(authored.nodes.filter((n) => n.kind === 'text').map((n) => n.id.replace(/:text\d+$/, '')))].filter((id) => !ids.includes(id));
    for (const id of unlisted) faceProblems.push(`${id} has text but no expected face`);
    const css = webCssOf(two);
    const classOf = webClassMap(two, c.assignment);
    if (css !== null && classOf !== null) {
      const authoredFaces = await facesOf(browser, c.authoredHtml, c, ids, referenceTransform(f));
      const compiledFaces = await facesOf(browser, c.compiledHtml(css, classOf), c, ids, undefined);
      ids.forEach((id, i) => {
        const expected = f.faces[id] as string;
        const pa = faceProblem(expected, authoredFaces[i] ?? []);
        const pb = faceProblem(expected, compiledFaces[i] ?? []);
        if (pa !== null) faceProblems.push(`${id} authored: ${pa}`);
        if (pb !== null) faceProblems.push(`${id} compiled: ${pb}`);
      });
    }
    const breaks: string[] = [];
    if (engine.vector !== null) {
      const b = breakProblems(c.id, 1, engine.vector.input, await opts.breaks(c, 1), run.engineFaults);
      if (b.compared === 0) breaks.push('no text node compared');
      breaks.push(...b.problems);
    }
    const layoutPass = engine.pass && breaks.length === 0;
    const dualPass = raw.lanes['chrome-dual'] === 'pass' && faceProblems.length === 0;
    const reasons = [
      engine.reason,
      breaks.length > 0 ? `breaks: ${breaks.join('; ')}` : null,
      raw.lanes['chrome-dual'] === 'pass' ? null : raw.dual === null ? raw.reason : `chrome-dual: ${raw.dual.problems.join('; ')}`,
      faceProblems.length > 0 ? `faces: ${faceProblems.join('; ')}` : null,
    ].filter((x): x is string => x !== null);
    const pass = layoutPass && dualPass;
    // Native draws none of these faces yet: the cases prove web rows only (ios features stay empty, as the fonts fixtures'). They
    // prove the font-family rows; their other features are the corpus's to prove, so the report, the parity test and profile:rows
    // all read the same keys.
    out.push({
      ...raw,
      features: { ios: [], web: raw.features.web.filter((k) => k.startsWith('font-family:')) },
      lanes: { 'linux-dragon-layout': layoutPass ? 'pass' : 'fail', 'chrome-dual': dualPass ? 'pass' : 'fail' },
      comparison: engine.comparison,
      unsupported: engine.unsupported,
      vector: layoutPass ? engine.vector : null,
      status: pass ? 'pass' : 'fail',
      reason: pass ? null : reasons.join(' | '),
    });
  }
  return out;
}

/** The DPR lane of every case of a fixture at one DPR (exact zoomed LU), and the break check there. */
export async function runTextLatinDpr(f: TextLatinFixture, dpr: number, opts: TextLatinOptions): Promise<(DprCaseOutcome & { readonly breakProblems: readonly string[] })[]> {
  const out: (DprCaseOutcome & { readonly breakProblems: readonly string[] })[] = [];
  for (const c of textLatinCases(f)) {
    const { compiled } = compileTextLatin(f, c.environment.direction, opts.faults ?? NO_FAULTS, opts.profiles ?? 'enforce');
    requireAdmitted(f, compiled, c);
    const capture = joinHyphenRects(await opts.authored(c, dpr));
    const r = runDprCase(c, compiled, dpr, capture, opts.engineFaults ?? NO_ENGINE_FAULTS, engineLayoutProjection);
    let breaks: string[] = [];
    if (r.vector !== null) {
      const b = breakProblems(c.id, dpr, r.vector.input, await opts.breaks(c, dpr), opts.engineFaults ?? NO_ENGINE_FAULTS);
      breaks = b.compared === 0 ? ['no text node compared'] : [...b.problems];
    }
    out.push({ ...r, breakProblems: breaks });
  }
  return out;
}

export const committedTextLatinOptions: TextLatinOptions = {
  authored: (c, dpr) => Promise.resolve(committedTextLatinCapture(c, dpr)),
  breaks: (c, dpr) => Promise.resolve(committedTextLatinBreaks(c, dpr)),
};

export const liveTextLatinOptions = (browsers: (dpr: number) => Browser, f: TextLatinFixture): TextLatinOptions => ({
  authored: (c, dpr) => liveTextLatinCapture(browsers(dpr), f, c, dpr),
  breaks: (c, dpr) => liveTextLatinBreaks(browsers(dpr), f, c, dpr),
});

// ---------------------------------------------------------------- R3 shape transcripts

/** One recorded GlyphShaper call and its integer result. */
export type ShapeCall = readonly [string, number, string, number, number, string, boolean, string, readonly number[], readonly number[]];

/** A recorder over the host shaper: every distinct call once, in first-use order. */
export function recordingShaper(): { readonly shaper: GlyphShaper; readonly calls: () => readonly ShapeCall[] } {
  const calls: ShapeCall[] = [];
  const seen = new Set<string>();
  const shaper: GlyphShaper = {
    shape(face, size, text, start, end, script, rtl, language, features) {
      const glyphs = hostShaper.shape(face, size, text, start, end, script, rtl, language, features);
      const key = JSON.stringify([face, size, text, start, end, script, rtl, language, features]);
      if (!seen.has(key)) {
        seen.add(key);
        calls.push([face, size, text, start, end, script, rtl, language, [...features], [...glyphs]]);
      }
      return glyphs;
    },
  };
  return { shaper, calls: () => calls };
}

/** A text-latin vector: the engine input and output, and the shape transcript a replay host needs (faces with their data, calls). */
export type TextLatinVector = {
  readonly platform: string;
  readonly measurer: string;
  readonly language: string;
  readonly faces: readonly { readonly id: string; readonly data: unknown; readonly hanKerning: unknown }[];
  readonly calls: readonly ShapeCall[];
  readonly input: LayoutInput;
  readonly output: readonly LayoutRect[];
};

/** Lays out the input with a recording shaper over the faces it names, and returns the vector (the layout must succeed). */
export function textLatinVector(input: LayoutInput): TextLatinVector {
  const faceIds = [...inputFaces(input)].sort();
  const faces = faceIds.map((id) => shapedFaceOf(id, REFERENCE_LANGUAGE));
  const rec = recordingShaper();
  const m = shapedMeasurerFor(REFERENCE_PLATFORM, new Map(faces.map((x) => [x.id, x] as const)), rec.shaper, REFERENCE_LANGUAGE, NO_ENGINE_FAULTS);
  if (m.kind !== 'ok') throw new Error(m.detail);
  const r = layout(input, m.measurer);
  if (r.kind !== 'ok') throw new Error(`the engine refused the vector input: ${r.unsupported.code} at ${r.unsupported.nodeId}: ${r.unsupported.detail}`);
  return { platform: REFERENCE_PLATFORM, measurer: m.key, language: REFERENCE_LANGUAGE, faces: faces.map((x) => ({ id: x.id, data: x.data, hanKerning: x.hanKerning })), calls: rec.calls(), input, output: r.boxes };
}

export const textLatinVectorText = (v: TextLatinVector): string => `${JSON.stringify(v, null, 1)}\n`;

export { captureJson };
