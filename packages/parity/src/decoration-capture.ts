// The decoration capture (TDEC-a, notes/T148J-tdec.md, T148J-1): Chrome renders each decorated web-only case twice at DPR 1, 2, 3 and
// 2.625, as authored and with text-decoration-line: none !important injected, after checking that the two renderings lay out the
// same frames and lines. The decoration pixels are the pixels that differ, restricted to the pixels that are the background in
// the stripped rendering; the engine's snapped rects (layout/src/text-decoration.ts) over the stripped copy's layout, with the
// decorated compile's applied decorations, must paint exactly them, colour included. Where a glyph's ink is a solid run, the
// paint order shows too: under- and overlines go under the text, line-through over it.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { CompilerFaults, Environment, FrontEndResult } from 'dragon';
import { createProjectWith, NO_FAULTS, nativeLayoutProjection, resolvedTextColors } from 'dragon';
import type { LayoutBox, InlineChild, TextFont } from '@dragon/layout';
import { textDecoration as td, zoomInput, NO_ENGINE_FAULTS } from '@dragon/layout';
import type { AppliedDecoration, DecorationAnalysisFaults } from '../../dragon/src/analysis/text-decoration.ts';
import { appliedDecorationsOf, NO_DECORATION_ANALYSIS_FAULTS } from '../../dragon/src/analysis/text-decoration.ts';
import { readSfnt } from '../../dragon/src/fonts/sfnt.ts';
import type { ParityCase } from './cases.ts';
import { atDpr, dprLabel } from './dpr.ts';
import type { FontFixture } from './fixture-groups/fonts.ts';
import { FONT_FIXTURES, withFontMapAssets } from './fixture-groups/fonts.ts';
import { fixtureToInput, parseFixtureHtml } from './fixture-reader.ts';
import { fontCases } from './fonts-run.ts';
import { engineTextLines } from './line-breaks.ts';
import type { RgbaImage } from './native-compare.ts';
import { repoPath } from './paths.ts';
import { decodePng } from './pixel-reference.ts';
import { REFERENCE_PLATFORM } from './platform.ts';
import { faceIdOf, referenceShapedMeasurer, shapedInk } from './text-shaper-host.ts';

/** Every DPR the decoration capture renders, DPR 1 included. */
export const DECORATION_DPRS: readonly number[] = [1, 2, 3, 2.625];

/** The rule injected into both documents of the stripped copy: no element draws a decoration line. */
export const STRIP_RULE = '* { text-decoration-line: none !important; }';

/** The decorated web-only fixtures (fixture-groups/fonts.ts). */
export const decorationFixtures = (): FontFixture[] => FONT_FIXTURES.filter((f) => f.spec.id.startsWith('text-decoration-'));

/** Every case of the decorated fixtures. */
export const decorationCases = (): { readonly fixture: FontFixture; readonly case: ParityCase }[] => decorationFixtures().flatMap((f) => fontCases(f).map((c) => ({ fixture: f, case: c })));

export const decorationDir = (dpr: number): string => repoPath(`packages/parity/expected-decorations/${REFERENCE_PLATFORM}/${dprLabel(dpr)}`);
export const decorationPath = (caseId: string, dpr: number, stripped: boolean): string => `${decorationDir(dpr)}/${caseId}${stripped ? '.stripped' : ''}.png`;
export const DECORATION_MANIFEST = (): string => repoPath(`packages/parity/expected-decorations/${REFERENCE_PLATFORM}/manifest.json`);

/** The manifest: each capture's sha256, and the guard that the two renderings lay out the same frames and lines. */
export type DecorationManifest = { readonly chrome: string; readonly cases: readonly { readonly case: string; readonly dpr: number; readonly decorated: string; readonly stripped: string; readonly sameLayout: boolean }[] };

export const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The authored HTML of a case with the strip rule as its last rule; Chrome and Dragon read the same document. */
export function strippedHtml(html: string): string {
  const { style } = parseFixtureHtml(html);
  if (style === null) throw new Error('a decoration fixture needs a <style>');
  return `${html.slice(0, style.end)}\n${STRIP_RULE}\n${html.slice(style.end)}`;
}

/** Compiles a document of a decoration fixture as compileFixture does, in derive mode (the profiles are what this proves). */
export function compileHtml(f: FontFixture, html: string, direction: Environment['direction'], faults: CompilerFaults = NO_FAULTS) {
  const input: FrontEndResult = f.map === null ? fixtureToInput(f.spec.id, html) : withFontMapAssets(fixtureToInput(f.spec.id, html), f.map);
  const project = createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, web: {} }, ...(f.map === null ? {} : { fonts: f.map }) }, { faults, profiles: 'derive', direction, platform: REFERENCE_PLATFORM, rootFont: f.spec.kind === 'layout' ? f.spec.rootFont : 'ahem', foldViewport: { width: 400, height: 300 } });
  return project.compile(input);
}

/** One rect the engine paints, with its colour (8-bit straight alpha) and the text leaf it decorates. */
export type PaintedRect = td.DecorationRect & { readonly color: td.Rgba; readonly text: string; readonly ink: td.Rgba | null };

/** A case's predicted decorations, or the reason the engine refuses one (skip-ink-intercepts: TDEC-d). */
export type Prediction = { readonly kind: 'rects'; readonly rects: readonly PaintedRect[] } | { readonly kind: 'refused'; readonly code: 'skip-ink-intercepts'; readonly detail: string };

let underlineThicknessCache: Map<string, (size: number) => number> | null = null;
/** post.underlineThickness at a size, by face id: only the autoThicknessFromFont plant reads it. */
function underlineThicknessOf(face: string): (size: number) => number {
  if (underlineThicknessCache === null) {
    underlineThicknessCache = new Map();
    const root = repoPath('vendor/fonts');
    const files = readdirSync(root, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? readdirSync(`${root}/${d.name}`).filter((f) => f.endsWith('.ttf')).map((f) => `${root}/${d.name}/${f}`) : d.name.endsWith('.ttf') ? [`${root}/${d.name}`] : []));
    for (const file of files) {
      const bytes = new Uint8Array(readFileSync(file));
      const read = readSfnt(bytes);
      if (!read.ok) continue;
      const font = read.font;
      const thickness = font.post?.underlineThickness ?? 0;
      underlineThicknessCache.set(faceIdOf(bytes), (size) => (thickness * size) / font.head.unitsPerEm);
    }
  }
  const f = underlineThicknessCache.get(face);
  if (f === undefined) throw new Error(`no vendored face ${face}`);
  return f;
}

/** A computed thickness or underline offset in zoomed px. */
function decorationLength(v: AppliedDecoration['thickness'], dpr: number): td.DecorationLength {
  if (v.kind === 'length' && v.unit === 'px') return { kind: 'px', value: v.value * dpr };
  if (v.kind === 'percentage') return { kind: 'percent', value: v.value };
  if (v.kind === 'keyword' && v.value === 'auto') return { kind: 'auto' };
  throw new Error(`a decoration length the engine does not take: ${JSON.stringify(v)}`);
}

/** What a case's prediction reads that no plant changes: the two compiles, the stripped copy's text lines and fonts. */
type Prepared = {
  readonly decorated: ReturnType<typeof compileHtml>;
  readonly texts: ReturnType<typeof engineTextLines>;
  readonly fonts: ReadonlyMap<string, TextFont>;
  readonly root: LayoutBox;
  readonly metricsOf: (font: TextFont) => td.DecorationFont;
};

const prepared = new Map<string, Prepared>();

/** The stripped copy laid out at a DPR and the decorated compile, cached per case and DPR. */
function prepare(f: FontFixture, c: ParityCase, dpr: number): Prepared {
  const key = `${c.id}@${dpr}`;
  const hit = prepared.get(key);
  if (hit !== undefined) return hit;
  const decorated = compileHtml(f, c.authoredHtml, c.environment.direction);
  const stripped = compileHtml(f, strippedHtml(c.authoredHtml), c.environment.direction);
  const projection = nativeLayoutProjection(stripped, atDpr(c.environment, dpr), c.assignment);
  if (projection.kind !== 'ready') throw new Error(`${key}: the stripped copy has no layout projection: ${projection.reason}`);
  const m = referenceShapedMeasurer();
  const texts = engineTextLines(projection.input, m);
  // The zoomed input's fonts: an inline box's own, and each IFC root's strut (the root inline box a block's decoration uses).
  const zoomed = zoomInput(projection.input, NO_ENGINE_FAULTS);
  const fonts = new Map<string, TextFont>();
  const inline = (k: InlineChild): void => {
    if (k.kind === 'inline') {
      fonts.set(k.id, { family: k.font.family, size: k.font.size });
      for (const x of k.children) inline(x);
    }
  };
  const walk = (b: LayoutBox): void => {
    if (b.strut !== null) fonts.set(b.id, { family: b.strut.font.family, size: b.strut.font.size });
    for (const k of b.children) {
      if (k.kind === 'box') walk(k);
      // A replaced leaf (REPL-a) holds no text, so it has no decoration font.
      else if (k.kind !== 'replaced') inline(k);
    }
  };
  walk(zoomed.root);
  const metricsOf = (font: TextFont): td.DecorationFont => {
    const a = m.metrics(font).ascent / 64;
    return { floatAscent: a, ascent: a, size: font.size, underlineThickness: underlineThicknessOf(font.family)(font.size) };
  };
  const out = { decorated, texts, fonts, root: zoomed.root, metricsOf };
  prepared.set(key, out);
  return out;
}

/**
 * The engine's decorations of one case at a DPR: the stripped copy's layout and the decorated compile's applied decorations.
 * faults plant the geometry; compilerFaults the propagation.
 */
export function predictDecorations(f: FontFixture, c: ParityCase, dpr: number, faults: td.DecorationFaults = td.NO_DECORATION_FAULTS, compilerFaults: DecorationAnalysisFaults = NO_DECORATION_ANALYSIS_FAULTS): Prediction {
  const p = prepare(f, c, dpr);
  const analysis = appliedDecorationsOf(p.decorated, c.assignment, compilerFaults);
  if (analysis === null) throw new Error(`${c.id}: the decorated compile did not resolve`);
  if (analysis.unproven.length > 0) throw new Error(`${c.id}: decorations in an unproven context: ${JSON.stringify(analysis.unproven)}`);
  const inkOf = resolvedTextColors(p.decorated, c.assignment);
  const rects: PaintedRect[] = [];
  for (const t of p.texts) {
    const list = analysis.applied.get(t.id) ?? [];
    if (list.length === 0) continue;
    const textFont = p.metricsOf(t.font);
    const ink = inkOf?.get(t.id);
    for (const d of list) {
      // A block's decoration uses the root inline box of the text's line (its IFC root's strut); an inline box's, its own font.
      const boxFont = d.box !== t.container && !isBlock(p.root, d.box) ? p.fonts.get(d.box) : p.fonts.get(t.container);
      if (boxFont === undefined) throw new Error(`${c.id}: no font for the decorating box ${d.box}`);
      const font = p.metricsOf(boxFont);
      for (const line of t.lines) {
        const textTop = line.rect.y / 64;
        const baseline = textTop + textFont.ascent;
        const input: td.DecorationInput = {
          lines: d.lines, thickness: decorationLength(d.thickness, dpr), underlineOffset: decorationLength(d.underlineOffset, dpr),
          font, textFont, left: line.rect.x / 64, width: line.rect.width / 64, textTop, decoratingTop: baseline - font.ascent,
        };
        for (const r of td.decorationRects(input, faults)) {
          if (r.line !== 'line-through' && d.skipInk === 'auto') {
            const glyphs = shapedInk(t.font.family, t.font.size, String.fromCodePoint(...line.cps)).flatMap((g) => (g === null ? [] : [{ top: baseline - g.top, bottom: baseline - g.bottom }]));
            if (!td.skipInkClear(r, glyphs)) return { kind: 'refused', code: 'skip-ink-intercepts', detail: `${t.id} ${r.line} at DPR ${dpr}: a glyph's ink crosses the skip-ink band (TDEC-d)` };
          }
          rects.push({ ...r, color: { r: d.color.r, g: d.color.g, b: d.color.b, a: d.color.alpha }, text: t.id, ink: ink === undefined ? null : { r: ink.r, g: ink.g, b: ink.b, a: ink.alpha } });
        }
      }
    }
  }
  return { kind: 'rects', rects };
}

function isBlock(root: LayoutBox, id: string): boolean {
  if (root.id === id) return true;
  for (const k of root.children) if (k.kind === 'box' && isBlock(k, id)) return true;
  return false;
}

/** The outcome of one case at one DPR: decoration pixels compared, mismatches, and order checks on solid ink. */
export type DecorationCheck = { readonly decorationPixels: number; readonly matched: number; readonly inkChecked: number; readonly problems: readonly string[] };

const px = (img: RgbaImage, x: number, y: number): td.Rgba => {
  const i = (y * img.width + x) * 4;
  return { r: img.data[i] as number, g: img.data[i + 1] as number, b: img.data[i + 2] as number, a: img.data[i + 3] as number };
};
const same = (a: td.Rgba, b: td.Rgba): boolean => a.r === b.r && a.g === b.g && a.b === b.b;
const show = (c: td.Rgba): string => `${c.r},${c.g},${c.b}`;

/**
 * Compares Chrome's two renderings with the engine's rects. Every pixel that is the background in the stripped rendering must equal
 * the background with the engine's rects painted over it in order; every pixel where the stripped rendering is a text leaf's solid
 * ink colour inside one of its rects must show the rect under the text (unchanged) or over it (blended), as the paint order says.
 */
export function checkDecorations(decorated: RgbaImage, stripped: RgbaImage, rects: readonly PaintedRect[], background: td.Rgba): DecorationCheck {
  if (decorated.width !== stripped.width || decorated.height !== stripped.height) throw new Error('the two renderings differ in size');
  const W = stripped.width;
  const painted = new Map<number, td.Rgba>();
  const inkWant = new Map<number, td.Rgba>();
  for (const r of rects) {
    const x0 = Math.floor(r.left);
    const x1 = Math.ceil(r.right);
    for (let y = r.top; y < r.top + r.height; y++) {
      if (y < 0 || y >= stripped.height) continue;
      for (let x = x0; x < x1; x++) {
        if (x < 0 || x >= W) continue;
        const cov = td.columnAlpha(x, r.left, r.right, r.height);
        if (cov === 0) continue;
        const k = y * W + x;
        const s = px(stripped, x, y);
        if (same(s, background)) painted.set(k, td.blendOver(painted.get(k) ?? background, r.color, cov));
        else if (r.ink !== null && same(s, r.ink)) inkWant.set(k, r.beforeText ? (inkWant.get(k) ?? s) : td.blendOver(inkWant.get(k) ?? s, r.color, cov));
      }
    }
  }
  const problems: string[] = [];
  let decorationPixels = 0;
  let matched = 0;
  for (let y = 0; y < stripped.height; y++) {
    for (let x = 0; x < W; x++) {
      const s = px(stripped, x, y);
      if (!same(s, background)) continue;
      const d = px(decorated, x, y);
      const want = painted.get(y * W + x) ?? background;
      if (!same(d, s)) decorationPixels++;
      if (same(d, want)) {
        if (!same(d, s)) matched++;
      } else if (problems.length < 20) problems.push(`(${x},${y}) Chrome ${show(d)}, engine ${show(want)}`);
      else problems.push('');
    }
  }
  let inkChecked = 0;
  for (const [k, want] of inkWant) {
    const x = k % W;
    const y = (k - x) / W;
    inkChecked++;
    const d = px(decorated, x, y);
    if (!same(d, want)) problems.push(`ink (${x},${y}) Chrome ${show(d)}, engine ${show(want)}`);
  }
  return { decorationPixels, matched, inkChecked, problems: problems.filter((p) => p !== '') };
}

/** The committed renderings of a case at a DPR, or null when they were not captured. */
export function committedDecorations(caseId: string, dpr: number): { readonly decorated: RgbaImage; readonly stripped: RgbaImage } | null {
  const a = decorationPath(caseId, dpr, false);
  const b = decorationPath(caseId, dpr, true);
  if (!existsSync(a) || !existsSync(b)) return null;
  return { decorated: decodePng(readFileSync(a)), stripped: decodePng(readFileSync(b)) };
}

/** The committed manifest. */
export function decorationManifest(): DecorationManifest {
  return JSON.parse(readFileSync(DECORATION_MANIFEST(), 'utf8')) as DecorationManifest;
}

/** The files under the capture directory, for the pins. */
export const decorationFiles = (dpr: number): string[] => (existsSync(decorationDir(dpr)) ? readdirSync(decorationDir(dpr)).sort() : []);
