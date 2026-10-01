// background-color: a native property filling the border box (UIView.backgroundColor, a ColorDrawable).
import type { Rgba8 } from '../../css/color.ts';
import { TRANSPARENT } from '../../css/color.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';

export type BackgroundWrite = { readonly kind: 'background-color'; readonly color: Rgba8 };

export const BACKGROUND_LOWERING: PaintLowering<BackgroundWrite> = {
  name: 'background',
  vocabulary: {
    uikit: { 'background-color': { key: 'backgroundColor', technique: 'native-property', detail: 'UIView.backgroundColor (sRGB), filling the border box' } },
    'android-views': { 'background-color': { key: 'background.color', technique: 'native-property', detail: 'View.background = ColorDrawable(ARGB), filling the border box' } },
  },
  css: { 'background-color': ['background-color'] },
  // An anonymous box takes the initial value of every non-inherited property (CSS2 §9.2.1.1): transparent.
  lower: ({ el }) => [{ kind: 'background-color', color: el === null ? TRANSPARENT : usedColors(el)['background-color'] }],
};
