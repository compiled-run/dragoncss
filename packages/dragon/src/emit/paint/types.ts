// The paint emission seam (notes/T046-paint-spec.md §3 items 2 and 3): each paint module gives, per backend, the case-code lines
// of its writes, its native support (members of the box view, a support file, stage painters, the after-layout hook and the
// applied-value readback), its expected-dump projection and its raster plants. uikit.ts, android-views.ts, expected-dump.ts and
// native-support.ts dispatch through the registry, so a paint package edits only its own module.
import type { NativeBackend, PaintModuleName } from '../../lower/paint/types.ts';
import type { ProgramNode, ProgramWrite } from '../../lower/native-program.ts';
import type { ExpectedEngine, JsonValue, NodeGeometry } from '../expected-dump.ts';

/** The box-view paint stages, in CSS paint order (CSS2 Appendix E within one box). */
export const PAINT_STAGES = ['outer-shadow', 'background', 'background-layers', 'inset-shadow', 'border', 'outline'] as const;
export type PaintStage = (typeof PAINT_STAGES)[number];

/**
 * A module's native code on one backend. Every name is a public Swift or Kotlin function in the module's support file:
 * stage painters take (view, context or canvas, shape); the after-layout hook takes (view, shape, scale) and runs after every
 * layout; applied returns the module's readback pairs in write order; roundedPath (the radius module) returns the rounded outer
 * or inner path of a shape, or nil; container (the scroll module) makes the view a clipping box hosts its children in.
 */
export type NativePaint = {
  /** Declarations inside the DragonBoxView class body: the module's stored state and its public writers. */
  readonly boxMembers: string;
  /** The module's support file source after its header, or null for none. */
  readonly file: string | null;
  readonly stages: { readonly [S in PaintStage]?: string };
  readonly afterLayout: string | null;
  readonly applied: string | null;
  readonly roundedPath: string | null;
  readonly container: string | null;
};

/**
 * The TS paint references the host passes in with the engine (the compiler core imports the engine for types only): the same
 * functions the device runs translated, for the expected applied values.
 */
export type PaintEngine = {
  /** paint-radius.ts roundedShape: the outer then the padding-edge radii of a snapped border box and its layout size, in device px. */
  /** paint.ts opacityAlpha8: Skia's paint alpha byte of an opacity. */
  readonly opacityAlpha8: (opacity: number) => number;
  /** paint-radius.ts outlineRings, outlineWidthPx and outlineOffsetPx: an outline's rings in device px. */
  readonly outlineRings: (left: number, top: number, right: number, bottom: number, radii: readonly number[], width: number, offset: number, double: boolean) => number[];
  readonly outlineWidthPx: (width: number, dpr: number) => number;
  readonly outlineOffsetPx: (offset: number, dpr: number) => number;
  readonly roundedShape: (left: number, top: number, right: number, bottom: number, layoutWidth: number, layoutHeight: number, borders: readonly number[], lengths: readonly { readonly percent: boolean; readonly value: number }[], dpr: number, faults: { readonly radiusUnclamped: boolean; readonly innerRadiusNotReduced: boolean }) => number[];
};

export const NO_NATIVE_PAINT: NativePaint = { boxMembers: '', file: null, stages: {}, afterLayout: null, applied: null, roundedPath: null, container: null };

/** A raster plant a module declares: one text replacement in its support source per backend, proving a pixel lane sees it. */
export type PaintPlant = { readonly name: string; readonly replace: { readonly [B in NativeBackend]: readonly [string, string] } };

export type PaintEmitter<K extends string> = {
  readonly name: PaintModuleName;
  readonly kinds: readonly K[];
  /**
   * The case-code lines of one write. Each line calls the module's public writer (a setter or function of the support code), the
   * same entry point a runtime write calls (RT-1, RT-2, RT-11), so a runtime write equals the static build by construction.
   */
  readonly lines: { readonly [B in NativeBackend]: (v: string, n: ProgramNode, w: ProgramWrite & { readonly kind: K }) => string[] };
  /** The applied value of one write at a device scale, in the backend's units; the device reads back the same through native.applied. */
  readonly applied: (engine: ExpectedEngine, backend: NativeBackend, w: ProgramWrite & { readonly kind: K }, dpr: number, g: NodeGeometry) => JsonValue;
  readonly native: { readonly [B in NativeBackend]: NativePaint };
  readonly plants: readonly PaintPlant[];
};

/** A module with no writes and no native code yet: registered once in final order and filled by its package. */
export function stubEmitter(name: PaintModuleName): PaintEmitter<never> {
  return {
    name,
    kinds: [],
    lines: { uikit: () => [], 'android-views': () => [] },
    applied: () => {
      throw new Error(`the ${name} paint module has no writes`);
    },
    native: { uikit: NO_NATIVE_PAINT, 'android-views': NO_NATIVE_PAINT },
    plants: [],
  };
}

/** A Swift or Kotlin RGBA8 constructor. */
export const rgbaLit = (c: { r: number; g: number; b: number; alpha: number }): string => `DragonRGBA8(${c.r}, ${c.g}, ${c.b}, ${c.alpha})`;

/** A CSS keyword as a Swift or Kotlin string literal (keywords are lowercase ASCII letters and hyphens, so no escaping applies). */
export function keywordLit(k: string): string {
  if (!/^[a-z-]+$/.test(k)) throw new Error(`${JSON.stringify(k)} is not a CSS keyword`);
  return `"${k}"`;
}
