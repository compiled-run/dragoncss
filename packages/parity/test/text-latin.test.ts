// TXT1a-1 and TXT1a-2 (notes/T056-txt1a-spec.md §3, amended by notes/T083-txt1a-1.md and notes/T084-txt1a-2.md). Phase A: Ahem through HarfBuzz. The Node host's
// shaped measurer must lay out every committed vector exactly as measurerFor's Ahem measurer does, equal Chrome on T082's 1,680
// Ahem runs, read the bundled Ahem's font data as the engine's constants, and refuse text outside Latin, Common and Inherited
// (R4). Each shaping plant that acts on Ahem through the engine's measurer must change a committed vector or T082's committed
// Chrome runs; the three that cannot act there are pinned inert on every committed vector, each with its reason.
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutInput, LayoutResult } from '@dragon/layout';
import { absoluteRects, AHEM_FACE_ID, AHEM_FONT_DATA, layout, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as dragon from 'dragon';
import type { ParityCase } from '../src/cases.ts';
import { casesOf, fixtureInput } from '../src/cases.ts';
import { launchChrome } from '../src/chrome.ts';
import { compareLayout } from '../src/compare.ts';
import { atDpr, committedDprCapture, layoutCases, runDprCase } from '../src/dpr.ts';
import { layout as layoutFixture } from '../src/fixture-groups/define.ts';
import { fontMapOf, withFontMapAssets } from '../src/fixture-groups/fonts.ts';
import type { FixtureSpec } from '../src/fixtures.ts';
import { ENVIRONMENT, FIXTURES } from '../src/fixtures.ts';
import { authoredFontHtml } from '../src/fonts-run.ts';
import { readChromeBreaks } from '../src/line-breaks.ts';
import { expectedFacesOf, shapedCaseIds } from '../src/text-latin-run.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { compileFixture } from '../src/pipeline.ts';
import { NO_FAULTS } from 'dragon';
import * as tl from '../src/text-latin-run.ts';
import { vectorCaseIds } from '../src/targets.ts';
import { repoPath } from '../src/paths.ts';
import { ahemFaceId, faceIdOf, fontDataOf, hostShaper, referenceShapedMeasurer } from '../src/text-shaper-host.ts';

type Vector = { readonly file: string; readonly input: LayoutInput; readonly output: unknown };

/** Every committed vector with an engine input and output: the DPR-1 vectors, the DPR vectors and the hand-written calc vectors. */
function vectors(): Vector[] {
  const out: Vector[] = [];
  for (const dir of ['packages/layout/vectors', 'packages/layout/vectors/dpr-2', 'packages/layout/vectors/dpr-3', 'packages/layout/vectors/dpr-2.625', 'packages/layout/vectors/calc']) {
    for (const f of readdirSync(repoPath(dir))) {
      if (!f.endsWith('.json')) continue;
      const v = JSON.parse(readFileSync(repoPath(`${dir}/${f}`), 'utf8')) as { input?: unknown; output?: unknown };
      if (v.input === undefined || v.output === undefined) throw new Error(`${dir}/${f} has no input or output`);
      const valid = validateLayoutInput(v.input);
      if (!valid.ok) throw new Error(`${dir}/${f}: ${JSON.stringify(valid.errors.slice(0, 3))}`);
      out.push({ file: `${dir}/${f}`, input: valid.input, output: v.output });
    }
  }
  return out;
}

const all = vectors();
const reference = measurerFor('darwin-arm64');
if (reference.kind !== 'ok') throw new Error(reference.detail);
const boxesOf = (r: LayoutResult): unknown => (r.kind === 'ok' ? r.boxes : r.unsupported);
const vectorNamed = (file: string): Vector => {
  const v = all.find((x) => x.file === file);
  if (v === undefined) throw new Error(`no committed vector ${file}`);
  return v;
};
/** The committed vectors whose layout a planted engine fault changes, through the shaped measurer with that fault. */
const changedBy = (faults: EngineFaults): string[] => {
  const m = referenceShapedMeasurer(faults);
  return all.filter((v) => JSON.stringify(boxesOf(layoutWithFaults(v.input, m, faults))) !== JSON.stringify(v.output)).map((v) => v.file);
};
/** T082's committed Chrome widths of Ahem nowrap runs: X repeated 1 to N times at each size. */
const ahemRuns = (): { font: { family: 'Ahem'; size: number; letterSpacing: number; wordSpacing: number; smallCaps: boolean }; text: string; lu: number }[] => {
  const cap = JSON.parse(readFileSync(repoPath('docs/research/text-spike/metric-rounding/captures/ahem-advances.json'), 'utf8')) as { widthsLayoutUnits: Record<string, number[]> };
  return Object.entries(cap.widthsLayoutUnits).flatMap(([size, widths]) => widths.map((lu, i) => ({ font: { family: 'Ahem' as const, size: Number(size), letterSpacing: 0, wordSpacing: 0, smallCaps: false }, text: 'X'.repeat(i + 1), lu })));
};
/** The table tags of a TrueType file's table directory. */
const tableTags = (bytes: Uint8Array): string[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint16(4) }, (_, i) => String.fromCharCode(...bytes.subarray(12 + 16 * i, 16 + 16 * i)));
};
/** The text of every text leaf of an input, in tree order. */
const leafTexts = (node: unknown): string[] => {
  if (node === null || typeof node !== 'object') return [];
  const n = node as { kind?: unknown; text?: unknown; children?: unknown };
  const own = n.kind === 'text' && typeof n.text === 'string' ? [n.text] : [];
  return [...own, ...(Array.isArray(n.children) ? n.children.flatMap(leafTexts) : [])];
};

describe('TXT1a-1 phase A: Ahem through HarfBuzz', () => {
  it('reads the bundled Ahem as the engine names it and as its constants hold it', () => {
    const id = ahemFaceId();
    expect(id).toBe(AHEM_FACE_ID);
    expect(faceIdOf(new Uint8Array(readFileSync(repoPath('vendor/fonts/Lato/Lato-Regular.ttf'))))).toBe('sha256:d636e4683231f931eda222d588e944d082bfd3bdba02f928bee461c0f185b251');
    const d = fontDataOf(id);
    expect({ ...d, advances: [] }).toEqual({ ...AHEM_FONT_DATA, advances: [] });
  });

  it(`lays out every committed vector exactly as measurerFor's Ahem measurer, and as the vector records (${all.length} vectors)`, () => {
    expect(all.length).toBeGreaterThan(1900);
    const mismatches: string[] = [];
    for (const v of all) {
      const shaped = boxesOf(layout(v.input, referenceShapedMeasurer()));
      const ahem = boxesOf(layout(v.input, reference.measurer));
      if (JSON.stringify(shaped) !== JSON.stringify(ahem)) mismatches.push(`${v.file}: differs from the Ahem measurer`);
      else if (Array.isArray(v.output) && JSON.stringify(shaped) !== JSON.stringify(v.output)) mismatches.push(`${v.file}: differs from its recorded output`);
    }
    expect(mismatches).toEqual([]);
  });

  it("equals Chrome on T082's 1,680 Ahem nowrap runs, where the Ahem measurer misses 40", () => {
    const cap = JSON.parse(readFileSync(repoPath('docs/research/text-spike/metric-rounding/captures/ahem-advances.json'), 'utf8')) as { widthsLayoutUnits: Record<string, number[]> };
    const shaped = referenceShapedMeasurer();
    let runs = 0;
    let shapedMisses = 0;
    let ahemMisses = 0;
    for (const [size, widths] of Object.entries(cap.widthsLayoutUnits)) {
      widths.forEach((lu, i) => {
        const font = { family: 'Ahem' as const, size: Number(size), letterSpacing: 0, wordSpacing: 0, smallCaps: false };
        const text = 'X'.repeat(i + 1);
        const s = shaped.measure(text, font);
        const a = reference.measurer.measure(text, font);
        runs++;
        if (!s.ok || s.measure.width !== lu) shapedMisses++;
        if (!a.ok || a.measure.width !== lu) ahemMisses++;
      });
    }
    expect({ runs, shapedMisses, ahemMisses }).toEqual({ runs: 1680, shapedMisses: 0, ahemMisses: 40 });
  });

  it('refuses a face the host was never given, and a feature list that is not whole records', () => {
    const m = referenceShapedMeasurer();
    const r = m.measure('X', { family: 'sha256:0000' as 'Ahem', size: 16, letterSpacing: 0, wordSpacing: 0, smallCaps: false });
    expect(r.ok).toBe(false);
    expect(() => m.metrics({ family: 'sha256:0000' as 'Ahem', size: 16, letterSpacing: 0, wordSpacing: 0, smallCaps: false })).toThrow(/no bundled face/);
    expect(() => hostShaper.shape(AHEM_FACE_ID, 16, 'X', 0, 1, 'Latn', false, 'en-US', [1, 2, 3])).toThrow(/whole records/);
  });

  // metricRoundingSwapped rounds Ahem's exact half px descents up, as the platform rule's half-down nodes show.
  it('catches metricRoundingSwapped on text-fractional-font-size', () => {
    const faults: EngineFaults = { ...NO_ENGINE_FAULTS, metricRoundingSwapped: true };
    const v = all.find((x) => x.file === 'packages/layout/vectors/text-fractional-font-size.json') as Vector;
    expect(v).toBeDefined();
    expect(boxesOf(layoutWithFaults(v.input, referenceShapedMeasurer(), NO_ENGINE_FAULTS))).toEqual(v.output);
    expect(boxesOf(layoutWithFaults(v.input, referenceShapedMeasurer(faults), faults))).not.toEqual(v.output);
  });

  // 12.5px Ahem advances 12.5px per glyph; whole-pixel positions round each advance.
  it('catches wholePixelPositions on text-fractional-font-size', () => {
    const faults: EngineFaults = { ...NO_ENGINE_FAULTS, wholePixelPositions: true };
    const v = vectorNamed('packages/layout/vectors/text-fractional-font-size.json');
    expect(boxesOf(layoutWithFaults(v.input, referenceShapedMeasurer(), NO_ENGINE_FAULTS))).toEqual(v.output);
    expect(boxesOf(layoutWithFaults(v.input, referenceShapedMeasurer(faults), faults))).not.toEqual(v.output);
  });

  // No committed vector runs Ahem long enough at a size whose advance is inexact in float for these two to act; T082's committed
  // Chrome runs do (7.77px, 93 and more glyphs), so they are caught against Chrome there.
  it("catches advanceNot16_16 and doubleAccumulation against T082's committed Chrome runs", () => {
    const runs = ahemRuns();
    for (const plant of ['advanceNot16_16', 'doubleAccumulation'] as const) {
      const m = referenceShapedMeasurer({ ...NO_ENGINE_FAULTS, [plant]: true });
      const misses = runs.filter((r) => {
        const got = m.measure(r.text, r.font);
        return !got.ok || got.measure.width !== r.lu;
      });
      expect(misses.length, plant).toBeGreaterThan(0);
    }
  });

  // These three cannot act through the engine's measurer on Ahem: kerningDropped and noReshapeAtBreak change only what GSUB, GPOS
  // or kern data shapes, which Ahem has none of (every offset is safe to break); noReshapeAtBreak and softHyphenWidthMissing act
  // only on real-font lines (inline.ts breakShapedLines), which Ahem text does not take; and no committed vector has a soft
  // hyphen, which the Ahem measurer refuses. shaping-gate.test.ts and text-latin-engine.test.ts catch all three on real faces.
  it('pins kerningDropped, noReshapeAtBreak and softHyphenWidthMissing inert on every committed Ahem vector, for the reasons above', () => {
    const tags = tableTags(new Uint8Array(readFileSync(repoPath('vendor/fonts/Ahem.ttf'))));
    expect(tags).toContain('glyf');
    expect(tags.filter((t) => ['GSUB', 'GPOS', 'kern', 'morx', 'kerx'].includes(t))).toEqual([]);
    expect(all.filter((v) => leafTexts((v.input as { root: unknown }).root).some((t) => t.includes('\u00ad'))).map((v) => v.file)).toEqual([]);
    for (const plant of ['kerningDropped', 'noReshapeAtBreak', 'softHyphenWidthMissing'] as const) expect(changedBy({ ...NO_ENGINE_FAULTS, [plant]: true }), plant).toEqual([]);
  });

  // R4: shaped Ahem has glyphs for some Greek and Han code points (U+03A9, U+6C34), which the engine's measurer must still refuse.
  it('refuses text outside Latin, Common and Inherited with text-script (R4), and latinCheckSkipped shapes it instead', () => {
    const v = vectorNamed('packages/layout/vectors/text-fractional-font-size.json');
    for (const foreign of ['X\u03a9X', '\u6c34']) {
      const input = JSON.parse(JSON.stringify(v.input)) as LayoutInput;
      let set = 0;
      const walk = (n: { kind: string; text?: string; children?: unknown[] }): void => {
        if (n.kind === 'text' && set === 0) {
          n.text = foreign;
          set++;
        }
        for (const c of n.children ?? []) walk(c as never);
      };
      walk(input.root as never);
      expect(set).toBe(1);
      const refused = layout(input, referenceShapedMeasurer());
      expect(refused.kind === 'unsupported' && [refused.unsupported.code, refused.unsupported.specSection], foreign).toEqual(['text-script', 'notes/T056-txt1a-spec.md R4']);
      // Skipped, the text is shaped and reaches the line breaker, whose ASCII pair table refuses it later.
      const skipped: EngineFaults = { ...NO_ENGINE_FAULTS, latinCheckSkipped: true };
      const shaped = layoutWithFaults(input, referenceShapedMeasurer(skipped), skipped);
      expect(shaped.kind === 'unsupported' && shaped.unsupported.code, foreign).toBe('line-break');
      expect(referenceShapedMeasurer(skipped).measure(foreign, { family: 'Ahem', size: 16, letterSpacing: 0, wordSpacing: 0, smallCaps: false }).ok, foreign).toBe(true);
    }
    const m = referenceShapedMeasurer();
    expect(m.measure('Xé X', { family: 'Ahem', size: 16, letterSpacing: 0, wordSpacing: 0, smallCaps: false }).ok).toBe(true);
    expect(m.measure('\u03a9', { family: 'Ahem', size: 16, letterSpacing: 0, wordSpacing: 0, smallCaps: false })).toEqual({ ok: false, code: 'text-script', reason: 'U+3A9 is outside Latin, Common and Inherited (R4)' });
    expect(m.measureRange('X\u03a9', 0, 1, { family: 'Ahem', size: 16, letterSpacing: 0, wordSpacing: 0, smallCaps: false })).toMatchObject({ ok: false, code: 'text-script' });
  });

  it('pins latinCheckSkipped inert on every committed vector, which is all Latin, Common and Inherited text', () => {
    expect(changedBy({ ...NO_ENGINE_FAULTS, latinCheckSkipped: true })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Phase B, as TXT1a-2 phase F absorbs it (notes/T084-txt1a-2.md): the text-latin and text-calibration groups are FIXTURES groups,
// every lane runs them, and a shaped case (text-latin-run.ts isShapedInput) adds the hyphen-joined exact engine lane, the face
// check and the DPR-1 break check in pipeline.ts runCase.

const { runEngineCase } = (await import(pathToFileURL(repoPath('packages/translate/harness/harness.ts')).href)) as { runEngineCase: (line: string) => string };
const { hexBits } = (await import(pathToFileURL(repoPath('packages/translate/harness/host.ts')).href)) as { hexBits: (s: string) => number };

const NEW_IDS = [
  'text-latin-lato', 'text-latin-punct', 'text-latin-faces', 'text-latin-flex', 'text-latin-words', 'text-latin-words-rtl', 'text-latin-metrics', 'text-ahem-fractional',
  'text-calibration-lato', 'text-calibration-sans', 'text-calibration-mono',
];
/** T133 (fixture-groups/inline-tags.ts): b, strong, em and i over real faces, appended after the TXT1a-2 cases. */
const TAG_IDS = ['inline-tags-faces', 'inline-tags-faces-rtl',
  // TXT-W1 (fixture-groups/text-weight.ts), appended after them.
  ...['numeric', 'relative', 'styles', 'nested-bold', 'nested-italic', 'contexts'].flatMap((n) => [`text-weight-${n}`, `text-weight-${n}-rtl`]),
  // TXT-W2 (fixture-groups/font-shorthand.ts), appended after them.
  ...['faces', 'synthesis'].flatMap((n) => [`font-shorthand-${n}`, `font-shorthand-${n}-rtl`]),
  // TXT2-b (fixture-groups/text-spacing.ts): the Lato and Dragon Sans letter-spacing case; its Ahem case lowers natively, a BASE-like case.
  'text-spacing-lato', 'text-spacing-lato-rtl',
  // TXT2-c (fixture-groups/white-space.ts): preserved white space in Lato, appended after them.
  'white-space-lato'];

/** TXT-W2's Ahem case (font: inherit over Ahem): captured under the reference map with its group, but unshaped, so it lowers natively. */
const AHEM_ADDED = ['font-shorthand-inherit', 'font-shorthand-inherit-rtl'];
/** TXT2-c's Ahem white-space cases: added after BASE, laid out natively, so no shaped case. */
const WHITE_SPACE_AHEM_IDS = ['white-space-preserve', 'white-space-wrap'];
/**
 * TXT2 text-align: justify (fixture-groups/text-justify.ts), TXT2-b word-spacing (fixture-groups/text-spacing.ts), TXT2-h text-indent
 * (fixture-groups/text-indent.ts) and TXT2-a overflow-wrap and word-break (fixture-groups/text-break.ts), after BASE: their Ahem cases
 * lower natively, their real-face ones are shaped. svg-colors (#297, fixture-groups/svg.ts) landed after BASE too and lowers natively,
 * and so do TXT2-g's -webkit-line-clamp cases (fixture-groups/line-clamp.ts, Ahem, one direction each) and TXT-W's Ahem case
 * (text-weight-ahem and text-weight-bold-ahem, fixture-groups/text-weight.ts), and so do touch-action-values, FX's filter-none (fixture-groups/filter.ts) and
 * PNT2's transform-extra-initial (fixture-groups/transform-extra.ts), and ZOOM's zoom-one (fixture-groups/zoom.ts).
 */
const LATER_NATIVE_IDS = ['charset-late', 'charset-late-rtl', 'charset-single-quotes', 'charset-single-quotes-rtl', 'charset-after-rules', 'charset-after-rules-rtl', 'page-dropped', 'page-dropped-rtl', 'speak-values', 'speak-values-rtl', 'gen-inline-text', 'gen-inline-text-rtl', 'gen-inline-empty', 'gen-flex-items', 'gen-flex-items-rtl', 'gen-abspos-overlay', 'gen-abspos-overlay-rtl', 'gen-block', 'gen-block-rtl', 'gen-cascade', 'gen-cascade-rtl', 'gen-static-empty', 'gen-static-empty-rtl', 'gen-hr-li', 'gen-hr-li-rtl', 'gen-counters-quotes', 'gen-counters-quotes-rtl', 'table-properties', 'table-properties-rtl', 'appearance-values', 'appearance-values-rtl', 'ui-colors-values', 'ui-colors-values-rtl', 'user-modify-values', 'user-modify-values-rtl', 'clip-path-basic', 'clip-path-basic-rtl', 'clip-path-nested', 'clip-path-nested-rtl', 'clip-path-circle', 'clip-path-circle-rtl', 'clip-path-polygon', 'clip-path-polygon-rtl', 'svg-stroke', 'svg-stroke-rtl', 'svg-dash', 'svg-dash-rtl', 'svg-geometry', 'svg-geometry-rtl', 'bg-position-keywords', 'bg-position-keywords-rtl', 'clip-rect-basic', 'clip-rect-basic-rtl', 'clip-rect-nested', 'clip-rect-nested-rtl', 'filter-none', 'filter-none-rtl', 'text-justify-ahem', 'text-justify-ahem-rtl', 'text-word-spacing-ahem', 'text-word-spacing-ahem-rtl', 'text-indent-ahem', 'text-indent-ahem-rtl', 'svg-colors', 'svg-colors-rtl', 'text-break-ahem', 'text-break-ahem-rtl', 'line-clamp-lines', 'line-clamp-nested', 'text-font-variant-ahem', 'text-font-variant-ahem-rtl', 'text-font-tuning-ahem', 'text-font-tuning-ahem-rtl', 'text-font-stretch-ahem', 'text-font-stretch-ahem-rtl', 'text-font-features-ahem', 'text-font-features-ahem-rtl', 'text-font-size-values-ahem', 'text-font-size-values-ahem-rtl', 'text-weight-ahem', 'text-weight-ahem-rtl', 'touch-action-values', 'touch-action-values-rtl', 'radius-logical', 'radius-logical-rtl', 'text-decoration-native-values', 'text-decoration-native-values-rtl', 'text-fill-stroke-initial', 'text-fill-stroke-initial-rtl', 'text-shadow-none', 'text-shadow-none-rtl', 'text-shadow-blur', 'text-shadow-blur-rtl', 'alias-background', 'alias-background-rtl', 'shadow-webkit-alias', 'shadow-webkit-alias-rtl', 'svg-opacity', 'svg-opacity-rtl', 'text-style-ahem', 'text-style-ahem-rtl', 'text-decoration-native-styles', 'text-decoration-native-styles-rtl', 'alias-font', 'alias-font-rtl', 'mask-initial', 'mask-initial-rtl', 'svg-paint-order', 'svg-paint-order-rtl', 'svg-rrect', 'svg-rrect-rtl', 'transform-extra-initial', 'transform-extra-initial-rtl', 'text-weight-bold-ahem', 'text-weight-bold-ahem-rtl', 'scroll-initial-longhands', 'scroll-initial-longhands-rtl', 'containment-initial', 'containment-initial-rtl', 'zoom-one', 'zoom-one-rtl', 'text-font-variant-caps-ahem', 'text-font-variant-caps-ahem-rtl', 'border-image-initial', 'border-image-initial-rtl', 'svg-vector-effect', 'svg-vector-effect-rtl', 'svg-inert', 'svg-inert-rtl'];
const LATER_SHAPED_IDS = ['text-justify-latin', 'text-justify-latin-rtl', 'text-word-spacing-lato', 'text-word-spacing-lato-rtl', 'text-word-spacing-nbsp', 'text-indent-latin', 'text-indent-latin-rtl', 'text-break-lato'];

const specOf = (id: string): FixtureSpec => {
  const f = FIXTURES.find((x) => x.id === id);
  if (f === undefined) throw new Error(`no fixture ${id}`);
  return f;
};
const caseOf = (id: string, direction: 'ltr' | 'rtl' = 'ltr'): ParityCase => {
  const spec = specOf(id);
  const c = casesOf(spec, compileFixture(spec).input).find((x) => x.environment.direction === direction);
  if (c === undefined) throw new Error(`no ${direction} case of ${id}`);
  return c;
};
const derived = (id: string, direction: 'ltr' | 'rtl' = 'ltr') => compileFixture(specOf(id), NO_FAULTS, 'derive', direction).compiled;
const probe = (id: string) => {
  const spec = layoutFixture(id, ['ltr'], 'ahem');
  const input = withFontMapAssets(fixtureInput(spec), FONT_REFERENCE_MAP);
  const project = dragon.createProjectWith({ projectId: 'dragon-parity', fonts: FONT_REFERENCE_MAP, targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: { width: 400, height: 300 } });
  return { input, compiled: (i: typeof input) => project.compile(i) };
};

describe('TXT1a-2 phase F: the text-latin cases are FIXTURES cases', () => {
  const BASE_LAYOUT_CASES = 837;
  const SHAPED = [...NEW_IDS, ...TAG_IDS];
  const ADDED = [...SHAPED, ...WHITE_SPACE_AHEM_IDS];
  it('keeps every BASE layout case in order, and adds exactly the text-latin, Ahem fractional and calibration cases, the T133 tag cases and the later groups', () => {
    const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));
    // BASE is batch #284's regenerated head da2a902a7e (text-batch2, #247, #282, #283, #275) with #285's, #280's and #286's groups, whose FIXTURES hold 813 BASE layout cases, plus G-INL's atomic-inline-grid, PNT1's outline-web and radius-double-web, resize-values, G3b's grid-baseline-axes PNT's text-decoration-native-current (825), PNT1's stacking-grid-items (827), GRID's grid-gap-units and CTX-PROOF's ctx-proof-flex-gap-units (831), and GRID's grid-item-units, grid-item-keywords and grid-item-calc-percent (837; svg-colors is a later group).
    // Groups added after the per-feature split run in id order after the legacy ones (fixtures.ts), so the text groups sit among them.
    const later = [...LATER_NATIVE_IDS, ...LATER_SHAPED_IDS];
    const base = ids.filter((id) => !ADDED.includes(id) && !AHEM_ADDED.includes(id) && !later.includes(id));
    expect(base.length).toBe(BASE_LAYOUT_CASES);
    expect(createHash('sha256').update(base.join('\n')).digest('hex')).toBe('739e78b81b992f0da66e6d303e3fa179dab694a6580576c8ff1ee72a649ffa77');
    expect(ids.filter((id) => ADDED.includes(id)).sort()).toEqual([...ADDED].sort());
    expect(ids.filter((id) => AHEM_ADDED.includes(id))).toEqual(AHEM_ADDED);
    expect(ids.filter((id) => later.includes(id)).sort()).toEqual([...later].sort());
    expect(ids.length).toBe(BASE_LAYOUT_CASES + ADDED.length + AHEM_ADDED.length + later.length);
  });

  it('derives the shaped cases from the compiled input alone: every new case, and no BASE case', () => {
    expect([...shapedCaseIds()].sort()).toEqual([...SHAPED, ...LATER_SHAPED_IDS].sort());
  });

  it('compiles each new case with the reference map, captures it under its stated reference, and lists its expected faces', () => {
    for (const id of [...NEW_IDS, ...TAG_IDS]) {
      const fixture = id.replace(/-rtl$/, '');
      expect(fontMapOf(fixture), id).toBe(FONT_REFERENCE_MAP);
      const c = caseOf(fixture, id.endsWith('-rtl') ? 'rtl' : 'ltr');
      expect(c.authoredPrepare, id).not.toBeNull();
      // The authored documents need no font URL inlining (fonts-run.ts authoredFontHtml is the identity on them).
      expect(authoredFontHtml(c.authoredHtml), id).toBe(c.authoredHtml);
      if (fixture !== 'text-ahem-fractional') expect(expectedFacesOf(fixture), id).not.toBeNull();
    }
    expect(expectedFacesOf('text-ahem-fractional')).toBeNull();
    for (const f of FIXTURES) if (![...NEW_IDS, ...TAG_IDS, ...AHEM_ADDED, ...LATER_SHAPED_IDS].includes(f.id) && f.kind === 'layout') expect(caseOf(f.id, f.environments[0]).authoredPrepare, f.id).toBeNull();
    // The Ahem font-shorthand case is captured under the reference map with its group.
    for (const id of AHEM_ADDED) expect(fontMapOf(id.replace(/-rtl$/, '')), id).toBe(FONT_REFERENCE_MAP);
  });

  it('makes the Ahem fractional case shaped because the Ahem measurer misses Chrome there, and HarfBuzz does not', () => {
    const p = dragon.iosLayoutProjection(derived('text-ahem-fractional'), caseOf('text-ahem-fractional').environment, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    expect([...tl.inputFaces(p.input)]).toEqual([AHEM_FACE_ID]);
    expect(boxesOf(layout(p.input, reference.measurer))).not.toEqual(boxesOf(layout(p.input, referenceShapedMeasurer())));
  });

  it('refuses every new real-face case on ios and android until TXT1a-2 phase R, and lowers it for the engine lane', () => {
    // The device runtime measures and draws only the bundled Ahem (emit/native-support.ts DragonBridge.measurer), so native keeps
    // TXT1a-1's deferred font refusal and the engine lane lowers the case in engine mode; the Ahem fractional case lowers natively
    // but is shaped, so it is no device case either (targets.ts vectorCaseIds).
    for (const id of [...NEW_IDS, ...TAG_IDS]) {
      const direction = id.endsWith('-rtl') ? 'rtl' : 'ltr';
      const c = derived(id.replace(/-rtl$/, ''), direction);
      const env = caseOf(id.replace(/-rtl$/, ''), direction).environment;
      expect(dragon.engineLayoutProjection(c, env, []).kind, id).toBe('ready');
      if (id === 'text-ahem-fractional') {
        expect(c.outputs.ios.kind, id).toBe('analysis-only');
        continue;
      }
      expect(c.diagnostics.filter((d) => d.severity === 'error' && d.target !== 'web').map((d) => `${d.target} ${d.code}`).filter((x) => !/^(ios|android) DRAGON_UNSUPPORTED_(FONT|VALUE)$/.test(x)), id).toEqual([]);
      expect([c.outputs.ios.kind, dragon.nativeLayoutProjection(c, env, []).kind], id).toEqual(['blocked', 'blocked']);
    }
    const device = new Set(vectorCaseIds());
    expect([...NEW_IDS, ...TAG_IDS].filter((id) => device.has(id))).toEqual([]);
  });

  it('gives every FIXTURES case native lowers the native projection as its engine projection, at every DPR', () => {
    let compared = 0;
    let engineOnly = 0;
    for (const { spec, cases } of layoutCases()) {
      const byDirection = new Map<string, ReturnType<typeof compileFixture>['compiled']>();
      for (const c of cases) {
        let compiled = byDirection.get(c.environment.direction);
        if (compiled === undefined) {
          compiled = compileFixture(spec, undefined, 'derive', c.environment.direction).compiled;
          byDirection.set(c.environment.direction, compiled);
        }
        for (const dpr of [1, 2, 3, 2.625]) {
          const env = atDpr(c.environment, dpr);
          const native = dragon.nativeLayoutProjection(compiled, env, c.assignment);
          if (native.kind === 'blocked') {
            engineOnly++;
            expect([...NEW_IDS, ...TAG_IDS, ...LATER_SHAPED_IDS], c.id).toContain(c.id);
            expect(dragon.engineLayoutProjection(compiled, env, c.assignment).kind, `${c.id} at DPR ${dpr}`).toBe('ready');
            continue;
          }
          expect(dragon.engineLayoutProjection(compiled, env, c.assignment), `${c.id} at DPR ${dpr}`).toEqual(native);
          compared++;
        }
      }
    }
    // The 10 real-face cases, T133's 2, the text-justify-latin ones and text-break-lato are native-refused (engine only); every other case, the Ahem
    // fractional and font-shorthand inherit ones too, lowers natively, TXT2-c's two Ahem white-space cases and text-justify-ahem among them.
    expect([compared, engineOnly]).toEqual([(BASE_LAYOUT_CASES + 1 + AHEM_ADDED.length + WHITE_SPACE_AHEM_IDS.length + LATER_NATIVE_IDS.length) * 4, (NEW_IDS.length - 1 + TAG_IDS.length + LATER_SHAPED_IDS.length) * 4]);
  });

  it('DRAGON_SYNTHETIC_FONT_STYLE fires on no FIXTURES case', () => {
    for (const spec of FIXTURES) {
      const directions = spec.kind === 'layout' ? spec.environments : ['ltr' as const];
      for (const d of directions) expect(compileFixture(spec, undefined, 'enforce', d).compiled.diagnostics.filter((x) => x.code === 'DRAGON_SYNTHETIC_FONT_STYLE').map((x) => x.message), spec.id).toEqual([]);
    }
  });

  it('refuses synthetic styles and variable faces in engine mode and on native, and names the synthetic style for native', () => {
    const syn = probe('text-latin-synthetic');
    const compiled = syn.compiled(syn.input);
    expect(compiled.diagnostics.filter((d) => d.code === 'DRAGON_SYNTHETIC_FONT_STYLE').map((d) => [d.target, d.message])).toEqual([['ios', 'text t:text0 in Lato at font-weight 400 and font-style italic would be drawn in synthetic oblique: no bundled Lato face has that style, and ios cannot reproduce Skia\'s synthetic style']]);
    expect(dragon.engineLayoutProjection(compiled, ENVIRONMENT, [])).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/more than deferred font refusals/) });
    expect(dragon.nativeLayoutProjection(compiled, ENVIRONMENT, []).kind).toBe('blocked');
    const vf = probe('text-latin-variable');
    const bytes = new Uint8Array(readFileSync(repoPath('docs/research/text-spike/fonts/Inter-VF.ttf')));
    const swapped = { ...vf.input, snapshot: { ...vf.input.snapshot, assets: vf.input.snapshot.assets.map((a) => (a.id === 'vendor/fonts/Inter/Inter-Regular.ttf' ? { ...a, bytes, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` } : a)) } };
    const vcompiled = vf.compiled(swapped);
    expect(dragon.engineLayoutProjection(vcompiled, ENVIRONMENT, [])).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/variable face/) });
    expect(dragon.nativeLayoutProjection(vcompiled, ENVIRONMENT, []).kind).toBe('blocked');
  });

  it('refuses text outside the Latin scope with a typed code, which planted fault latinCheckSkipped changes', () => {
    const p = dragon.engineLayoutProjection(derived('text-latin-words'), ENVIRONMENT, []);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const greek = JSON.parse(JSON.stringify(p.input).replace('Waves and wind over the quiet harbour', 'Κύματα και άνεμος')) as LayoutInput;
    const r = layout(greek, referenceShapedMeasurer());
    expect(r.kind === 'unsupported' ? r.unsupported.code : r.kind).toBe('text-script');
    const faults = { ...NO_ENGINE_FAULTS, latinCheckSkipped: true };
    const planted = layoutWithFaults(greek, referenceShapedMeasurer(faults), faults);
    expect(planted.kind === 'unsupported' ? planted.unsupported.code : planted.kind).not.toBe('text-script');
  });
});

describe('TXT1a-2 phase F: the shaped checks catch every shaping plant', () => {
  // Each planted shaping fault must make the engine differ from Chrome on a named text-latin case: at DPR 1 the engine lane
  // (hyphen-joined, exact) or the live DPR-1 breaks; at a DPR set the DPR lane or the committed break captures.
  const plants: readonly { readonly fault: keyof EngineFaults; readonly fixture: string; readonly dpr: number }[] = [
    { fault: 'advanceNot16_16', fixture: 'text-latin-lato', dpr: 1 },
    { fault: 'doubleAccumulation', fixture: 'text-latin-lato', dpr: 3 },
    { fault: 'noReshapeAtBreak', fixture: 'text-latin-punct', dpr: 1 },
    { fault: 'kerningDropped', fixture: 'text-latin-lato', dpr: 1 },
    { fault: 'wholePixelPositions', fixture: 'text-latin-lato', dpr: 1 },
    { fault: 'softHyphenWidthMissing', fixture: 'text-latin-punct', dpr: 1 },
    { fault: 'metricRoundingSwapped', fixture: 'text-latin-metrics', dpr: 2 },
  ];
  let browser: Awaited<ReturnType<typeof launchChrome>> | null = null;
  const chrome = async () => {
    if (browser === null) browser = await launchChrome();
    return browser;
  };
  afterAll(async () => {
    if (browser !== null) await (browser as Awaited<ReturnType<typeof launchChrome>>).close();
  });
  const differs = async (fixture: string, dpr: number, ef: EngineFaults): Promise<boolean> => {
    const c = caseOf(fixture);
    const compiled = derived(fixture);
    if (dpr !== 1) {
      const r = runDprCase(c, compiled, dpr, committedDprCapture(c.id, dpr), ef);
      if (r.status !== 'pass' || r.vector === null) return true;
      const b = readChromeBreaks(c.id, dpr);
      if (b === null) throw new Error(`no committed breaks of ${c.id} at DPR ${dpr}`);
      return tl.breakProblems(c.id, dpr, r.vector.input, b, ef).problems.length > 0;
    }
    const p = dragon.engineLayoutProjection(compiled, c.environment, c.assignment);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const out = layoutWithFaults(p.input, referenceShapedMeasurer(ef), ef);
    if (out.kind !== 'ok') return true;
    const cmp = compareLayout(tl.joinHyphenRects(committedDprCapture(c.id, 1)), absoluteRects(out.boxes), p.input, c.environment);
    if (!cmp.pass || cmp.nodes.some((n) => n.dragon !== null && !n.exactLu)) return true;
    return tl.breakProblems(c.id, 1, p.input, await tl.liveChromeBreaks(await chrome(), c, 1), ef).problems.length > 0;
  };
  for (const p of plants) {
    it(`catches the planted fault ${p.fault} on ${p.fixture} at DPR ${p.dpr}`, async () => {
      expect(await differs(p.fixture, p.dpr, NO_ENGINE_FAULTS), 'unfaulted').toBe(false);
      expect(await differs(p.fixture, p.dpr, { ...NO_ENGINE_FAULTS, [p.fault]: true })).toBe(true);
    }, 600_000);
  }
});

describe('TXT1a-2 phase F: text-latin vectors replay in the translated engine (R3)', () => {
  const dirs = [1, 2, 3, 2.625].map((d) => ({ dpr: d, dir: repoPath(`packages/layout/vectors/text-latin/dpr-${d}`) }));
  const vecs = dirs.flatMap(({ dpr, dir }) => readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => ({ dpr, file: `${dir}/${x}`, v: JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')) as ReturnType<typeof tl.textLatinVector> })));
  const lineOf = (v: ReturnType<typeof tl.textLatinVector>, faults: EngineFaults = NO_ENGINE_FAULTS): string => JSON.stringify({ platform: v.platform, faults, input: v.input, shaping: { language: v.language, faces: v.faces, calls: v.calls } });

  it('has a vector for every case at every DPR, each written from the committed captures', () => {
    expect(vecs.length).toBe((NEW_IDS.length + TAG_IDS.length + LATER_SHAPED_IDS.length) * 4);
    for (const { file, v } of vecs) expect(readFileSync(file, 'utf8'), file).toBe(tl.textLatinVectorText(tl.textLatinVector(v.input)));
  });

  it('lays out every vector in the TypeScript harness by replay exactly as the engine did', () => {
    for (const { file, v } of vecs) {
      const out = JSON.parse(runEngineCase(lineOf(v))) as unknown[];
      expect(out[0], file).toBe('ok');
      expect(out[1], file).toBe('shaped/darwin-arm64');
      const boxes = (out[2] as string[][]).map(([id, parent, x, y, w, h]) => ({ id, parent, x: hexBits(x as string), y: hexBits(y as string), width: hexBits(w as string), height: hexBits(h as string) }));
      expect(boxes, file).toEqual(v.output);
    }
  });

  it('fails a replay whose transcript lacks a call', () => {
    const { v } = vecs[0] as (typeof vecs)[number];
    const out = runEngineCase(JSON.stringify({ platform: v.platform, faults: NO_ENGINE_FAULTS, input: v.input, shaping: { language: v.language, faces: v.faces, calls: v.calls.slice(1) } }));
    expect(out).toMatch(/^\["harness-error","the shape transcript holds no call/);
  });
  // The Swift and Kotlin replays of these vectors run on the native shards: text-latin-native.test.ts.
});
