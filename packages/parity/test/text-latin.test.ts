// TXT1a-1 (notes/T056-txt1a-spec.md §3, amended by notes/T083-txt1a-1.md). Phase A: Ahem through HarfBuzz. The Node host's
// shaped measurer must lay out every committed vector exactly as measurerFor's Ahem measurer does, equal Chrome on T082's 1,680
// Ahem runs, read the bundled Ahem's font data as the engine's constants, and refuse text outside Latin, Common and Inherited
// (R4). Each shaping plant that acts on Ahem through the engine's measurer must change a committed vector or T082's committed
// Chrome runs; the three that cannot act there are pinned inert on every committed vector, each with its reason.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutInput, LayoutResult } from '@dragon/layout';
import { AHEM_FACE_ID, AHEM_FONT_DATA, layout, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
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
const ahemRuns = (): { font: { family: 'Ahem'; size: number }; text: string; lu: number }[] => {
  const cap = JSON.parse(readFileSync(repoPath('docs/research/text-spike/metric-rounding/captures/ahem-advances.json'), 'utf8')) as { widthsLayoutUnits: Record<string, number[]> };
  return Object.entries(cap.widthsLayoutUnits).flatMap(([size, widths]) => widths.map((lu, i) => ({ font: { family: 'Ahem' as const, size: Number(size) }, text: 'X'.repeat(i + 1), lu })));
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
        const font = { family: 'Ahem' as const, size: Number(size) };
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
    const r = m.measure('X', { family: 'sha256:0000' as 'Ahem', size: 16 });
    expect(r.ok).toBe(false);
    expect(() => m.metrics({ family: 'sha256:0000' as 'Ahem', size: 16 })).toThrow(/no bundled face/);
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
      expect(referenceShapedMeasurer(skipped).measure(foreign, { family: 'Ahem', size: 16 }).ok, foreign).toBe(true);
    }
    const m = referenceShapedMeasurer();
    expect(m.measure('Xé X', { family: 'Ahem', size: 16 }).ok).toBe(true);
    expect(m.measure('\u03a9', { family: 'Ahem', size: 16 })).toEqual({ ok: false, code: 'text-script', reason: 'U+3A9 is outside Latin, Common and Inherited (R4)' });
    expect(m.measureRange('X\u03a9', 0, 1, { family: 'Ahem', size: 16 })).toMatchObject({ ok: false, code: 'text-script' });
  });

  it('pins latinCheckSkipped inert on every committed vector, which is all Latin, Common and Inherited text', () => {
    expect(changedBy({ ...NO_ENGINE_FAULTS, latinCheckSkipped: true })).toEqual([]);
  });
});
