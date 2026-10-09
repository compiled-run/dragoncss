// TXT1a-1 phase B: real-font Latin through the engine. The engine lays out the gate's Latin paragraphs in real faces as Chrome
// 145 broke them (line count and every line's width), R4 refuses text outside Latin scope with text-script on the real-font
// path, each shaping plant that acts on real-font lines is caught there, and the translate harness's transcript replay lays out
// exactly as the Node host does, with the plants live (it refuses them only without a transcript).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EngineFaults, FontSpec, GlyphShaper, InlineBox, InlineChild, LayoutBox, LayoutInput, LayoutResult, TextLeaf } from '@dragon/layout';
import { layoutWithFaults, NO_ENGINE_FAULTS, shapedMeasurerFor, validateLayoutInput } from '@dragon/layout';
import { repoPath } from '../src/paths.ts';
import { REFERENCE_PLATFORM } from '../src/platform.ts';
import { ahemFaceId, fontDataOf, hanKerningOf, hostShaper, referenceShapedMeasurer, REFERENCE_LANGUAGE, registerFace, shapedFaceOf } from '../src/text-shaper-host.ts';

type Reference = {
  readonly fonts: Readonly<Record<string, { readonly file: string; readonly sha256: string }>>;
  readonly paragraphs: Readonly<Record<string, string>>;
  readonly cases: ReadonlyArray<{ readonly id: string; readonly font: string; readonly paragraph: string; readonly lang: string; readonly size: number; readonly width: number; readonly lines: ReadonlyArray<readonly [number, number, number, number]> }>;
};
// The translate harness and packages/text-shaper are loaded by path at run time, as paint-vectors.ts and text-shaper-host.ts do.
const { runEngineCase } = (await import(new URL('../../translate/harness/harness.ts', import.meta.url).href)) as { runEngineCase(line: string): string };
const { hexBits } = (await import(new URL('../../translate/harness/host.ts', import.meta.url).href)) as { hexBits(s: string): number };
const gate = (await import(new URL('../../text-shaper/src/gate.ts', import.meta.url).href)) as {
  fontPath(file: string): string;
  loadReference(path: string): Reference;
  REFERENCE_PATH: string;
  LATO_REFERENCE_PATH: string;
};

/** The Latin cases of the Inter, Roboto and Noto Sans gate and of the Lato gate, with each case's face bytes. */
const latin = [gate.REFERENCE_PATH, gate.LATO_REFERENCE_PATH].flatMap((path) => {
  const ref = gate.loadReference(path);
  return ref.cases.filter((c) => c.lang === 'en' && c.font !== 'InterVF').map((c) => {
    const meta = ref.fonts[c.font];
    if (meta === undefined) throw new Error(`${c.id}: no font ${c.font}`);
    return { ...c, text: ref.paragraphs[c.paragraph] as string, bytes: new Uint8Array(readFileSync(gate.fontPath(meta.file))) };
  });
});
const faceBytes = [...new Map(latin.map((c) => [c.font, c.bytes])).values()];
const lato = latin.find((c) => c.font === 'Lato')?.bytes as Uint8Array;
const latoId = registerFace(lato);

const style = {
  display: 'block', position: 'static', top: { kind: 'auto' }, right: { kind: 'auto' }, bottom: { kind: 'auto' }, left: { kind: 'auto' }, overflowX: 'visible', overflowY: 'visible',
  direction: 'ltr', boxSizing: 'content-box', width: { kind: 'auto' }, height: { kind: 'auto' }, minWidth: { kind: 'auto' }, minHeight: { kind: 'auto' }, maxWidth: { kind: 'none' },
  maxHeight: { kind: 'none' }, marginTop: { kind: 'px', value: 0 }, marginRight: { kind: 'px', value: 0 }, marginBottom: { kind: 'px', value: 0 }, marginLeft: { kind: 'px', value: 0 },
  paddingTop: { kind: 'px', value: 0 }, paddingRight: { kind: 'px', value: 0 }, paddingBottom: { kind: 'px', value: 0 }, paddingLeft: { kind: 'px', value: 0 },
  borderTopWidth: { kind: 'px', value: 0 }, borderRightWidth: { kind: 'px', value: 0 }, borderBottomWidth: { kind: 'px', value: 0 }, borderLeftWidth: { kind: 'px', value: 0 },
  flexDirection: 'row', flexWrap: 'nowrap', flexGrow: 0, flexShrink: 1, flexBasis: { kind: 'auto' }, order: 0, justifyContent: 'normal', alignItems: 'normal', alignSelf: 'auto',
  alignContent: 'normal', rowGap: { kind: 'normal' }, columnGap: { kind: 'normal' }, textAlign: 'start', aspectRatio: { kind: 'auto' }, verticalAlign: { kind: 'keyword', value: 'baseline' },
  grid: null, gridItem: null,
} as const;

const fontOf = (family: string, size: number): FontSpec => ({ family, size, specifiedSize: { kind: 'px', value: size }, absoluteSize: true });
const leaf = (id: string, text: string, family: string, size: number): TextLeaf => ({ kind: 'text', id, text, font: fontOf(family, size), lineHeight: { kind: 'normal' }, whiteSpaceCollapse: 'collapse', textWrapMode: 'wrap' });

const span = (id: string, child: TextLeaf): InlineBox => ({ kind: 'inline', id, style: { ...style, display: 'inline' }, font: child.font, lineHeight: child.lineHeight, children: [child] });

/** A width px block of inline content whose first child is a text leaf in the block's font, in a 2000x300 viewport; validated. */
function inputOf(width: number, children: readonly InlineChild[]): LayoutInput {
  const first = children[0] as TextLeaf;
  const p: LayoutBox = { kind: 'box', id: 'p', boxType: 'element', style: { ...style, width: { kind: 'px', value: width } }, strut: { font: first.font, lineHeight: first.lineHeight }, children: [...children] };
  const body: LayoutBox = { kind: 'box', id: 'body', boxType: 'element', style, strut: null, children: [p] };
  const html: LayoutBox = { kind: 'box', id: 'html', boxType: 'element', style, strut: null, children: [body] };
  const viewport = { width: 2000, height: 300 };
  return validated({ viewport, devicePixelRatio: 1, viewportUnits: { small: viewport, large: viewport, dynamic: viewport }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, rootFontSize: 16, root: html });
}

/** The line widths (LayoutUnits) of leaf t, or the refusal. */
function linesOf(r: LayoutResult): number[] | string {
  if (r.kind !== 'ok') return `${r.unsupported.code}: ${r.unsupported.detail}`;
  return r.boxes.filter((b) => b.parent === 't').map((b) => b.width as number);
}

const measurers = new Map<string, ReturnType<typeof referenceShapedMeasurer>>();
/** The engine's line widths of a gate case, with faults planted in the engine and its measurer. */
function engineLines(c: (typeof latin)[number], faults: EngineFaults): number[] | string {
  const key = JSON.stringify(faults);
  let m = measurers.get(key);
  if (m === undefined) {
    m = referenceShapedMeasurer(faults, faceBytes);
    measurers.set(key, m);
  }
  return linesOf(layoutWithFaults(inputOf(c.width, [leaf('t', c.text, registerFace(c.bytes), c.size)]), m, faults));
}

function validated(v: unknown): LayoutInput {
  const r = validateLayoutInput(v);
  if (!r.ok) throw new Error(JSON.stringify(r.errors.slice(0, 3)));
  return r.input;
}

const chromeLines = (c: (typeof latin)[number]): number[] => c.lines.map((l) => l[2]);
const mismatches = (faults: EngineFaults): string[] => latin.filter((c) => JSON.stringify(engineLines(c, faults)) !== JSON.stringify(chromeLines(c))).map((c) => c.id);

describe('TXT1a-1 phase B: real-font Latin through the engine', () => {
  it(`breaks every Latin gate case as Chrome 145 does: line count and every line width (${latin.length} cases)`, () => {
    expect(latin.length).toBe(1120);
    const failed = latin.flatMap((c) => {
      const got = engineLines(c, NO_ENGINE_FAULTS);
      return JSON.stringify(got) === JSON.stringify(chromeLines(c)) ? [] : [`${c.id}: ${JSON.stringify(got).slice(0, 200)} vs ${JSON.stringify(chromeLines(c)).slice(0, 200)}`];
    });
    expect(failed).toEqual([]);
  });

  // advanceNot16_16 changes no line of this corpus; text-latin.test.ts catches it against T082's Chrome Ahem runs.
  for (const plant of ['doubleAccumulation', 'noReshapeAtBreak', 'kerningDropped', 'wholePixelPositions', 'softHyphenWidthMissing', 'fitWithoutEpsilon', 'breakOffByOne'] as const) {
    it(`catches ${plant} against Chrome on the real-font gate cases`, () => {
      expect(mismatches({ ...NO_ENGINE_FAULTS, [plant]: true }).length, plant).toBeGreaterThan(0);
    });
  }
});

describe('TXT1a-1 phase B: R4 and the run refusal on the real-font path', () => {
  const at = (r: LayoutResult): unknown => (r.kind === 'ok' ? 'ok' : [r.unsupported.code, r.unsupported.nodeId, r.unsupported.specSection]);
  const lay = (leaves: readonly InlineChild[], faults: EngineFaults = NO_ENGINE_FAULTS): LayoutResult => layoutWithFaults(inputOf(300, leaves), referenceShapedMeasurer(faults, [lato]), faults);

  it('refuses a real-font leaf outside Latin, Common and Inherited with text-script, and latinCheckSkipped lets it through', () => {
    for (const foreign of ['A\u03a9B', 'wasser \u6c34']) {
      expect(at(lay([leaf('t', foreign, latoId, 16)])), foreign).toEqual(['text-script', 't', 'notes/T056-txt1a-spec.md R4']);
      const skipped = lay([leaf('t', foreign, latoId, 16)], { ...NO_ENGINE_FAULTS, latinCheckSkipped: true });
      expect(skipped.kind === 'unsupported' && skipped.unsupported.code, foreign).not.toBe('text-script');
    }
    expect(at(lay([leaf('t', 'Caf\u00e9 na\u00efve \u2014 ok', latoId, 16)]))).toBe('ok');
  });

  it('refuses a Common code point whose Script_Extensions exclude Latin, which Blink shapes in a run of its own', () => {
    const r = lay([leaf('t', 'a\u060cb', latoId, 16)]);
    expect(r.kind === 'unsupported' && [r.unsupported.code, r.unsupported.detail]).toEqual(['text-script', expect.stringMatching(/^U\+60C is Common or Inherited, but its Script_Extensions exclude Latin/)]);
  });

  it("the shaped measurer's shaped item, which real-font line breaking reads, refuses with text-script too (R4)", () => {
    const font = { family: latoId, size: 16 };
    expect(referenceShapedMeasurer(NO_ENGINE_FAULTS, [lato]).shaped('A\u03a9', font)).toEqual({ ok: false, code: 'text-script', reason: 'U+3A9 is outside Latin, Common and Inherited (R4)' });
    expect(referenceShapedMeasurer(NO_ENGINE_FAULTS, [lato]).shaped('Ahem text', font).ok).toBe(true);
    expect(referenceShapedMeasurer({ ...NO_ENGINE_FAULTS, latinCheckSkipped: true }, [lato]).shaped('A\u03a9', font).ok).toBe(true);
  });

  it('refuses text across an inline box boundary in one face and size, which Blink shapes as one run, and accepts another size', () => {
    expect(at(lay([leaf('t', 'one ', latoId, 16), span('s', leaf('u', 'two', latoId, 16))]))).toEqual(['text-shaping-run', 'u', 'css-text-3 §7.3 (boundary shaping)']);
    expect(at(lay([leaf('t', 'one ', latoId, 16), span('s', leaf('u', 'two', latoId, 17))]))).toBe('ok');
  });
});

/** T082's committed Chrome Ahem nowrap runs (X repeated) whose width the planted shaped measurer gets wrong. */
function ahemRunsChangedBy(faults: EngineFaults): { readonly text: string; readonly size: number }[] {
  const cap = JSON.parse(readFileSync(repoPath('docs/research/text-spike/metric-rounding/captures/ahem-advances.json'), 'utf8')) as { widthsLayoutUnits: Record<string, number[]> };
  const m = referenceShapedMeasurer(faults);
  return Object.entries(cap.widthsLayoutUnits).flatMap(([size, widths]) =>
    widths.flatMap((lu, i) => {
      const got = m.measure('X'.repeat(i + 1), { family: 'Ahem', size: Number(size) });
      return got.ok && got.measure.width === lu ? [] : [{ text: 'X'.repeat(i + 1), size: Number(size) }];
    }),
  );
}

type Call = readonly [string, number, string, number, number, string, boolean, string, readonly number[], readonly number[]];

/** The layout of input through the Node host with faults, and the shape transcript (R3) of every HarfBuzz call it made. */
function hostRun(input: LayoutInput, faults: EngineFaults): { readonly result: LayoutResult; readonly shaping: unknown } {
  const calls: Call[] = [];
  const recording: GlyphShaper = {
    shape(face, size, text, start, end, script, rtl, language, features) {
      const glyphs = hostShaper.shape(face, size, text, start, end, script, rtl, language, features);
      calls.push([face, size, text, start, end, script, rtl, language, [...features], [...glyphs]]);
      return glyphs;
    },
  };
  const ids = [ahemFaceId(), ...faceBytes.map(registerFace)];
  const m = shapedMeasurerFor(REFERENCE_PLATFORM, new Map(ids.map((id) => [id, shapedFaceOf(id, REFERENCE_LANGUAGE)] as const)), recording, REFERENCE_LANGUAGE, faults);
  if (m.kind !== 'ok') throw new Error(m.detail);
  const result = layoutWithFaults(input, m.measurer, faults);
  const faces = ids.map((id) => ({ id, data: fontDataOf(id), hanKerning: hanKerningOf(id, REFERENCE_LANGUAGE) }));
  return { result, shaping: { language: REFERENCE_LANGUAGE, faces, calls } };
}

/** runEngineCase's output as the TS layout result's form: [id, parent, x, y, width, height] boxes, or the refusal. */
function harnessRun(input: LayoutInput, faults: EngineFaults, shaping: unknown): unknown {
  const out = JSON.parse(runEngineCase(JSON.stringify({ platform: REFERENCE_PLATFORM, faults, input, shaping }))) as unknown[];
  if (out[0] === 'unsupported') return out.slice(1, 3);
  if (out[0] !== 'ok') return out;
  return (out[2] as [string, string | null, string, string, string, string][]).map(([id, parent, ...rest]) => [id, parent, ...rest.map(hexBits)]);
}

const asHarness = (r: LayoutResult): unknown => (r.kind === 'ok' ? r.boxes.map((b) => [b.id, b.parent, b.x, b.y, b.width, b.height]) : [r.unsupported.code, r.unsupported.nodeId]);

describe('TXT1a-1 phase B: the translate harness replays a shape transcript as the Node host lays out (R3)', () => {
  const lato16 = latin.filter((c) => c.font === 'Lato' && c.size === 16);
  const samples: LayoutInput[] = [
    ...lato16.map((c) => inputOf(c.width, [leaf('t', c.text, latoId, c.size)])),
    inputOf(300, [leaf('t', 'A\u03a9B', latoId, 16)]),
    inputOf(300, [leaf('t', 'one ', latoId, 16), span('s', leaf('u', 'two', latoId, 17))]),
    // Ahem at 12.5px goes through the replay too: its half-pixel advances and descent are where wholePixelPositions and
    // metricRoundingSwapped act (text-latin.test.ts), which no Lato size between 1 and 64px does.
    validated(JSON.parse(readFileSync(repoPath('packages/layout/vectors/text-fractional-font-size.json'), 'utf8')).input),
    // The first of T082's Chrome Ahem runs that advanceNot16_16 changes (text-latin.test.ts catches it there).
    ...ahemRunsChangedBy({ ...NO_ENGINE_FAULTS, advanceNot16_16: true }).slice(0, 1).map((r) => inputOf(1900, [leaf('t', r.text, 'Ahem', r.size)])),
    // The first gate case whose lines doubleAccumulation changes (the Chrome comparison above catches it).
    ...latin.filter((c) => JSON.stringify(engineLines(c, { ...NO_ENGINE_FAULTS, doubleAccumulation: true })) !== JSON.stringify(chromeLines(c))).slice(0, 1).map((c) => inputOf(c.width, [leaf('t', c.text, registerFace(c.bytes), c.size)])),
  ];

  it(`equals the host on ${samples.length} inputs`, () => {
    expect(lato16.length).toBe(40);
    expect(samples.length).toBe(45);
    for (const input of samples) {
      const host = hostRun(input, NO_ENGINE_FAULTS);
      expect(harnessRun(input, NO_ENGINE_FAULTS, host.shaping)).toEqual(asHarness(host.result));
    }
  });

  it('reports a harness error for a transcript that lists a face twice, holds a partial glyph record or lacks a call', () => {
    const input = samples[0] as LayoutInput;
    const host = hostRun(input, NO_ENGINE_FAULTS);
    const t = host.shaping as { language: string; faces: { id: string }[]; calls: Call[] };
    const run = (shaping: unknown): unknown => JSON.parse(runEngineCase(JSON.stringify({ platform: REFERENCE_PLATFORM, faults: NO_ENGINE_FAULTS, input, shaping })));
    expect(run({ ...t, faces: [...t.faces, t.faces[0]] })).toEqual(['harness-error', `$.shaping.faces[${t.faces.length}].id: face ${t.faces[0]?.id} is listed twice`]);
    const first = t.calls[0] as Call;
    expect(run({ ...t, calls: [[...first.slice(0, 9), first[9].slice(0, 6)], ...t.calls.slice(1)] })).toEqual(['harness-error', '$.shaping.calls[0][9]: 6 integers are not whole glyph records of 7']);
    expect(run({ ...t, calls: t.calls.slice(1) })).toEqual(['harness-error', expect.stringMatching(/^the shape transcript holds no call /)]);
  });

  // With a transcript the shaping plants act on the replayed measurer, so the harness runs them; without one it refuses them
  // (translate.test.ts), since measurerFor's Ahem measurer would leave them inert.
  for (const plant of ['advanceNot16_16', 'doubleAccumulation', 'noReshapeAtBreak', 'kerningDropped', 'wholePixelPositions', 'softHyphenWidthMissing', 'metricRoundingSwapped', 'latinCheckSkipped'] as const) {
    it(`runs ${plant} with a transcript, equal to the host with the plant`, () => {
      const faults = { ...NO_ENGINE_FAULTS, [plant]: true };
      let changed = 0;
      for (const input of samples) {
        const host = hostRun(input, faults);
        expect(harnessRun(input, faults, host.shaping), plant).toEqual(asHarness(host.result));
        if (JSON.stringify(asHarness(host.result)) !== JSON.stringify(asHarness(hostRun(input, NO_ENGINE_FAULTS).result))) changed++;
      }
      expect(changed, plant).toBeGreaterThan(0);
    });
  }
});
