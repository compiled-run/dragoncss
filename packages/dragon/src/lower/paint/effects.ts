// opacity (css-color-4 §14.1): a native property (T046 §1), UIView.alpha and View.setAlpha, which composite the subtree as a group
// as CSS does. The write carries the computed opacity; the device takes Chrome's alpha byte from it with the translated paint.ts
// opacityAlpha8 (Skia's getAlpha, in float) and sets the native alpha to byte / 255. An opacity of 1 has no write; any opacity
// below 1 makes a stacking context (lower/paint/stacking.ts). A group that folds into its one opaque fill (background.ts
// foldedOpacity) has no write: the fill carries the alpha. A group native pre-composites (analysis/paint-values/effects.ts
// opacityGroupPlans, PNT1-opacity-b) gets an opacity-group write instead: the view keeps alpha 1 and an overlay shows Chrome's
// composite of it over its backdrop's painters. PNT1-filter: an admitted group with a colour-matrix filter (at any opacity above 0)
// gets a filter-group write, whose overlay applies the filter to the group's layer before its opacity. S2: a group nested in an
// admitted group gets an opacity-nested write: the view keeps alpha 1 and the outer group's overlay composites it in software.
import type { FilterFunction } from '../../css/properties/filter.ts';
import { filterApplies } from '../../css/properties/filter.ts';
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
  | { readonly kind: 'opacity-group'; readonly opacity: number; readonly backdrop: string | null; readonly painters: readonly string[] }
  /** A pre-composited group with a colour-matrix filter: its opacity (1 for none), its filter functions, backdrop box and painters. */
  | { readonly kind: 'filter-group'; readonly opacity: number; readonly filter: readonly FilterFunction[]; readonly backdrop: string | null; readonly painters: readonly string[] }
  /** A group nested in a pre-composited group: its opacity; the outer group's overlay composites it into the outer layer. */
  | { readonly kind: 'opacity-nested'; readonly opacity: number };

/** The group plans of the case being lowered, taken at its root element, which the lowering visits first. */
let current: { readonly root: ResolvedElement; readonly plans: ReadonlyMap<string, GroupPlan> } | null = null;

/** The facts of a node with opacity below 1 or a drawn filter: its computed opacity, and the filter functions of a filter group. */
export type EffectsFacts = { readonly opacity: number } | { readonly opacity: number; readonly filter: readonly FilterFunction[] };

const FILTER_DETAIL = (how: string): string => `DragonBoxView [alpha, Chrome's alpha byte, backdrop id or null, then each filter function's code and amount]: as dragonGroup, with the group's layer run through Chrome's colour-matrix filters before its opacity (paint-group.ts groupFilterMatrices, groupFilterComposite). ${how}`;

const NESTED_DETAIL = "DragonBoxView [alpha, Chrome's alpha byte]: the view keeps alpha 1; the overlay of the pre-composited group it is nested in builds that group's layer in software and composites this group into it (paint-group.ts groupComposite, or groupFill at groupFoldAlpha where cc folds it)";

const GROUP_DETAIL = (how: string): string => `DragonBoxView [alpha, Chrome's alpha byte, backdrop id or null]: the view keeps alpha 1 and a DragonGroupView overlay, its last child, shows Chrome's composite (paint-group.ts groupComposite per cc raster tile) of the group's layer over a software backdrop of the listed painters, at whole device px with nearest filtering. ${how}`;

export const EFFECTS_LOWERING: PaintLowering<EffectsWrite> = {
  name: 'effects',
  vocabulary: {
    uikit: { opacity: { key: 'alpha', technique: 'native-property', detail: "UIView.alpha = Chrome's paint alpha byte / 255 (paint.ts opacityAlpha8); UIKit composites the subtree as a group (UIViewGroupOpacity)" }, 'opacity-group': { key: 'dragonGroup', technique: 'dragon-owned-paint', detail: GROUP_DETAIL('iOS: the group rendered by CALayer.render(in:) into a premultiplied sRGB context at the device scale') }, 'filter-group': { key: 'dragonFilterGroup', technique: 'dragon-owned-paint', detail: FILTER_DETAIL('iOS: the group rendered by CALayer.render(in:) into a premultiplied sRGB context at the device scale') }, 'opacity-nested': { key: 'dragonNestedGroup', technique: 'dragon-owned-paint', detail: NESTED_DETAIL } },
    'android-views': { opacity: { key: 'alpha', technique: 'native-property', detail: "View.setAlpha(Chrome's paint alpha byte / 255f, paint.ts opacityAlpha8); hasOverlappingRendering() is true, so the subtree composites as a group" }, 'opacity-group': { key: 'dragonGroup', technique: 'dragon-owned-paint', detail: GROUP_DETAIL('Android: the group drawn by View.draw into an ARGB_8888 Bitmap') }, 'filter-group': { key: 'dragonFilterGroup', technique: 'dragon-owned-paint', detail: FILTER_DETAIL('Android: the group drawn by View.draw into an ARGB_8888 Bitmap') }, 'opacity-nested': { key: 'dragonNestedGroup', technique: 'dragon-owned-paint', detail: NESTED_DETAIL } },
  },
  css: { opacity: ['opacity'], 'opacity-group': ['opacity'], 'filter-group': ['filter', 'opacity'], 'opacity-nested': ['opacity'] },
  // An anonymous box takes the initial opacity (CSS2 §9.2.1.1): 1, so no write.
  lower: ({ box, el, facts }) => {
    if (el === null) return [];
    if (el.element.tag === 'html') current = { root: el, plans: opacityGroupPlans(el) };
    const v = el.props.get('opacity');
    if (v === undefined) throw new ProgramError(`${el.element.address}: opacity did not resolve`);
    const opacity = opacityOf(v.value);
    if (opacity === null) throw new ProgramError(`${el.element.address}: opacity did not compute to a number`);
    const f = el.props.get('filter');
    if (f === undefined) throw new ProgramError(`${el.element.address}: filter did not resolve`);
    if (opacity === 1 && !filterApplies(f.value)) return [];
    if (current === null) throw new ProgramError(`${el.element.address}: the effects lowering did not see this element's root first`);
    const planned = opacity > 0 ? current.plans.get(el.element.address) : undefined;
    if (planned?.kind === 'group' && planned.filter.length > 0) {
      facts['effects'] = { opacity, filter: planned.filter } satisfies EffectsFacts;
      return [{ kind: 'filter-group', opacity, filter: planned.filter, backdrop: planned.backdrop, painters: planned.painters }];
    }
    if (opacity === 1) return [];
    if (planned?.kind === 'nested') {
      facts['effects'] = { opacity } satisfies EffectsFacts;
      return [{ kind: 'opacity-nested', opacity }];
    }
    if (foldedOpacity(el) !== null) {
      if (box.kind !== 'box' || box.children.length > 0) throw new ProgramError(`${el.element.address}: a folded opacity group has content in its layout box`);
      return [];
    }
    const effects: EffectsFacts = { opacity };
    facts['effects'] = effects;
    if (planned?.kind === 'group') return [{ kind: 'opacity-group', opacity, backdrop: planned.backdrop, painters: planned.painters }];
    return [{ kind: 'opacity', opacity }];
  },
};
