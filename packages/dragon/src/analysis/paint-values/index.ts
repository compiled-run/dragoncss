// The paint-values registry (EMS): every module, registered once in final order; computePaintValues runs them in that order.
import type { Longhand } from '../../css/properties.ts';
import { PAINT_MODULE_NAMES } from '../../lower/paint/types.ts';
import type { ResolvedValue } from '../computed.ts';
import { BACKGROUND_VALUES } from './background.ts';
import { BORDER_VALUES } from './border.ts';
import { CLIP_VALUES } from './clip.ts';
import { CONTROL_VALUES } from './control.ts';
import { EFFECTS_VALUES } from './effects.ts';
import { FIXED_VALUES } from './fixed.ts';
import { FOREIGN_VIEW_VALUES } from './foreign-view.ts';
import { GRADIENT_VALUES } from './gradient.ts';
import { IMAGE_VALUES } from './image.ts';
import { OUTLINE_VALUES } from './outline.ts';
import { RADIUS_VALUES } from './radius.ts';
import { SCROLL_VALUES } from './scroll.ts';
import { SCROLLBAR_VALUES } from './scrollbar.ts';
import { SHADOW_VALUES } from './shadow.ts';
import { STACKING_VALUES } from './stacking.ts';
import { TRANSFORM_VALUES } from './transform.ts';
import type { PaintValueContext, PaintValues } from './types.ts';

export type { PaintValueContext, PaintValues } from './types.ts';

/** Registration point (EMS): the paint-values modules in PAINT_MODULE_NAMES order. */
export const PAINT_VALUES: readonly PaintValues[] = [
  BACKGROUND_VALUES,
  BORDER_VALUES,
  CLIP_VALUES,
  RADIUS_VALUES,
  SHADOW_VALUES,
  EFFECTS_VALUES,
  STACKING_VALUES,
  OUTLINE_VALUES,
  TRANSFORM_VALUES,
  GRADIENT_VALUES,
  SCROLL_VALUES,
  FIXED_VALUES,
  SCROLLBAR_VALUES,
  IMAGE_VALUES,
  FOREIGN_VIEW_VALUES,
  CONTROL_VALUES,
];

if (PAINT_VALUES.map((m) => m.name).join() !== PAINT_MODULE_NAMES.join()) throw new Error('the paint-values registry is not in PAINT_MODULE_NAMES order');

/** The computed values of the paint longhands, after computeLengths, each module in registry order. */
export function computePaintValues(props: Map<Longhand, ResolvedValue>, ctx: PaintValueContext): void {
  for (const m of PAINT_VALUES) m.compute(props, ctx);
}
