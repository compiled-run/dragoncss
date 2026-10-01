// The paint-samples registry (EMS): every module, registered once in final order. casePoints (pixel-reference.ts) keeps the base
// points every module keeps, in their order, then appends each module's points in registry order.
import type { SamplePoint } from '../samples.ts';
import { BACKGROUND_SAMPLES } from './background.ts';
import { BORDER_SAMPLES } from './border.ts';
import { CLIP_SAMPLES } from './clip.ts';
import { CONTROL_SAMPLES } from './control.ts';
import { EFFECTS_SAMPLES } from './effects.ts';
import { FIXED_SAMPLES } from './fixed.ts';
import { FOREIGN_VIEW_SAMPLES } from './foreign-view.ts';
import { GRADIENT_SAMPLES } from './gradient.ts';
import { IMAGE_SAMPLES } from './image.ts';
import { OUTLINE_SAMPLES } from './outline.ts';
import { RADIUS_SAMPLES } from './radius.ts';
import { SCROLL_SAMPLES } from './scroll.ts';
import { SCROLLBAR_SAMPLES } from './scrollbar.ts';
import { SHADOW_SAMPLES } from './shadow.ts';
import { STACKING_SAMPLES } from './stacking.ts';
import { TRANSFORM_SAMPLES } from './transform.ts';
import type { PaintSampleContext, PaintSamples } from './types.ts';
import { PAINT_SAMPLE_MODULES } from './types.ts';

export type { PaintSampleContext, PaintSamples } from './types.ts';

/** Registration point (EMS): the paint-samples modules in PAINT_SAMPLE_MODULES order. */
export const PAINT_SAMPLES: readonly PaintSamples[] = [
  BACKGROUND_SAMPLES,
  BORDER_SAMPLES,
  CLIP_SAMPLES,
  RADIUS_SAMPLES,
  SHADOW_SAMPLES,
  EFFECTS_SAMPLES,
  STACKING_SAMPLES,
  OUTLINE_SAMPLES,
  TRANSFORM_SAMPLES,
  GRADIENT_SAMPLES,
  SCROLL_SAMPLES,
  FIXED_SAMPLES,
  SCROLLBAR_SAMPLES,
  IMAGE_SAMPLES,
  FOREIGN_VIEW_SAMPLES,
  CONTROL_SAMPLES,
];

if (PAINT_SAMPLES.map((m) => m.name).join() !== PAINT_SAMPLE_MODULES.join()) throw new Error('the paint-samples registry is not in PAINT_SAMPLE_MODULES order');

/** The points of a case: the base points every module keeps, in order, then every module's points in registry order. */
export function withPaintSamples(ctx: PaintSampleContext, modules: readonly PaintSamples[] = PAINT_SAMPLES): SamplePoint[] {
  const kept = ctx.base.filter((p) => modules.every((m) => m.keep(p, ctx)));
  return [...kept, ...modules.flatMap((m) => m.points(ctx))];
}
