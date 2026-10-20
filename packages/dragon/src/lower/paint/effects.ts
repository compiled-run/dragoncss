// opacity (css-color-4 §14.1): a native property (T046 §1), UIView.alpha and View.setAlpha, which composite the subtree as a group
// as CSS does. The write carries the computed opacity; the device takes Chrome's alpha byte from it with the translated paint.ts
// opacityAlpha8 (Skia's getAlpha, in float) and sets the native alpha to byte / 255. An opacity of 1 has no write; any opacity
// below 1 makes a stacking context (lower/paint/stacking.ts). A group that folds into its one opaque fill (background.ts
// foldedOpacity) has no write: the fill carries the alpha. A group native pre-composites (analysis/paint-values/effects.ts
// opacityGroupPlans, PNT1-opacity-b) gets an opacity-group write instead: the view keeps alpha 1 and an overlay shows Chrome's
// composite of it over its backdrop's painters.
import type { ResolvedElement } from '../../analysis/resolve.ts';
import type { GroupPlan } from '../../analysis/paint-values/effects.ts';
import { opacityGroupPlans } from '../../analysis/paint-values/effects.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import { foldedOpacity } from './background.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type EffectsWrite =
  | { readonly kind: 'opacity'; readonly opacity: number }
  /** A pre-composited group: its opacity, its backdrop box (null for the canvas) and the painters before it there, in paint order. */
  | { readonly kind: 'opacity-group'; readonly opacity: number; readonly backdrop: string | null; readonly painters: readonly string[] };

/** The group plans of the case being lowered, taken at its root element, which the lowering visits first. */
let current: { readonly root: ResolvedElement; readonly plans: ReadonlyMap<string, GroupPlan> } | null = null;

/** The facts of a node with opacity below 1: its computed opacity. */
export type EffectsFacts = { readonly opacity: number };

const GROUP_DETAIL = (how: string): string => `DragonBoxView [alpha, Chrome's alpha byte, backdrop id or null]: the view keeps alpha 1 and a DragonGroupView overlay, its last child, shows Chrome's composite (paint-group.ts groupComposite per cc raster tile) of the group's layer over a software backdrop of the listed painters, at whole device px with nearest filtering. ${how}`;

export const EFFECTS_LOWERING: PaintLowering<EffectsWrite> = {
  name: 'effects',
  vocabulary: {
    uikit: { opacity: { key: 'alpha', technique: 'native-property', detail: "UIView.alpha = Chrome's paint alpha byte / 255 (paint.ts opacityAlpha8); UIKit composites the subtree as a group (UIViewGroupOpacity)" }, 'opacity-group': { key: 'dragonGroup', technique: 'dragon-owned-paint', detail: GROUP_DETAIL('iOS: the group rendered by CALayer.render(in:) into a premultiplied sRGB context at the device scale') } },
    'android-views': { opacity: { key: 'alpha', technique: 'native-property', detail: "View.setAlpha(Chrome's paint alpha byte / 255f, paint.ts opacityAlpha8); hasOverlappingRendering() is true, so the subtree composites as a group" }, 'opacity-group': { key: 'dragonGroup', technique: 'dragon-owned-paint', detail: GROUP_DETAIL('Android: the group drawn by View.draw into an ARGB_8888 Bitmap') } },
  },
  css: { opacity: ['opacity'], 'opacity-group': ['opacity'] },
  // An anonymous box takes the initial opacity (CSS2 §9.2.1.1): 1, so no write.
  lower: ({ box, el, facts }) => {
    if (el === null) return [];
    if (el.element.tag === 'html') current = { root: el, plans: opacityGroupPlans(el) };
    const v = el.props.get('opacity');
    if (v === undefined) throw new ProgramError(`${el.element.address}: opacity did not resolve`);
    const opacity = opacityOf(v.value);
    if (opacity === null) throw new ProgramError(`${el.element.address}: opacity did not compute to a number`);
    if (opacity === 1) return [];
    if (foldedOpacity(el) !== null) {
      if (box.kind !== 'box' || box.children.length > 0) throw new ProgramError(`${el.element.address}: a folded opacity group has content in its layout box`);
      return [];
    }
    const effects: EffectsFacts = { opacity };
    facts['effects'] = effects;
    if (opacity > 0) {
      if (current === null) throw new ProgramError(`${el.element.address}: the effects lowering did not see this element's root first`);
      const plan = current.plans.get(el.element.address);
      if (plan?.kind === 'group') return [{ kind: 'opacity-group', opacity, backdrop: plan.backdrop, painters: plan.painters }];
    }
    return [{ kind: 'opacity', opacity }];
  },
};
