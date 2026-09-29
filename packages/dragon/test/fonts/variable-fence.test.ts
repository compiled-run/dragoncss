// The compiler's variable-font fence (docs/decisions.md, "Variable fonts are fenced", PM T024): a bundled @font-face that
// resolves to a variable font without HVAR or outside the validated set is a typed build error, and an instance outside the
// validated axis ranges is a typed refusal. The validated set is the text shaper's, which its gate test ties to Chrome's cases.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CssNode } from 'css-tree';
import { buildManifest, fenceVariableInstance, fvarAxes, NO_FONT_FAULTS, parseFontFace, readSfnt, VALIDATED_VARIABLE_FONTS, withFault } from '../../src/fonts/index.ts';
import type { DeclaredFace, FontAssetResolver, FontFaults, VariableFontRefusal, VariableInstanceRequest } from '../../src/fonts/index.ts';
import { atRules, resolveFonts } from './compare.ts';

const root = new URL('../../../../', import.meta.url);
const INTER_VF = new Uint8Array(readFileSync(new URL('docs/research/text-spike/fonts/Inter-VF.ttf', root)));
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

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
const OTHER_VF = ((): Uint8Array => {
  const out = new Uint8Array(INTER_VF);
  out[out.length - 1] = (out[out.length - 1] as number) ^ 1;
  return out;
})();
const BYTES: Record<string, Uint8Array> = { 'vf.ttf': INTER_VF, 'nohvar.ttf': NO_HVAR, 'other.ttf': OTHER_VF };
const resolve: FontAssetResolver = (s) => (BYTES[s] !== undefined ? { id: `asset:${s}`, bytes: BYTES[s] } : resolveFonts(s));
const face = (css: string, faults: FontFaults = NO_FONT_FAULTS) => parseFontFace(atRules(css)[0] as CssNode, 0, resolve, faults);
const declared = (descriptors: string, faults: FontFaults = NO_FONT_FAULTS): DeclaredFace => {
  const f = face(`@font-face{font-family:V;src:url(vf.ttf);${descriptors}}`, faults).face;
  if (f === null) throw new Error('no face');
  return f;
};
const req = (r: Partial<VariableInstanceRequest> = {}): VariableInstanceRequest => ({ weight: 400, stretch: 100, style: { kind: 'normal' }, specifiedSize: 16, opticalSizing: 'auto', ...r });
const refusalOf = (css: string, faults: FontFaults = NO_FONT_FAULTS): VariableFontRefusal | null => {
  const issue = face(css, faults).issues.find((i) => i.kind === 'variable-font-refused');
  return issue?.kind === 'variable-font-refused' ? issue.refusal : null;
};

/** Faces and instances the fence must refuse. */
const MUST_REFUSE: ReadonlyArray<readonly [string, (faults: FontFaults) => VariableFontRefusal | null]> = [
  ['a variable font without HVAR', (f) => refusalOf('@font-face{font-family:V;src:url(nohvar.ttf)}', f)],
  ['a variable font outside the validated set', (f) => refusalOf('@font-face{font-family:V;src:url(other.ttf)}', f)],
  ['Inter VF at weight 700', (f) => fenceVariableInstance(declared('font-weight:100 900', f), req({ weight: 700 }), f)],
  ['Inter VF declared font-weight 700, requested 400', (f) => fenceVariableInstance(declared('font-weight:700', f), req(), f)],
  ['Inter VF with font-variation-settings wght 500', (f) => fenceVariableInstance(declared('', f), req({ variationSettings: [{ tag: 'wght', value: 500 }] }), f)],
  ['Inter VF at a specified size of 25px (opsz 25)', (f) => fenceVariableInstance(declared('', f), req({ specifiedSize: 25 }), f)],
  ['Inter VF with the font-variation-settings descriptor', (f) => fenceVariableInstance(declared('font-variation-settings:"wght" 400', f), req(), f)],
];

describe('variable-font fence (compiler fonts module)', () => {
  it('uses the text shaper\'s validated set, whose sha256 is the Inter VF file the gate measured', () => {
    const shaper = JSON.parse(readFileSync(new URL('packages/text-shaper/validated-variable-fonts.json', root), 'utf8')) as { fonts: { name: string; sha256: string; axes: unknown }[] };
    expect(VALIDATED_VARIABLE_FONTS).toEqual(shaper.fonts.map(({ name, sha256, axes }) => ({ name, sha256, axes })));
    expect(VALIDATED_VARIABLE_FONTS.map((v) => v.sha256)).toEqual([sha(INTER_VF)]);
  });

  it('reads the fvar axes of Inter VF', () => {
    const r = readSfnt(INTER_VF);
    if (!r.ok) throw new Error('unreadable');
    expect(fvarAxes(INTER_VF, r.font)).toEqual([{ tag: 'opsz', min: 14, default: 14, max: 32 }, { tag: 'wght', min: 100, default: 400, max: 900 }]);
  });

  it('refuses a bundled variable font without HVAR as a build error', () => {
    const r = face('@font-face{font-family:V;src:url(nohvar.ttf)}');
    expect(r.face?.source).toBeNull();
    expect(r.issues).toEqual([{ kind: 'variable-font-refused', url: 'nohvar.ttf', refusal: { kind: 'variable-font-without-hvar', sha256: sha(NO_HVAR) } }]);
    expect(buildManifest([r])).toEqual({ ok: false, errors: r.issues });
  });

  it('refuses a bundled variable font outside the validated set, also from a data: URL', () => {
    expect(refusalOf('@font-face{font-family:V;src:url(other.ttf)}')).toEqual({ kind: 'variable-font-not-validated', sha256: sha(OTHER_VF) });
    const b64 = Buffer.from(NO_HVAR).toString('base64');
    expect(refusalOf(`@font-face{font-family:V;src:url("data:font/ttf;base64,${b64}")}`)?.kind).toBe('variable-font-without-hvar');
  });

  it('accepts Inter VF, and static fonts, with no fence issue', () => {
    const r = face('@font-face{font-family:V;src:url(vf.ttf)}');
    expect(r.issues).toEqual([]);
    expect(r.face?.source?.font.variable).toBe(true);
    expect(buildManifest([r]).ok).toBe(true);
    const s = face('@font-face{font-family:S;font-weight:700;src:url("fonts/Inter/Inter-Bold.ttf")}');
    expect(s.issues).toEqual([]);
    expect(s.face !== null && fenceVariableInstance(s.face, req({ weight: 900, variationSettings: [{ tag: 'wght', value: 900 }] }))).toBeNull();
  });

  it('accepts the validated instances: default wght, automatic opsz from 14 to 24, the default instance', () => {
    const f = declared('');
    for (const r of [req(), req({ specifiedSize: 12 }), req({ specifiedSize: 24 }), req({ specifiedSize: 20 }), req({ specifiedSize: 8 }), req({ specifiedSize: 40, opticalSizing: 'none' }), req({ stretch: 150 }), req({ style: { kind: 'italic' } }), req({ variationSettings: [{ tag: 'opsz', value: 20 }] })]) {
      expect(fenceVariableInstance(f, r), JSON.stringify(r)).toBeNull();
    }
    expect(fenceVariableInstance(declared('font-weight:100 900'), req())).toBeNull();
  });

  it('refuses instances outside the validated axis ranges with the axis and every value Chrome could use', () => {
    expect(fenceVariableInstance(declared('font-weight:100 900'), req({ weight: 700 }))).toEqual({ kind: 'variable-instance-not-validated', font: 'InterVF', axis: 'wght', values: [400, 700], validated: [400, 400] });
    expect(fenceVariableInstance(declared(''), req({ specifiedSize: 100 }))).toEqual({ kind: 'variable-instance-not-validated', font: 'InterVF', axis: 'opsz', values: [14, 32], validated: [14, 24] });
  });

  it('refuses every must-refuse face and instance', () => {
    expect(MUST_REFUSE.filter(([, run]) => run(NO_FONT_FAULTS) === null).map(([name]) => name)).toEqual([]);
  });

  it('catches the planted fault fenceDisabled (unit fault)', () => {
    const f = withFault('fenceDisabled');
    expect(MUST_REFUSE.filter(([, run]) => run(f) === null).map(([name]) => name)).toEqual(MUST_REFUSE.map(([name]) => name));
    expect(buildManifest([face('@font-face{font-family:V;src:url(nohvar.ttf)}', f)], f).ok).toBe(true);
  });
});
