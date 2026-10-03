// TXT1a-1 (notes/T056-txt1a-spec.md §3, amended by notes/T083-txt1a-1.md). Phase A: Ahem through HarfBuzz. The Node host's
// shaped measurer must lay out every committed vector exactly as measurerFor's Ahem measurer does, equal Chrome on T082's 1,680
// Ahem runs, read the bundled Ahem's font data as the engine's constants, and every shaping plant that can act on Ahem must change
// a committed vector.
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
});
