// background-color: a native property filling the border box (UIView.backgroundColor, a ColorDrawable). PNT1-opacity-b (first
// part): a box whose opacity folds (analysis/paint-values/effects.ts opacityFolds) has its opaque fill written with Chrome's
// opacity alpha byte (paint.ts opacityAlpha8), as Chrome folds the group's alpha into its one draw; effects.ts then writes no alpha.
// Such a translucent fill is marked folded: native draws it as Chrome's opaque bytes over its backdrop (emit/paint/background.ts),
// as the platform's own blend of a translucent colour is one off Chrome's blit in a channel.
import { groupPlanAt, opacityFolds } from '../../analysis/paint-values/effects.ts';
import type { Rgba8 } from '../../css/color.ts';
import { opacityAlpha8, TRANSPARENT } from '../../css/color.ts';
import { textClipFillOf } from '../../analysis/paint-values/gradient.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type BackgroundWrite = { readonly kind: 'background-color'; readonly color: Rgba8; readonly folded?: true };

export const BACKGROUND_LOWERING: PaintLowering<BackgroundWrite> = {
  name: 'background',
  vocabulary: {
    uikit: { 'background-color': { key: 'backgroundColor', technique: 'native-property', detail: 'UIView.backgroundColor (sRGB), filling the border box' } },
    'android-views': { 'background-color': { key: 'background.color', technique: 'native-property', detail: 'View.background = ColorDrawable(ARGB), filling the border box' } },
  },
  css: { 'background-color': ['background-color'] },
  // An anonymous box takes the initial value of every non-inherited property (CSS2 §9.2.1.1): transparent. A colour clipped to
  // text is drawn by the box's glyphs instead (native-program.ts textPaint).
  lower: ({ el }) => [el === null || textClipFillOf(el) !== null ? { kind: 'background-color', color: TRANSPARENT } : foldedBackground(el)],
};

/** The fractional opacity of an element whose group folds into its fill, or null; a group nested in a pre-composited one stays a group. */
export function foldedOpacity(el: ResolvedElement): number | null {
  const v = el.props.get('opacity');
  if (v === undefined) throw new ProgramError(`${el.element.address}: opacity did not resolve`);
  const o = opacityOf(v.value);
  if (o === null) throw new ProgramError(`${el.element.address}: opacity did not compute to a number`);
  return o > 0 && o < 1 && opacityFolds(el) && groupPlanAt(el)?.kind !== 'nested' ? o : null;
}

function foldedBackground(el: ResolvedElement): BackgroundWrite {
  const c = usedColors(el)['background-color'];
  const o = foldedOpacity(el);
  if (o === null || c.alpha === 0) return { kind: 'background-color', color: c };
  const color = { ...c, alpha: opacityAlpha8(o) };
  // Alpha 0 paints nothing and 255 is the colour itself, which the platform draws exactly. The folded bytes are modelled over the
  // ancestors' fills alone, so a box an offset can move over an earlier sibling's paint keeps the platform blend.
  return color.alpha === 0 || color.alpha === 255 || !inFlowPaint(el) ? { kind: 'background-color', color } : { kind: 'background-color', color, folded: true };
}

const OFFSETS = ['top', 'right', 'bottom', 'left'] as const;

/** Whether the box paints where flow put it: static, or relative with every offset auto or zero (a transform never folds). */
function inFlowPaint(el: ResolvedElement): boolean {
  const position = el.props.get('position')?.value;
  if (position === undefined || position.kind !== 'keyword') return false;
  if (position.value === 'static') return true;
  if (position.value !== 'relative') return false;
  return OFFSETS.every((side) => {
    const v = el.props.get(side)?.value;
    return v === undefined || (v.kind === 'keyword' && v.value === 'auto') || ((v.kind === 'length' || v.kind === 'percentage') && v.value === 0);
  });
}
