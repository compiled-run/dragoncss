// The variable-font fence (docs/decisions.md, "Variable fonts are fenced", PM T024). Dragon's advances for a variable instance
// come from a model of Core Text proven only on the text gate's Inter VF cases, and a variable font without HVAR would silently
// get default-instance advances. So a bundled face that is a variable font without HVAR, or not in the validated set, is refused
// when its @font-face resolves, and an instance outside the validated axis ranges is refused when a style resolves to it.
import { sha256HexBytes } from '../digest.ts';
import { NO_FONT_FAULTS } from './faults.ts';
import type { FontFaults } from './faults.ts';
import type { DeclaredFace } from './font-face.ts';
import type { FontSelectionRange } from './selection.ts';
import type { SfntFont } from './sfnt.ts';

/** A variable font Chrome cases prove, with the user-space range each of its axes is proven over. */
export type ValidatedVariableFont = {
  readonly name: string;
  readonly sha256: string;
  readonly axes: { readonly [tag: string]: readonly [number, number] };
};

/**
 * The validated set: packages/text-shaper/validated-variable-fonts.json (a test keeps the two equal), whose evidence is the text
 * gate's 60 exact Inter VF cases. Widening it needs Chrome cases first.
 */
export const VALIDATED_VARIABLE_FONTS: readonly ValidatedVariableFont[] = [
  { name: 'InterVF', sha256: '29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031', axes: { opsz: [14, 24], wght: [400, 400] } },
];

export type VariableFontRefusal =
  | { readonly kind: 'variable-font-without-hvar'; readonly sha256: string }
  | { readonly kind: 'variable-font-not-validated'; readonly sha256: string }
  | { readonly kind: 'variable-instance-not-validated'; readonly font: string; readonly axis: string; readonly values: readonly number[]; readonly validated: readonly [number, number] | null }
  | { readonly kind: 'variable-descriptor-settings'; readonly font: string };

export type FvarAxis = { readonly tag: string; readonly min: number; readonly default: number; readonly max: number };

/** The fvar axes in user space; empty when the font has no fvar table. */
export function fvarAxes(bytes: Uint8Array, font: SfntFont): FvarAxis[] {
  const t = font.tables.get('fvar');
  if (t === undefined || t.length < 16) return [];
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const first = t.offset + d.getUint16(t.offset + 4);
  const count = d.getUint16(t.offset + 8);
  const size = d.getUint16(t.offset + 10);
  const axes: FvarAxis[] = [];
  for (let i = 0; i < count; i++) {
    const o = first + i * size;
    if (o + 20 > t.offset + t.length) break;
    const tag = String.fromCharCode(d.getUint8(o), d.getUint8(o + 1), d.getUint8(o + 2), d.getUint8(o + 3));
    axes.push({ tag, min: d.getInt32(o + 4) / 65536, default: d.getInt32(o + 8) / 65536, max: d.getInt32(o + 12) / 65536 });
  }
  return axes;
}

/** The face-level fence, run when a bundled @font-face src resolves: a variable font must have HVAR and be validated. */
export function fenceVariableFace(bytes: Uint8Array, font: SfntFont, faults: FontFaults = NO_FONT_FAULTS): VariableFontRefusal | null {
  if (!font.variable || faults.fenceDisabled) return null;
  const sha256 = sha256HexBytes(bytes);
  if ((font.tables.get('HVAR')?.length ?? 0) === 0) return { kind: 'variable-font-without-hvar', sha256 };
  if (!VALIDATED_VARIABLE_FONTS.some((v) => v.sha256 === sha256)) return { kind: 'variable-font-not-validated', sha256 };
  return null;
}

/** What a style asks of a face: the computed font properties that can move a variable font's axes. */
export type VariableInstanceRequest = {
  readonly weight: number;
  /** font-stretch as a percentage. */
  readonly stretch: number;
  readonly style: { readonly kind: 'normal' | 'italic' } | { readonly kind: 'oblique'; readonly degrees: number };
  /** The CSS specified size in px (Blink sets opsz from it, not from the computed size). */
  readonly specifiedSize: number;
  readonly opticalSizing: 'auto' | 'none';
  /** The font-variation-settings property. */
  readonly variationSettings?: readonly { readonly tag: string; readonly value: number }[];
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const rangeOf = (r: FontSelectionRange): [number, number] => [r.minimum.raw / 4, r.maximum.raw / 4];

/**
 * Every value each axis of the face can take for the request. Where Blink could clamp a request to the face's descriptor range or
 * to the axis range, both are kept, so the fence never needs to know which one Chrome picks: all of them must be validated.
 */
export function instanceCandidates(axes: readonly FvarAxis[], face: DeclaredFace, r: VariableInstanceRequest): Map<string, number[]> {
  const f = Math.fround;
  const out = new Map<string, number[]>(axes.map((a) => [a.tag, [a.default]]));
  const add = (tag: string, ...vs: number[]): void => {
    out.get(tag)?.push(...vs.map(f));
  };
  const slope = r.style.kind === 'oblique' ? r.style.degrees : r.style.kind === 'italic' ? 14 : 0;
  const caps = face.capabilities;
  add('wght', r.weight, clamp(r.weight, ...rangeOf(caps.weight)));
  add('wdth', r.stretch, clamp(r.stretch, ...rangeOf(caps.width)));
  add('slnt', -slope, -clamp(slope, ...rangeOf(caps.slope)));
  if (r.style.kind !== 'normal') add('ital', 1);
  const settings = r.variationSettings ?? [];
  for (const s of settings) add(s.tag, s.value);
  if (r.opticalSizing === 'auto' && !settings.some((s) => s.tag === 'opsz')) add('opsz', r.specifiedSize);
  for (const a of axes) out.set(a.tag, [...new Set((out.get(a.tag) as number[]).map((v) => clamp(v, f(a.min), f(a.max))))]);
  return out;
}

/** The instance-level fence: the face must pass the face-level fence and every axis must stay inside its validated range. */
export function fenceVariableInstance(face: DeclaredFace, request: VariableInstanceRequest, faults: FontFaults = NO_FONT_FAULTS): VariableFontRefusal | null {
  const source = face.source;
  if (source === null || !source.font.variable || faults.fenceDisabled) return null;
  const refused = fenceVariableFace(source.bytes, source.font, faults);
  if (refused !== null) return refused;
  const sha256 = sha256HexBytes(source.bytes);
  const font = VALIDATED_VARIABLE_FONTS.find((v) => v.sha256 === sha256) as ValidatedVariableFont;
  // Dragon does not apply the descriptor (descriptor-not-applied), so an instance it could move is not the validated one.
  if (face.descriptors.variationSettings !== undefined) return { kind: 'variable-descriptor-settings', font: font.name };
  for (const [axis, values] of instanceCandidates(fvarAxes(source.bytes, source.font), face, request)) {
    const range = font.axes[axis] ?? null;
    if (range === null || values.some((v) => v < range[0] || v > range[1])) return { kind: 'variable-instance-not-validated', font: font.name, axis, values, validated: range };
  }
  return null;
}
