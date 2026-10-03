// Outlines (css-ui-4 §3): Dragon drawing (T046 §1). A solid or double outline is one write with the computed width and offset (css
// px at zoom 1) and colour, the box's radius lengths (the outline follows the border radius), and where it paints: in the view of
// the box's paint root (the root, a layer item or a flex item) or of the nearest clip between (lower/paint/stacking.ts
// outlinePlacement), sorted there after the flow children and the foreground and before the layer items, in tree order, as Blink
// paints a layer's outlines after its foreground and a flex item's in its atomic outline phase. The device resolves
// the rings with the translated paint-radius.ts outlineRings at its scale. Other styles and auto are refused on the native targets
// (analysis/paint-values/outline.ts); an outline that paints nothing has no write.
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import type { RadiusLengthValue } from './radius.ts';
import { radiusLengths, roundsAnyCorner } from './radius.ts';
import { outlinePlacement } from './stacking.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';
import { colorChannels } from './colors.ts';

export type OutlineStyle = 'solid' | 'double';

export type OutlineWrite = {
  readonly kind: 'outline';
  readonly style: OutlineStyle;
  /** css px at zoom 1. */
  readonly width: number;
  readonly offset: number;
  readonly color: Rgba8;
  /** The eight radius components of the box, or null for square corners. */
  readonly radii: readonly RadiusLengthValue[] | null;
  /** The node whose view the outline paints in (the box itself, its paint root, or a clip between), and its tree index. */
  readonly host: string;
  readonly rank: number;
};

/** The outline facts of a node (rt-hit.ts reads them): the write's values and its paint layer. */
export type OutlineFacts = { readonly style: OutlineStyle; readonly width: number; readonly offset: number; readonly host: string; readonly layer: string };

const OUTLINE_PAINT = "Dragon draws a solid or double outline in a view of its own outside the border box, in the paint root's view after the flow children and the foreground (the rings from the translated paint-radius.ts outlineRings: Blink 145's snapped width and truncated offset, the radii outset, double bands of round(width / 3))";

const px = (v: ResolvedValue | undefined, what: string, address: string): number => {
  if (v === undefined || v.value.kind !== 'length' || v.value.unit !== 'px') throw new ProgramError(`${address}: ${what} did not compute to px`);
  return v.value.value;
};

export const OUTLINE_LOWERING: PaintLowering<OutlineWrite> = {
  name: 'outline',
  vocabulary: {
    uikit: { outline: { key: 'dragonOutline.rings', technique: 'dragon-owned-paint', detail: `DragonOutlineView [host id, then per ring the outer and inner rect in device px from the root]. ${OUTLINE_PAINT}` } },
    'android-views': { outline: { key: 'dragonOutline.rings', technique: 'dragon-owned-paint', detail: `DragonOutlineView [host id, then per ring the outer and inner rect in device px from the root]. ${OUTLINE_PAINT}` } },
  },
  css: { outline: ['outline-color', 'outline-style', 'outline-width', 'outline-offset'] },
  // An anonymous box takes the initial outline (CSS2 §9.2.1.1): none, so no write.
  lower: ({ el, facts }) => {
    if (el === null) return [];
    const address = el.element.address;
    const style = el.props.get('outline-style')?.value;
    if (style === undefined || style.kind !== 'keyword') throw new ProgramError(`${address}: outline-style did not resolve`);
    if (style.value !== 'solid' && style.value !== 'double') return [];
    const width = px(el.props.get('outline-width'), 'outline-width', address);
    if (width <= 0) return [];
    const offset = px(el.props.get('outline-offset'), 'outline-offset', address);
    const c = el.props.get('outline-color');
    const own = el.props.get('color');
    if (c === undefined || own === undefined) throw new ProgramError(`${address}: outline-color did not resolve`);
    const color = c.value.kind === 'keyword' && c.value.value === 'currentcolor' ? colorChannels(own.value, address) : colorChannels(c.value, address);
    if (color.alpha === 0) return [];
    const lengths = radiusLengths(el.props, address);
    const place = outlinePlacement(address);
    const outline: OutlineFacts = { style: style.value, width, offset, host: place.host, layer: place.layer };
    facts['outline'] = outline;
    return [{ kind: 'outline', style: style.value, width, offset, color, radii: roundsAnyCorner(lengths) ? lengths : null, host: place.host, rank: place.rank }];
  },
};
