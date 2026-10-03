// The shaped cases of the corpus (TXT1a, notes/T083-txt1a-1.md and notes/T084-txt1a-2.md): a layout case is shaped when its engine
// input names a face other than Ahem, or when the Ahem measurer of the replay hosts (measurerFor) lays it out differently from the
// shaped one. Derived from the compiled input; no fixture carries a flag. A shaped case runs every FIXTURES lane, plus what real text
// needs: the engine lane against the capture with its generated hyphen rects joined (joinHyphenRects), every compared edge exact at
// 1/64 px, the face check (CSS.getPlatformFontsForNode) of every listed element in both documents, and the engine's breaks equal to
// Chrome's at DPR 1. Its vectors carry the shape transcript (R3) and live in packages/layout/vectors/text-latin/dpr-<d>/.
import type { Browser, Page } from 'playwright';
import type { EngineFaults, GlyphShaper, LayoutInput, LayoutRect, TextMeasurer } from '@dragon/layout';
import { layout, measurerFor, NO_ENGINE_FAULTS, shapedMeasurerFor } from '@dragon/layout';
import { iosLayoutProjection, NO_FAULTS } from 'dragon';
import type { CapturedNode, WebCapture } from './capture.ts';
import type { ParityCase } from './cases.ts';
import { CHROME_VERSION, openPage } from './chrome.ts';
import { layoutCases } from './dpr.ts';
import { TEXT_CALIBRATION_FACES } from './fixture-groups/text-calibration.ts';
import { INLINE_TAGS_FACES } from './fixture-groups/inline-tags.ts';
import { TEXT_LATIN_FACES } from './fixture-groups/text-latin.ts';
import { faceProblem } from './fonts-run.ts';
import type { PlatformFont } from './font-reference.ts';
import { platformFonts } from './font-reference.ts';
import type { BreakVector, ChromeBreaks } from './line-breaks.ts';
import { breakVector, captureBreakTexts, compareVectorWithChrome, engineTextLines, leafTexts } from './line-breaks.ts';
import { repoPath } from './paths.ts';
import { compileFixture } from './pipeline.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { hostShaper, REFERENCE_LANGUAGE, referenceShapedMeasurer, shapedFaceOf } from './text-shaper-host.ts';

/** Every DPR a shaped case's vectors are written at: 1, then the DPR lane's. */
export const TEXT_LATIN_DPRS: readonly number[] = [1, 2, 3, 2.625];

/** packages/layout/vectors/text-latin/dpr-<d>/: the engine input and output with the shape transcript (R3). */
export const textLatinVectorDir = (dpr: number): string => repoPath(`packages/layout/vectors/text-latin/dpr-${dpr}`);
export const textLatinVectorPath = (caseId: string, dpr: number): string => `${textLatinVectorDir(dpr)}/${caseId}.json`;

/** Every face family the engine input names. */
export function inputFaces(input: LayoutInput): Set<string> {
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

const ahem = measurerFor(REFERENCE_PLATFORM);

/**
 * Whether a case input is shaped: it names a face other than Ahem, or the Ahem measurer the replay hosts build from measurerFor gives
 * a different layout (or refusal) than the HarfBuzz measurer, so its vector needs a shape transcript to replay.
 */
export function isShapedInput(input: LayoutInput): boolean {
  if ([...inputFaces(input)].some((f) => f !== 'Ahem')) return true;
  if (ahem.kind !== 'ok') throw new Error(`${ahem.code}: ${ahem.detail}`);
  const a = layout(input, ahem.measurer);
  const s = layout(input, referenceShapedMeasurer());
  return JSON.stringify(a.kind === 'ok' ? a.boxes : a.unsupported) !== JSON.stringify(s.kind === 'ok' ? s.boxes : s.unsupported);
}

/** The faces Chrome must draw each listed element's text with in a fixture (data-dragon-id to postScriptName), or null. */
export function expectedFacesOf(fixture: string): { readonly [id: string]: string } | null {
  return TEXT_LATIN_FACES.get(fixture) ?? TEXT_CALIBRATION_FACES.get(fixture) ?? INLINE_TAGS_FACES.get(fixture) ?? null;
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
async function facesIn(browser: Browser, html: string, c: ParityCase, ids: readonly string[], prepare: ((page: Page) => Promise<void>) | null): Promise<PlatformFont[][]> {
  const page = await openPage(browser, html, c.environment);
  try {
    if (prepare !== null) await prepare(page);
    return await platformFonts(page, ids.map((id) => `[data-dragon-id="${id}"]`));
  } finally {
    await page.context().close();
  }
}

/**
 * The face check of a case: every element with text in the authored capture is listed, and every listed element's text is drawn
 * with its face alone in the authored document (under the stated reference) and in the compiled one.
 */
export async function faceCheck(browser: Browser, c: ParityCase, authored: WebCapture, compiledHtml: string, faces: { readonly [id: string]: string }): Promise<string[]> {
  const ids = Object.keys(faces);
  const problems: string[] = [];
  const unlisted = [...new Set(authored.nodes.filter((n) => n.kind === 'text').map((n) => n.id.replace(/:text\d+$/, '')))].filter((id) => !ids.includes(id));
  for (const id of unlisted) problems.push(`${id} has text but no expected face`);
  const a = await facesIn(browser, c.authoredHtml, c, ids, c.authoredPrepare);
  const b = await facesIn(browser, compiledHtml, c, ids, null);
  ids.forEach((id, i) => {
    const expected = faces[id] as string;
    const pa = faceProblem(expected, a[i] ?? []);
    const pb = faceProblem(expected, b[i] ?? []);
    if (pa !== null) problems.push(`${id} authored: ${pa}`);
    if (pb !== null) problems.push(`${id} compiled: ${pb}`);
  });
  return problems;
}

/** Chrome's breaks of a case at a DPR, live, under its stated reference (line-breaks.ts captureBreakTexts). */
export async function liveChromeBreaks(browser: Browser, c: ParityCase, dpr: number): Promise<ChromeBreaks> {
  const page = await openPage(browser, c.authoredHtml, { ...c.environment, devicePixelRatio: dpr });
  try {
    if (c.authoredPrepare !== null) await c.authoredPrepare(page);
    return { case: c.id, chrome: CHROME_VERSION, dpr, texts: await captureBreakTexts(page) };
  } finally {
    await page.context().close();
  }
}

/** The engine's breaks of an input against Chrome's: the problems, and how many text nodes were compared. */
export function breakProblems(caseId: string, dpr: number, input: LayoutInput, chrome: ChromeBreaks, faults: EngineFaults = NO_ENGINE_FAULTS): { readonly vector: BreakVector; readonly compared: number; readonly problems: readonly string[] } {
  const texts = engineTextLines(input, referenceShapedMeasurer(faults));
  const vector = breakVector(caseId, dpr, texts);
  const r = compareVectorWithChrome(vector, chrome, leafTexts(input.root));
  return { vector, compared: r.compared, problems: r.problems.map((p) => `${p.text}: ${p.detail}`) };
}

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

/** The shape transcript a replay host needs: the language, the faces with their data, and the calls. */
export type Shaping = {
  readonly language: string;
  readonly faces: readonly { readonly id: string; readonly data: unknown; readonly hanKerning: unknown }[];
  readonly calls: readonly ShapeCall[];
};

/** A text-latin vector: the engine input and output, and the shape transcript a replay host needs (faces with their data, calls). */
export type TextLatinVector = {
  readonly platform: string;
  readonly measurer: string;
  readonly language: string;
  readonly faces: Shaping['faces'];
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

/** The shape transcript of an input: every call the shaped measurer makes laying it out, over the faces it names. */
export function shapingOf(input: LayoutInput): Shaping {
  const faces = [...inputFaces(input)].sort().map((id) => shapedFaceOf(id, REFERENCE_LANGUAGE));
  const rec = recordingShaper();
  const m = shapedMeasurerFor(REFERENCE_PLATFORM, new Map(faces.map((x) => [x.id, x] as const)), rec.shaper, REFERENCE_LANGUAGE, NO_ENGINE_FAULTS);
  if (m.kind !== 'ok') throw new Error(m.detail);
  // A refused layout keeps the calls made before the refusal: a replay host refuses at the same point.
  engineTextLinesOrNone(input, m.measurer);
  return { language: REFERENCE_LANGUAGE, faces: faces.map((x) => ({ id: x.id, data: x.data, hanKerning: x.hanKerning })), calls: rec.calls() };
}

/** The device-side text loop over an input (engineTextLines), or nothing when the engine refuses the input. */
function engineTextLinesOrNone(input: LayoutInput, measurer: TextMeasurer): void {
  if (layout(input, measurer).kind === 'ok') engineTextLines(input, measurer);
}

/** The translate harness's engine line of a text-latin vector: its input, the faults, and its transcript. */
export const textLatinEngineLine = (v: TextLatinVector, faults: EngineFaults = NO_ENGINE_FAULTS): string =>
  JSON.stringify({ platform: v.platform, faults, input: v.input, shaping: { language: v.language, faces: v.faces, calls: v.calls } });

let shapedIds: ReadonlySet<string> | null = null;

/**
 * The shaped layout case ids (isShapedInput of each case's engine input at DPR 1, compiled as profile:rows derives, so a case is
 * classified before its rows exist). A case whose projection is blocked is not shaped; its lanes fail on their own.
 */
export function shapedCaseIds(): ReadonlySet<string> {
  if (shapedIds !== null) return shapedIds;
  const out = new Set<string>();
  for (const f of layoutCases()) {
    const byDirection = new Map<string, ReturnType<typeof compileFixture>['compiled']>();
    for (const c of f.cases) {
      let compiled = byDirection.get(c.environment.direction);
      if (compiled === undefined) {
        compiled = compileFixture(f.spec, NO_FAULTS, 'derive', c.environment.direction).compiled;
        byDirection.set(c.environment.direction, compiled);
      }
      const p = iosLayoutProjection(compiled, c.environment, c.assignment);
      if (p.kind === 'ready' && isShapedInput(p.input)) out.add(c.id);
    }
  }
  shapedIds = out;
  return out;
}
