// The paint-samples seam (notes/T046-paint-spec.md §2 and §3 item 4): each paint module may add sample points after the base
// points of a case (samples.ts generateSamples and the glyph rule) and may suppress base points it replaces (an outside point a
// shadow covers, the axis-aligned points of a transformed box). Colours are never chosen here; check (c) compares the capture
// with Chrome's pixels at the same points.
import type { NativeProgram } from 'dragon';
import type { ImageSize, SampleBox, SamplePoint } from '../samples.ts';

/** The paint modules, in the one registry order of the compiler's paint registries (dragon lower/paint/types.ts). */
export const PAINT_SAMPLE_MODULES = [
  'background', 'border', 'clip', 'radius', 'shadow', 'effects', 'stacking', 'outline', 'transform', 'gradient', 'scroll', 'fixed', 'scrollbar', 'image', 'foreign-view', 'control',
] as const;
export type PaintSampleModule = (typeof PAINT_SAMPLE_MODULES)[number];

/** One case at one DPR: the program, the raster size, the base sample boxes (engine geometry in device px) and the base points. */
export type PaintSampleContext = {
  readonly program: NativeProgram;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly dpr: number;
  readonly size: ImageSize;
  readonly boxes: readonly SampleBox[];
  readonly base: readonly SamplePoint[];
};

export type PaintSamples = {
  readonly name: PaintSampleModule;
  /** Whether a base point stays; false suppresses a point this module's paint replaces. */
  readonly keep: (p: SamplePoint, ctx: PaintSampleContext) => boolean;
  /** The points this module adds after the base points, with rules from SAMPLE_RULES. */
  readonly points: (ctx: PaintSampleContext) => readonly SamplePoint[];
};

/** A module with no points and no suppression yet. */
export const stubPaintSamples = (name: PaintSampleModule): PaintSamples => ({ name, keep: () => true, points: () => [] });
