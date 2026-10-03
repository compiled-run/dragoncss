// The paint lowering seam (notes/T046-paint-spec.md §3 item 1): each paint feature is one module that turns a box's resolved
// style into typed writes, with one applied key per backend and the CSS longhands each write realises. native-program.ts
// runs the modules in registry order; nothing here reads a layout result.
import type { LayoutNode } from '@dragon/layout';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import type { Longhand } from '../../css/properties.ts';

export type NativeBackend = 'uikit' | 'android-views';

/**
 * native-property: a property the platform renders (backgroundColor, a text colour, a clip on a Dragon clip view).
 * dragon-owned-paint: pixels Dragon draws itself; never promoted from applied values alone (native-strategy.md 3.9 item 11).
 */
export type Technique = 'native-property' | 'dragon-owned-paint';

export type VocabularyEntry = { readonly key: string; readonly technique: Technique; readonly detail: string };

export class ProgramError extends Error {}

/** The module names, in the one registry order (lowering, emission, paint values, samples and support files all use it). */
export const PAINT_MODULE_NAMES = [
  'background', 'border', 'clip', 'radius', 'shadow', 'effects', 'stacking', 'outline', 'transform', 'gradient', 'scroll', 'fixed', 'scrollbar', 'image', 'foreign-view', 'control', 'visibility',
] as const;
export type PaintModuleName = (typeof PAINT_MODULE_NAMES)[number];

/** One box as a paint module sees it: the layout box, its resolved element (null for an anonymous box) and the enclosing element's color. */
export type BoxPaintContext = {
  readonly box: LayoutNode;
  readonly el: ResolvedElement | null;
  readonly parentColor: Rgba8;
  /** The node's facts record: a module publishes typed facts (paint order, radii, transforms) under its own name; never projected. */
  readonly facts: Record<string, unknown>;
};

/** A paint module's lowering: its write kinds with their vocabulary and longhands, and the writes of one box in emission order. */
export type PaintLowering<W extends { readonly kind: string }> = {
  readonly name: PaintModuleName;
  readonly vocabulary: { readonly [B in NativeBackend]: { readonly [K in W['kind']]: VocabularyEntry } };
  readonly css: { readonly [K in W['kind']]: readonly Longhand[] };
  readonly lower: (ctx: BoxPaintContext) => readonly W[];
};

/** A module with no writes yet: its seam is registered in final order and filled by its package. */
export function stubLowering(name: PaintModuleName): PaintLowering<never> {
  return { name, vocabulary: { uikit: {}, 'android-views': {} }, css: {}, lower: () => [] };
}
