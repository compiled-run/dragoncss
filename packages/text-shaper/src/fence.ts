// The variable-font fence (docs/decisions.md, "Variable fonts are fenced", PM T024). The shim's HVAR evaluator is a model of Core Text
// proven only on the gate's Inter VF cases, and a variable font without HVAR silently gets default-instance advances. So the API
// refuses, before any font is created, every variable font without HVAR and every instance outside validated-variable-fonts.json.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FontOptions } from './wasm.ts';

export const VALIDATED_VARIABLE_FONTS_PATH = fileURLToPath(new URL('../validated-variable-fonts.json', import.meta.url));

/** A variable font Chrome cases prove, with the user-space range each of its axes is proven over. */
export interface ValidatedVariableFont {
  readonly name: string;
  readonly file: string;
  readonly sha256: string;
  readonly axes: Readonly<Record<string, readonly [number, number]>>;
}

export interface ValidatedVariableFonts {
  readonly ruling: string;
  readonly evidence: string;
  readonly fonts: readonly ValidatedVariableFont[];
}

export function loadValidatedVariableFonts(path = VALIDATED_VARIABLE_FONTS_PATH): ValidatedVariableFonts {
  return JSON.parse(readFileSync(path, 'utf8')) as ValidatedVariableFonts;
}

/** Why the fence refuses a face or an instance. */
export type VariableFontRefusal =
  | { readonly kind: 'variable-font-without-hvar'; readonly sha256: string }
  | { readonly kind: 'variable-font-not-validated'; readonly sha256: string }
  | { readonly kind: 'variable-instance-not-validated'; readonly font: string; readonly axis: string; readonly value: number; readonly validated: readonly [number, number] | null };

export class VariableFontRefused extends Error {
  readonly refusal: VariableFontRefusal;
  constructor(refusal: VariableFontRefusal) {
    super(`variable font refused (docs/decisions.md, variable fonts are fenced): ${JSON.stringify(refusal)}`);
    this.name = 'VariableFontRefused';
    this.refusal = refusal;
  }
}

export interface FvarAxis {
  readonly tag: string;
  readonly min: number;
  readonly default: number;
  readonly max: number;
}

/** What the fence needs from a font file: variable (an fvar table), HVAR present, the fvar axes and the file's SHA-256. */
export interface FaceFacts {
  readonly variable: boolean;
  readonly hvar: boolean;
  readonly axes: readonly FvarAxis[];
  readonly sha256: string;
}

const tagAt = (b: Uint8Array, o: number): string => String.fromCharCode(b[o] as number, b[o + 1] as number, b[o + 2] as number, b[o + 3] as number);

/** Reads the fence facts of an sfnt file (face index 0). Files that are not sfnt report no tables and are left to HarfBuzz. */
export function faceFacts(bytes: Uint8Array): FaceFacts {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, { offset: number; length: number }>();
  if (bytes.length >= 12) {
    const n = d.getUint16(4);
    for (let i = 0; i < n && 12 + i * 16 + 16 <= bytes.length; i++) {
      const r = 12 + i * 16;
      tables.set(tagAt(bytes, r), { offset: d.getUint32(r + 8), length: d.getUint32(r + 12) });
    }
  }
  const fvar = tables.get('fvar');
  const hvar = tables.get('HVAR');
  const axes: FvarAxis[] = [];
  if (fvar !== undefined && fvar.length >= 16 && fvar.offset + fvar.length <= bytes.length) {
    const f = fvar.offset;
    const first = f + d.getUint16(f + 4);
    const count = d.getUint16(f + 8);
    const size = d.getUint16(f + 10);
    for (let i = 0; i < count; i++) {
      const o = first + i * size;
      if (o + 20 > f + fvar.length) break;
      axes.push({ tag: tagAt(bytes, o), min: d.getInt32(o + 4) / 65536, default: d.getInt32(o + 8) / 65536, max: d.getInt32(o + 12) / 65536 });
    }
  }
  return { variable: fvar !== undefined, hvar: hvar !== undefined && hvar.length > 0, axes, sha256 };
}

/** The face-level fence: a variable font must have HVAR and be in the validated set. */
export function fenceFace(facts: FaceFacts, validated: ValidatedVariableFonts = loadValidatedVariableFonts()): VariableFontRefusal | null {
  if (!facts.variable) return null;
  if (!facts.hvar) return { kind: 'variable-font-without-hvar', sha256: facts.sha256 };
  if (!validated.fonts.some((f) => f.sha256 === facts.sha256)) return { kind: 'variable-font-not-validated', sha256: facts.sha256 };
  return null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * The user-space value of every fvar axis that dhb_font_create sets for these options (src/dragon_hb.zig): wght, wdth and slnt
 * from the request, then font-variation-settings (a later entry wins), then opsz from the specified size when optical sizing is
 * auto and no setting names opsz; every value clamped to its axis, as Core Text and HarfBuzz clamp. Values are f32, as passed.
 */
export function instanceAxisValues(axes: readonly FvarAxis[], o: FontOptions): Map<string, number> {
  const f = Math.fround;
  const out = new Map<string, number>(axes.map((a) => [a.tag, a.default]));
  const set = (tag: string, v: number): void => {
    if (out.has(tag)) out.set(tag, f(v));
  };
  set('wght', o.weight ?? 400);
  set('wdth', o.width ?? 100);
  set('slnt', -(o.slope ?? 0));
  const settings = o.variations ?? [];
  for (const v of settings) set(v.tag, v.value);
  if (!settings.some((v) => v.tag === 'opsz')) set('opsz', o.opticalSizingAuto === false ? (axes.find((a) => a.tag === 'opsz')?.default ?? 0) : (o.specifiedSize ?? o.size));
  for (const a of axes) out.set(a.tag, clamp(out.get(a.tag) as number, f(a.min), f(a.max)));
  return out;
}

/** The instance-level fence: every axis of a variable font must resolve inside the validated range of that axis. */
export function fenceInstance(facts: FaceFacts, o: FontOptions, validated: ValidatedVariableFonts = loadValidatedVariableFonts()): VariableFontRefusal | null {
  const face = fenceFace(facts, validated);
  if (face !== null || !facts.variable) return face;
  const font = validated.fonts.find((x) => x.sha256 === facts.sha256) as ValidatedVariableFont;
  for (const [axis, value] of instanceAxisValues(facts.axes, o)) {
    const range = font.axes[axis] ?? null;
    if (range === null || value < range[0] || value > range[1]) return { kind: 'variable-instance-not-validated', font: font.name, axis, value, validated: range };
  }
  return null;
}
