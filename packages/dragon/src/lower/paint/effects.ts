// opacity (css-color-4 §14.1): a native property (T046 §1), UIView.alpha and View.setAlpha, which composite the subtree as a group
// as CSS does. The write carries the computed opacity; the device takes Chrome's alpha byte from it with the translated paint.ts
// opacityAlpha8 (Skia's getAlpha, in float) and sets the native alpha to byte / 255. An opacity of 1 has no write; any opacity
// below 1 makes a stacking context (lower/paint/stacking.ts). color-scheme has no write: the compiler resolves it
// (analysis/paint-values/effects.ts usedColorScheme).
import { opacityOf } from '../../css/properties/effects.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type EffectsWrite = { readonly kind: 'opacity'; readonly opacity: number };

/** The facts of a node with opacity below 1: its computed opacity. */
export type EffectsFacts = { readonly opacity: number };

export const EFFECTS_LOWERING: PaintLowering<EffectsWrite> = {
  name: 'effects',
  vocabulary: {
    uikit: { opacity: { key: 'alpha', technique: 'native-property', detail: "UIView.alpha = Chrome's paint alpha byte / 255 (paint.ts opacityAlpha8); UIKit composites the subtree as a group (UIViewGroupOpacity)" } },
    'android-views': { opacity: { key: 'alpha', technique: 'native-property', detail: "View.setAlpha(Chrome's paint alpha byte / 255f, paint.ts opacityAlpha8); hasOverlappingRendering() is true, so the subtree composites as a group" } },
  },
  css: { opacity: ['opacity'] },
  // An anonymous box takes the initial opacity (CSS2 §9.2.1.1): 1, so no write.
  lower: ({ el, facts }) => {
    if (el === null) return [];
    const v = el.props.get('opacity');
    if (v === undefined) throw new ProgramError(`${el.element.address}: opacity did not resolve`);
    const opacity = opacityOf(v.value);
    if (opacity === null) throw new ProgramError(`${el.element.address}: opacity did not compute to a number`);
    if (opacity === 1) return [];
    const effects: EffectsFacts = { opacity };
    facts['effects'] = effects;
    return [{ kind: 'opacity', opacity }];
  },
};
