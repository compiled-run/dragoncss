// background-color: a native property filling the border box (UIView.backgroundColor, a ColorDrawable). PNT1-opacity-b (first
// part): a box whose opacity folds (analysis/paint-values/effects.ts opacityFolds) has its opaque fill written with Chrome's
// opacity alpha byte (paint.ts opacityAlpha8), as Chrome folds the group's alpha into its one draw; effects.ts then writes no alpha.
import { opacityFolds } from '../../analysis/paint-values/effects.ts';
import type { Rgba8 } from '../../css/color.ts';
import { opacityAlpha8, TRANSPARENT } from '../../css/color.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type BackgroundWrite = { readonly kind: 'background-color'; readonly color: Rgba8 };

export const BACKGROUND_LOWERING: PaintLowering<BackgroundWrite> = {
  name: 'background',
  vocabulary: {
    uikit: { 'background-color': { key: 'backgroundColor', technique: 'native-property', detail: 'UIView.backgroundColor (sRGB), filling the border box' } },
    'android-views': { 'background-color': { key: 'background.color', technique: 'native-property', detail: 'View.background = ColorDrawable(ARGB), filling the border box' } },
  },
  css: { 'background-color': ['background-color'] },
  // An anonymous box takes the initial value of every non-inherited property (CSS2 §9.2.1.1): transparent.
  lower: ({ el }) => [{ kind: 'background-color', color: el === null ? TRANSPARENT : foldedBackground(el) }],
};

/** The fractional opacity of an element whose group folds into its fill, or null. */
export function foldedOpacity(el: ResolvedElement): number | null {
  const v = el.props.get('opacity');
  if (v === undefined) throw new ProgramError(`${el.element.address}: opacity did not resolve`);
  const o = opacityOf(v.value);
  if (o === null) throw new ProgramError(`${el.element.address}: opacity did not compute to a number`);
  return o > 0 && o < 1 && opacityFolds(el) ? o : null;
}

function foldedBackground(el: ResolvedElement): Rgba8 {
  const c = usedColors(el)['background-color'];
  const o = foldedOpacity(el);
  return o === null || c.alpha === 0 ? c : { ...c, alpha: opacityAlpha8(o) };
}
