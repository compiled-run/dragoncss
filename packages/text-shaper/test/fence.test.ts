// The variable-font fence (docs/decisions.md, "Variable fonts are fenced", PM T024): the TS API refuses, with typed refusals and
// before any shaping, a variable font without HVAR and every instance outside validated-variable-fonts.json. The validated set
// must be exactly what the gate's Chrome cases cover; the planted fault fenceDisabled must be caught.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DragonHB, VariableFontRefused, faceFacts, fenceInstance, fontPath, instanceAxisValues, loadReference, loadValidatedVariableFonts } from '../src/index.ts';
import type { FontOptions, VariableFontRefusal } from '../src/index.ts';

const ref = loadReference();
const validated = loadValidatedVariableFonts();
const INTER_VF = new Uint8Array(readFileSync(fontPath('Inter-VF.ttf')));
const INTER = new Uint8Array(readFileSync(fontPath('Inter-Regular.ttf')));

/** A copy of a font with one table tag renamed (the table stays; only its tag changes). */
function renameTable(bytes: Uint8Array, from: string, to: string): Uint8Array {
  const out = new Uint8Array(bytes);
  const d = new DataView(out.buffer);
  for (let i = 0; i < d.getUint16(4); i++) {
    const r = 12 + i * 16;
    if (String.fromCharCode(...out.subarray(r, r + 4)) === from) for (let k = 0; k < 4; k++) out[r + k] = to.charCodeAt(k);
  }
  return out;
}
const NO_HVAR = renameTable(INTER_VF, 'HVAR', 'XVAR');
/** Inter VF with one byte of its name table changed: still variable with HVAR, but not the file Chrome measured. */
const OTHER_VF = ((): Uint8Array => {
  const out = new Uint8Array(INTER_VF);
  const d = new DataView(out.buffer);
  for (let i = 0; i < d.getUint16(4); i++) {
    const r = 12 + i * 16;
    if (String.fromCharCode(...out.subarray(r, r + 4)) === 'name') {
      const o = d.getUint32(r + 8) + d.getUint32(r + 12) - 1;
      out[o] = (out[o] as number) ^ 1;
    }
  }
  return out;
})();

const refusalOf = (f: () => unknown): VariableFontRefusal | null => {
  try {
    f();
    return null;
  } catch (e) {
    if (e instanceof VariableFontRefused) return e.refusal;
    throw e;
  }
};

/** Inputs the fence must refuse: a face (bytes) and, for a validated face, font options. */
const MUST_REFUSE: ReadonlyArray<readonly [string, Uint8Array, FontOptions]> = [
  ['a variable font without HVAR', NO_HVAR, { size: 16 }],
  ['a variable font outside the validated set', OTHER_VF, { size: 16 }],
  ['Inter VF at weight 700', INTER_VF, { size: 16, weight: 700 }],
  ['Inter VF at weight 401', INTER_VF, { size: 16, weight: 401 }],
  ['Inter VF with font-variation-settings wght 500', INTER_VF, { size: 16, variations: [{ tag: 'wght', value: 500 }] }],
  ['Inter VF with opsz 32 from settings', INTER_VF, { size: 16, variations: [{ tag: 'opsz', value: 32 }] }],
  ['Inter VF at 25px (opsz 25, above the validated 24)', INTER_VF, { size: 25 }],
  ['Inter VF at 16px with a specified size of 30 (zoom)', INTER_VF, { size: 16, specifiedSize: 30 }],
];

/** How many must-refuse inputs get through: 0 for a working fence. */
function fenceLeaks(hb: DragonHB): string[] {
  return MUST_REFUSE.filter(([, bytes, o]) => refusalOf(() => hb.createFont(hb.createFace(bytes), o)) === null).map(([name]) => name);
}

describe('variable-font fence (shim API)', () => {
  const hb = DragonHB.load();

  it('validates exactly the variable font and axis ranges the gate proves against Chrome', () => {
    const vfFonts = Object.entries(ref.fonts).filter(([, m]) => faceFacts(new Uint8Array(readFileSync(fontPath(m.file)))).variable);
    expect(vfFonts.map(([name]) => name)).toEqual(['InterVF']);
    const [name, meta] = vfFonts[0] as [string, { file: string; sha256: string }];
    const facts = faceFacts(new Uint8Array(readFileSync(fontPath(meta.file))));
    // The gate creates every font with only a size: weight 400 and automatic optical sizing at that size.
    const ranges = new Map<string, [number, number]>();
    for (const c of ref.cases.filter((x) => x.font === name)) {
      for (const [axis, v] of instanceAxisValues(facts.axes, { size: c.size })) {
        const r = ranges.get(axis);
        ranges.set(axis, r === undefined ? [v, v] : [Math.min(r[0], v), Math.max(r[1], v)]);
      }
    }
    expect(validated.fonts).toEqual([{ name, file: `docs/research/text-spike/fonts/${meta.file}`, sha256: meta.sha256, axes: Object.fromEntries(ranges) }]);
  });

  it('reads Inter VF as variable with HVAR, wght and opsz axes', () => {
    const f = faceFacts(INTER_VF);
    expect([f.variable, f.hvar]).toEqual([true, true]);
    expect(f.axes).toEqual([{ tag: 'opsz', min: 14, default: 14, max: 32 }, { tag: 'wght', min: 100, default: 400, max: 900 }]);
    expect(faceFacts(INTER)).toMatchObject({ variable: false, axes: [] });
  });

  it('refuses a variable font without HVAR at createFace, with a typed refusal', () => {
    expect(refusalOf(() => hb.createFace(NO_HVAR))).toEqual({ kind: 'variable-font-without-hvar', sha256: faceFacts(NO_HVAR).sha256 });
  });

  it('refuses a variable font outside the validated set at createFace', () => {
    expect(refusalOf(() => hb.createFace(OTHER_VF))).toEqual({ kind: 'variable-font-not-validated', sha256: faceFacts(OTHER_VF).sha256 });
  });

  it('refuses Inter VF instances outside the validated axis ranges at createFont', () => {
    const face = hb.createFace(INTER_VF);
    expect(refusalOf(() => hb.createFont(face, { size: 16, weight: 700 }))).toEqual({ kind: 'variable-instance-not-validated', font: 'InterVF', axis: 'wght', value: 700, validated: [400, 400] });
    expect(hb.checkFont(face, { size: 40 })).toEqual({ kind: 'variable-instance-not-validated', font: 'InterVF', axis: 'opsz', value: 32, validated: [14, 24] });
    expect(hb.checkFont(face, { size: 16, weight: 1000 })).toMatchObject({ axis: 'wght', value: 900 });
  });

  it('accepts the validated instances: default wght, automatic opsz within 14 to 24, including the default instance', () => {
    const face = hb.createFace(INTER_VF);
    for (const o of [{ size: 12 }, { size: 16 }, { size: 17 }, { size: 24 }, { size: 20 }, { size: 8 }, { size: 30, opticalSizingAuto: false }, { size: 16, weight: 400 }, { size: 16, variations: [{ tag: 'wght', value: 400 }] }] satisfies FontOptions[]) {
      expect(hb.checkFont(face, o), JSON.stringify(o)).toBeNull();
      expect(hb.createFont(face, o)).toBeGreaterThan(0);
    }
  });

  it('leaves static fonts alone, whatever the request', () => {
    const face = hb.createFace(INTER);
    expect(hb.checkFont(face, { size: 16, weight: 700, variations: [{ tag: 'wght', value: 900 }] })).toBeNull();
    expect(fenceInstance(faceFacts(INTER), { size: 99 })).toBeNull();
  });

  it('refuses every must-refuse input', () => {
    expect(fenceLeaks(hb)).toEqual([]);
  });

  it('catches a planted fault: fenceDisabled', () => {
    const faulted = DragonHB.load(undefined, { fenceDisabled: true });
    expect(fenceLeaks(faulted)).toEqual(MUST_REFUSE.map(([name]) => name));
    // The trap the fence closes: without HVAR, a bold instance silently shapes with default-instance advances.
    const a = (bytes: Uint8Array, weight: number): number => {
      const font = faulted.createFont(faulted.createFace(bytes), { size: 16, weight });
      return faulted.glyphAdvance(font, faulted.nominalGlyph(font, 0x61));
    };
    expect(a(NO_HVAR, 700)).toBe(a(NO_HVAR, 400));
    expect(a(INTER_VF, 700)).not.toBe(a(INTER_VF, 400));
  });
});
