// TXT1a-1 (notes/T056-txt1a-spec.md §3, amended by notes/T083-txt1a-1.md). Phase A: Ahem through HarfBuzz. The Node host's
// shaped measurer must lay out every committed vector exactly as measurerFor's Ahem measurer does, equal Chrome on T082's 1,680
// Ahem runs, read the bundled Ahem's font data as the engine's constants, and refuse text outside Latin, Common and Inherited
// (R4). Each shaping plant that acts on Ahem through the engine's measurer must change a committed vector or T082's committed
// Chrome runs; the three that cannot act there are pinned inert on every committed vector, each with its reason.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineFaults, LayoutInput, LayoutResult } from '@dragon/layout';
import { AHEM_FACE_ID, AHEM_FONT_DATA, layout, layoutWithFaults, measurerFor, NO_ENGINE_FAULTS, validateLayoutInput } from '@dragon/layout';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as dragon from 'dragon';
import { fixtureInput } from '../src/cases.ts';
import { launchChrome } from '../src/chrome.ts';
import { atDpr, layoutCases } from '../src/dpr.ts';
import { layout as layoutFixture } from '../src/fixture-groups/define.ts';
import { TEXT_LATIN_FIXTURES } from '../src/fixture-groups/text-latin.ts';
import { FIXTURES } from '../src/fixtures.ts';
import { FONT_REFERENCE_MAP } from '../src/font-reference.ts';
import { compileFixture } from '../src/pipeline.ts';
import * as tl from '../src/text-latin-run.ts';
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

// ---------------------------------------------------------------------------------------------------------------------------
// Phase B: the text-latin registry (fixture-groups/text-latin.ts), notes/T083-txt1a-1.md.

const { runEngineCase } = (await import(pathToFileURL(repoPath('packages/translate/harness/harness.ts')).href)) as { runEngineCase: (line: string) => string };
const { hexBits } = (await import(pathToFileURL(repoPath('packages/translate/harness/host.ts')).href)) as { hexBits: (s: string) => number };

const textLatinOf = (id: string) => {
  const f = TEXT_LATIN_FIXTURES.find((x) => x.spec.id === id);
  if (f === undefined) throw new Error(`no text-latin fixture ${id}`);
  return f;
};
const asTextLatin = (id: string) => ({ spec: layoutFixture(id, ['ltr'], 'ahem'), map: FONT_REFERENCE_MAP, faces: {} });

describe('TXT1a-1 phase B: the text-latin registry', () => {
  it('admits every case of every registry fixture, none of which is a FIXTURES fixture', () => {
    expect(TEXT_LATIN_FIXTURES.length).toBe(6);
    const ids = TEXT_LATIN_FIXTURES.map((f) => f.spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of TEXT_LATIN_FIXTURES) {
      expect(FIXTURES.some((x) => x.id === f.spec.id), f.spec.id).toBe(false);
      for (const c of tl.textLatinCases(f)) expect(tl.admissionProblems(f, tl.compileTextLatin(f, c.environment.direction).compiled, c), c.id).toEqual([]);
    }
  });

  it('refuses an Ahem FIXTURES case placed in the registry (its native projection is ready)', () => {
    const f = asTextLatin('text-fractional-font-size');
    const c = tl.textLatinCases(f)[0] as ParityCaseT;
    expect(() => tl.requireAdmitted(f, tl.compileTextLatin(f, 'ltr').compiled, c)).toThrow(/native projection is ready/);
  });

  it('refuses a Lato case with one error that is not a font refusal', () => {
    const f = asTextLatin('text-latin-negative');
    const c = tl.textLatinCases(f)[0] as ParityCaseT;
    expect(() => tl.requireAdmitted(f, tl.compileTextLatin(f, 'ltr').compiled, c)).toThrow(/not a text-latin case/);
  });

  const BASE_LAYOUT_CASES = 569;
  it('keeps every FIXTURES layout case (and so every native and device case) as it was at BASE', () => {
    const ids = layoutCases().flatMap((f) => f.cases.map((c) => c.id));
    // BASE is txt1a-1b-v2 with inl1a-lowering at #91's head 0636a60b21 merged in (23bff72e8d), whose FIXTURES hold 569 layout cases.
    expect(ids.length).toBe(BASE_LAYOUT_CASES);
    expect(createHash('sha256').update(ids.join('\n')).digest('hex')).toBe('3c0c5d0b0b43e575706b4fe27f1782b0cdc313bb0cd1b6d41a353dc8f2467fc9');
  });

  it('gives every FIXTURES case the native projection as its engine projection, at every DPR', () => {
    let compared = 0;
    for (const { spec, cases } of layoutCases()) {
      const byDirection = new Map<string, ReturnType<typeof compileFixture>['compiled']>();
      for (const c of cases) {
        let compiled = byDirection.get(c.environment.direction);
        if (compiled === undefined) {
          compiled = compileFixture(spec, undefined, 'enforce', c.environment.direction).compiled;
          byDirection.set(c.environment.direction, compiled);
        }
        for (const dpr of [1, 2, 3, 2.625]) {
          const env = atDpr(c.environment, dpr);
          expect(dragon.engineLayoutProjection(compiled, env, c.assignment), `${c.id} at DPR ${dpr}`).toEqual(dragon.nativeLayoutProjection(compiled, env, c.assignment));
          compared++;
        }
      }
    }
    expect(compared).toBe(BASE_LAYOUT_CASES * 4);
  });

  it('keeps native refusing Lato and Inter with the existing message, and DRAGON_SYNTHETIC_FONT_STYLE fires on no FIXTURES case', () => {
    const lato = tl.compileTextLatin(textLatinOf('text-latin-lato'), 'ltr').compiled;
    expect(lato.diagnostics.some((d) => d.code === 'DRAGON_UNSUPPORTED_FONT' && d.target === 'ios' && /^font-family: Lato on .* has no layout mapping \(expected Ahem \(the milestone-1 layout font\)\)$/.test(d.message))).toBe(true);
    const sans = tl.compileTextLatin(textLatinOf('text-latin-words'), 'ltr').compiled;
    expect(sans.diagnostics.some((d) => d.code === 'DRAGON_UNSUPPORTED_FONT' && d.target === 'ios' && /^font-family: sans-serif on c:text0 has no layout mapping/.test(d.message))).toBe(true);
    for (const spec of FIXTURES) {
      const directions = spec.kind === 'layout' ? spec.environments : ['ltr' as const];
      for (const d of directions) expect(compileFixture(spec, undefined, 'enforce', d).compiled.diagnostics.filter((x) => x.code === 'DRAGON_SYNTHETIC_FONT_STYLE').map((x) => x.message), spec.id).toEqual([]);
    }
  });

  it('refuses synthetic styles and variable faces in engine mode, and names the synthetic style for native', () => {
    const syn = asTextLatin('text-latin-synthetic');
    const sc = tl.textLatinCases(syn)[0] as ParityCaseT;
    const compiled = tl.compileTextLatin(syn, 'ltr').compiled;
    expect(compiled.diagnostics.filter((d) => d.code === 'DRAGON_SYNTHETIC_FONT_STYLE').map((d) => [d.target, d.message])).toEqual([['ios', 'text t:text0 in Lato at font-weight 400 and font-style italic would be drawn in synthetic oblique: no bundled Lato face has that style, and ios cannot reproduce Skia\'s synthetic style']]);
    expect(dragon.engineLayoutProjection(compiled, sc.environment, sc.assignment)).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/more than deferred font refusals/) });
    const vf = asTextLatin('text-latin-variable');
    const vc = tl.textLatinCases(vf)[0] as ParityCaseT;
    const input = fixtureInput(vf.spec);
    const bytes = new Uint8Array(readFileSync(repoPath('docs/research/text-spike/fonts/Inter-VF.ttf')));
    const swapped = { ...input, snapshot: { ...input.snapshot, assets: input.snapshot.assets.map((a) => (a.id === 'vendor/fonts/Inter/Inter-Regular.ttf' ? { ...a, bytes, hash: `sha256:${createHash('sha256').update(bytes).digest('hex')}` } : a)) } };
    const project = dragon.createProjectWith({ projectId: 'dragon-parity', targets: { ios: { minimum: '15.0' }, web: {} } }, { faults: dragon.NO_FAULTS, profiles: 'derive', direction: 'ltr', platform: 'darwin-arm64', rootFont: 'ahem', foldViewport: { width: 400, height: 300 } });
    const vcompiled = project.compile(swapped);
    expect(dragon.engineLayoutProjection(vcompiled, vc.environment, vc.assignment)).toMatchObject({ kind: 'blocked', reason: expect.stringMatching(/variable face/) });
  });

  it('refuses text outside the Latin scope with a typed code, which planted fault latinCheckSkipped changes', () => {
    const f = textLatinOf('text-latin-words');
    const c = tl.textLatinCases(f)[0] as ParityCaseT;
    const p = dragon.engineLayoutProjection(tl.compileTextLatin(f, 'ltr').compiled, c.environment, c.assignment);
    if (p.kind !== 'ready') throw new Error(p.reason);
    const greek = JSON.parse(JSON.stringify(p.input).replace('Waves and wind over the quiet harbour', 'Κύματα και άνεμος')) as LayoutInput;
    const r = layout(greek, referenceShapedMeasurer());
    expect(r.kind === 'unsupported' ? r.unsupported.code : r.kind).toBe('text-script');
    const faults = { ...NO_ENGINE_FAULTS, latinCheckSkipped: true };
    const planted = layoutWithFaults(greek, referenceShapedMeasurer(faults), faults);
    expect(planted.kind === 'unsupported' ? planted.unsupported.code : planted.kind).not.toBe('text-script');
  });
});

type ParityCaseT = ReturnType<typeof tl.textLatinCases>[number];

describe('TXT1a-1 phase B: text-latin against Chrome 145 at every DPR', () => {
  it('passes the engine lane exactly, chrome-dual, the face check and the break check at DPR 1', async () => {
    const browser = await launchChrome();
    try {
      const failed: string[] = [];
      let cases = 0;
      for (const f of TEXT_LATIN_FIXTURES) {
        for (const o of await tl.runTextLatinFixture(f, browser, tl.committedTextLatinOptions)) {
          cases++;
          if (o.status !== 'pass') failed.push(`${o.id}: ${o.reason}`);
        }
      }
      expect(failed).toEqual([]);
      expect(cases).toBe(7);
    } finally {
      await browser.close();
    }
  }, 600_000);

  it('passes the DPR lane in exact zoomed LU, with Chrome\'s breaks, at DPR 2, 3 and 2.625', async () => {
    const failed: string[] = [];
    let cases = 0;
    for (const f of TEXT_LATIN_FIXTURES) {
      for (const dpr of [2, 3, 2.625]) {
        for (const o of await tl.runTextLatinDpr(f, dpr, tl.committedTextLatinOptions)) {
          cases++;
          if (o.status !== 'pass' || o.breakProblems.length > 0 || o.exact !== o.nodes) failed.push(`${o.id} at DPR ${dpr}: ${o.reason ?? ''} ${o.breakProblems.join('; ')}`);
        }
      }
    }
    expect(failed).toEqual([]);
    expect(cases).toBe(21);
  }, 600_000);

  // Each planted shaping fault must make the engine differ from Chrome on a named text-latin case (engine lane or breaks).
  const plants: readonly { readonly fault: keyof EngineFaults; readonly fixture: string; readonly dpr: number }[] = [
    { fault: 'advanceNot16_16', fixture: 'text-latin-lato', dpr: 1 },
    { fault: 'doubleAccumulation', fixture: 'text-latin-lato', dpr: 3 },
    { fault: 'noReshapeAtBreak', fixture: 'text-latin-punct', dpr: 1 },
    { fault: 'kerningDropped', fixture: 'text-latin-lato', dpr: 1 },
    { fault: 'wholePixelPositions', fixture: 'text-latin-lato', dpr: 1 },
    { fault: 'softHyphenWidthMissing', fixture: 'text-latin-punct', dpr: 1 },
    { fault: 'metricRoundingSwapped', fixture: 'text-latin-metrics', dpr: 2 },
  ];
  for (const p of plants) {
    it(`catches the planted fault ${p.fault} on ${p.fixture} at DPR ${p.dpr}`, async () => {
      const f = textLatinOf(p.fixture);
      const faults = { ...NO_ENGINE_FAULTS, [p.fault]: true };
      if (p.dpr !== 1) {
        expect((await tl.runTextLatinDpr(f, p.dpr, tl.committedTextLatinOptions)).every((r) => r.status === 'pass' && r.breakProblems.length === 0), 'unfaulted').toBe(true);
        const planted = await tl.runTextLatinDpr(f, p.dpr, { ...tl.committedTextLatinOptions, engineFaults: faults });
        expect(planted.some((r) => r.status !== 'pass' || r.breakProblems.length > 0)).toBe(true);
        return;
      }
      const differs = (ef: EngineFaults): boolean => tl.textLatinCases(f).some((c) => {
        const lane = tl.engineLane(c, tl.compileTextLatin(f, c.environment.direction).compiled, tl.joinHyphenRects(tl.committedTextLatinCapture(c, 1)), ef);
        if (!lane.pass || lane.vector === null) return true;
        return tl.breakProblems(c.id, 1, lane.vector.input, tl.committedTextLatinBreaks(c, 1), ef).problems.length > 0;
      });
      expect(differs(NO_ENGINE_FAULTS), 'unfaulted').toBe(false);
      expect(differs(faults)).toBe(true);
    }, 600_000);
  }
});

describe('TXT1a-1 phase B: text-latin vectors replay in the translated engine (R3)', () => {
  const dirs = [1, 2, 3, 2.625].map((d) => ({ dpr: d, dir: repoPath(`packages/layout/vectors/text-latin/dpr-${d}`) }));
  const vecs = dirs.flatMap(({ dpr, dir }) => readdirSync(dir).filter((x) => x.endsWith('.json')).map((x) => ({ dpr, file: `${dir}/${x}`, v: JSON.parse(readFileSync(`${dir}/${x}`, 'utf8')) as ReturnType<typeof tl.textLatinVector> })));
  const lineOf = (v: ReturnType<typeof tl.textLatinVector>, faults: EngineFaults = NO_ENGINE_FAULTS): string => JSON.stringify({ platform: v.platform, faults, input: v.input, shaping: { language: v.language, faces: v.faces, calls: v.calls } });

  it('has a vector for every case at every DPR, each written from the committed captures', () => {
    expect(vecs.length).toBe(28);
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

  for (const target of ['swift', 'kotlin'] as const) {
    it(`replays every vector in the generated ${target} engine with the TypeScript results`, async () => {
      const check = (await import(pathToFileURL(repoPath('packages/translate/src/check.ts')).href)) as { runTarget: (t: string, c: unknown, files: unknown, tag: string) => { status: string; suites: { name: string; failures?: unknown; mismatches?: unknown }[] }; committedFiles: (t: string) => unknown };
      const lines = vecs.map(({ v }) => lineOf(v));
      // native.ts corpusFiles keys the written inputs by the corpus digest, so the digest covers the lines.
      const digest = createHash('sha256').update(lines.join('\n')).digest('hex');
      const corpus = { suites: [{ name: 'text-latin', mode: 'engine', lines, expected: lines.map(runEngineCase) }], vectors: [], engineSplit: { ok: lines.length, unsupported: 0, refused: 0, threw: 0, harnessError: 0 }, digest, digests: {} };
      const r = check.runTarget(target, corpus, check.committedFiles(target), `${target}-text-latin`);
      expect(r.status, JSON.stringify(r.suites).slice(0, 2000)).toBe('pass');
    }, 1_800_000);
  }
});
