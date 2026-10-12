// box-shadow (css-backgrounds-3 §7.1): Dragon drawing (T046 §1). The write carries the computed shadows (css px at zoom 1, sRGB
// RGBA8 colours, inset flags) in list order; the device rasters them with the translated paint-shadow.ts after every layout: the
// outer shadows into a companion view directly beneath the box (the same host, so the paint order is CSS's), clipped out of the
// border box, and the inset shadows into the box's inset-shadow stage, clipped to the padding box. A box with no shadow has no write.
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import type { Shadow } from '../../css/properties/shadow.ts';
import { shadowsOf } from '../../css/properties/shadow.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

/** One computed shadow: css px lengths at zoom 1, an sRGB RGBA8 colour and the inset flag. */
export type ShadowValue = { readonly inset: boolean; readonly x: number; readonly y: number; readonly blur: number; readonly spread: number; readonly color: Rgba8 };

/** The shadow facts of a node (rt-hit.ts reads them): the computed shadows in list order. */
export type ShadowFacts = { readonly shadows: readonly ShadowValue[] };

export type ShadowWrite = { readonly kind: 'box-shadow'; readonly shadows: readonly ShadowValue[] };

const SHADOW_PAINT = 'Dragon rasters every shadow with the translated paint-shadow.ts (Blink 145 shadow shapes, Skia 2ab8add5 blur paths and its A8 colour blit) after every layout; the outer shadows are a premultiplied bitmap in a companion view beneath the box, clipped out of the border box, and the inset shadows are drawn at the inset-shadow stage, clipped to the padding box';

function px(l: Shadow['x'], address: string): number {
  if (l.unit !== 'px') throw new ProgramError(`${address}: a box-shadow length did not compute to px (${l.value}${l.unit})`);
  return l.value;
}

/** The computed shadows of an element (none gives an empty list). */
export function shadowValues(props: ReadonlyMap<string, ResolvedValue>, address: string): ShadowValue[] {
  const v = props.get('box-shadow');
  if (v === undefined) throw new ProgramError(`${address}: box-shadow did not resolve`);
  const shadows = shadowsOf(v.value);
  if (shadows === null) throw new ProgramError(`${address}: box-shadow is not a shadow list (${v.value.kind})`);
  return shadows.map((s) => {
    if (s.color === 'currentcolor') throw new ProgramError(`${address}: a box-shadow colour did not compute (currentcolor)`);
    return { inset: s.inset, x: px(s.x, address), y: px(s.y, address), blur: px(s.blur, address), spread: px(s.spread, address), color: s.color };
  });
}

export const SHADOW_LOWERING: PaintLowering<ShadowWrite> = {
  name: 'shadow',
  vocabulary: {
    uikit: { 'box-shadow': { key: 'dragonShadow.shadows', technique: 'dragon-owned-paint', detail: `DragonBoxView shadows in list order: [inset, x, y, blur, spread] in css px and the colour as sRGB RGBA8. ${SHADOW_PAINT}` } },
    'android-views': { 'box-shadow': { key: 'dragonShadow.shadows', technique: 'dragon-owned-paint', detail: `DragonBoxView shadows in list order: [inset, x, y, blur, spread] in css px and the colour as sRGB RGBA8. ${SHADOW_PAINT}` } },
  },
  css: { 'box-shadow': ['box-shadow'] },
  // An anonymous box takes the initial box-shadow (CSS2 §9.2.1.1): none, so no write.
  lower: ({ el, facts }) => {
    if (el === null) return [];
    const shadows = shadowValues(el.props, el.element.address);
    if (shadows.length === 0) return [];
    const shadow: ShadowFacts = { shadows };
    facts['shadow'] = shadow;
    return [{ kind: 'box-shadow', shadows }];
  },
};
