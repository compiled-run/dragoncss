// The paint lowering registry (notes/T046-paint-spec.md §3 item 1): every paint module, registered once in final order. A box's
// writes are the modules' writes in this order, so the applied map order is fixed by the registry, never by a package.
import type { Longhand } from '../../css/properties.ts';
import type { BackgroundWrite } from './background.ts';
import { BACKGROUND_LOWERING } from './background.ts';
import type { BorderWrite } from './border.ts';
import { BORDER_LOWERING } from './border.ts';
import type { ClipWrite } from './clip.ts';
import { CLIP_LOWERING } from './clip.ts';
import { CONTROL_LOWERING } from './control.ts';
import type { EffectsWrite } from './effects.ts';
import { EFFECTS_LOWERING } from './effects.ts';
import { FIXED_LOWERING } from './fixed.ts';
import { FOREIGN_VIEW_LOWERING } from './foreign-view.ts';
import { GRADIENT_LOWERING } from './gradient.ts';
import { IMAGE_LOWERING } from './image.ts';
import type { OutlineWrite } from './outline.ts';
import { OUTLINE_LOWERING } from './outline.ts';
import type { RadiusWrite } from './radius.ts';
import { RADIUS_LOWERING } from './radius.ts';
import { SCROLL_LOWERING } from './scroll.ts';
import { SCROLLBAR_LOWERING } from './scrollbar.ts';
import type { ShadowWrite } from './shadow.ts';
import { SHADOW_LOWERING } from './shadow.ts';
import type { StackingWrite } from './stacking.ts';
import { STACKING_LOWERING } from './stacking.ts';
import { TRANSFORM_LOWERING } from './transform.ts';
import type { VisibilityWrite } from './visibility.ts';
import { VISIBILITY_LOWERING } from './visibility.ts';
import type { BoxPaintContext, NativeBackend, PaintLowering, VocabularyEntry } from './types.ts';
import { PAINT_MODULE_NAMES } from './types.ts';

/** Every paint write kind; a module adds its write type here when it gains writes. */
export type PaintWrite = BackgroundWrite | BorderWrite | ClipWrite | RadiusWrite | ShadowWrite | EffectsWrite | StackingWrite | OutlineWrite | VisibilityWrite;
export type PaintWriteKind = PaintWrite['kind'];

export type AnyLowering = PaintLowering<PaintWrite> | PaintLowering<BackgroundWrite> | PaintLowering<BorderWrite> | PaintLowering<ClipWrite> | PaintLowering<RadiusWrite> | PaintLowering<ShadowWrite> | PaintLowering<EffectsWrite> | PaintLowering<StackingWrite> | PaintLowering<OutlineWrite> | PaintLowering<VisibilityWrite> | PaintLowering<never>;

/** Registration point (EMS): the paint lowerings in PAINT_MODULE_NAMES order. */
export const PAINT_LOWERINGS: readonly AnyLowering[] = [
  BACKGROUND_LOWERING,
  BORDER_LOWERING,
  CLIP_LOWERING,
  RADIUS_LOWERING,
  SHADOW_LOWERING,
  EFFECTS_LOWERING,
  STACKING_LOWERING,
  OUTLINE_LOWERING,
  TRANSFORM_LOWERING,
  GRADIENT_LOWERING,
  SCROLL_LOWERING,
  FIXED_LOWERING,
  SCROLLBAR_LOWERING,
  IMAGE_LOWERING,
  FOREIGN_VIEW_LOWERING,
  CONTROL_LOWERING,
  VISIBILITY_LOWERING,
];

/**
 * Checks a lowering registry: the modules in PAINT_MODULE_NAMES order, every write kind declared by one module only, and each
 * module's longhands and both backends' vocabularies naming the same kinds; throws naming the first fault.
 */
export function checkPaintLowerings(lowerings: readonly AnyLowering[]): void {
  if (lowerings.map((m) => m.name).join() !== PAINT_MODULE_NAMES.join()) throw new Error('the paint lowering registry is not in PAINT_MODULE_NAMES order');
  const owner = new Map<string, string>();
  for (const m of lowerings) {
    const kinds = Object.keys(m.css).sort();
    for (const b of ['uikit', 'android-views'] as const) {
      const vocab = Object.keys(m.vocabulary[b]).sort();
      if (vocab.join() !== kinds.join()) throw new Error(`the ${m.name} paint lowering's ${b} vocabulary names ${vocab.join(', ') || 'no kind'}, its longhands name ${kinds.join(', ') || 'no kind'}`);
    }
    for (const k of kinds) {
      const o = owner.get(k);
      if (o !== undefined) throw new Error(`paint write kind ${k} is lowered by two modules (${o} and ${m.name})`);
      owner.set(k, m.name);
    }
  }
}

checkPaintLowerings(PAINT_LOWERINGS);

/** Every box's paint writes: each module's writes, in registry order. */
export function lowerBoxPaint(ctx: BoxPaintContext): PaintWrite[] {
  return PAINT_LOWERINGS.flatMap((m) => m.lower(ctx) as readonly PaintWrite[]);
}

/** The paint vocabulary of a backend over every registered module. */
export function paintVocabulary(backend: NativeBackend): { readonly [K in PaintWriteKind]: VocabularyEntry } {
  return Object.assign({}, ...PAINT_LOWERINGS.map((m) => m.vocabulary[backend])) as { readonly [K in PaintWriteKind]: VocabularyEntry };
}

/** The CSS longhands of every paint write kind. */
export function paintWriteCss(): { readonly [K in PaintWriteKind]: readonly Longhand[] } {
  return Object.assign({}, ...PAINT_LOWERINGS.map((m) => m.css)) as { readonly [K in PaintWriteKind]: readonly Longhand[] };
}
