// Outlines (css-ui-4 §3): Dragon drawing (T046 §1). A solid or double outline is one write with the computed width and offset (css
// px at zoom 1), its colour and the box's radius lengths (the outline follows the border radius). The device paints it in a view of
// its own in the root view, after all the case's content and in tree order: Chrome's outline phase of the root stacking context.
// analysis/paint-values/outline.ts refuses what that order cannot match without stacking (an overflow clip around the outline, a
// positioned or transformed box in the case), and every other style. The device resolves the rings with the translated
// paint-radius.ts outlineRings at its scale. An outline that paints nothing (style none, a zero width, a transparent colour) has no
// write.
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import { OUTLINE_LONGHANDS } from '../../css/properties/outline.ts';
import { colorChannels } from './colors.ts';
import type { RadiusLengthValue } from './radius.ts';
import { radiusLengths, roundsAnyCorner } from './radius.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

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
};

const OUTLINE_PAINT = "Dragon draws a solid or double outline in a view of its own in the root view, after the case's content and in tree order (the root stacking context's outline phase); its rings come from the translated paint-radius.ts outlineRings: Blink 145's snapped width and truncated offset, the radii outset, double bands of round(width / 3)";

const px = (v: ResolvedValue | undefined, what: string, address: string): number => {
  if (v === undefined || v.value.kind !== 'length' || v.value.unit !== 'px' || !Number.isFinite(v.value.value)) throw new ProgramError(`${address}: ${what} did not compute to px`);
  return v.value.value;
};

export const OUTLINE_LOWERING: PaintLowering<OutlineWrite> = {
  name: 'outline',
  vocabulary: {
    uikit: { outline: { key: 'dragonOutline.rings', technique: 'dragon-owned-paint', detail: `DragonOutlineView [per ring the outer and inner rect in device px from the root]. ${OUTLINE_PAINT}` } },
    'android-views': { outline: { key: 'dragonOutline.rings', technique: 'dragon-owned-paint', detail: `DragonOutlineView [per ring the outer and inner rect in device px from the root]. ${OUTLINE_PAINT}` } },
  },
  css: { outline: [...OUTLINE_LONGHANDS] },
  // An anonymous box takes the initial outline (CSS2 §9.2.1.1): none, so no write.
  lower: ({ el }) => {
    if (el === null) return [];
    const address = el.element.address;
    const style = el.props.get('outline-style')?.value;
    if (style === undefined || style.kind !== 'keyword') throw new ProgramError(`${address}: outline-style did not resolve`);
    if (style.value === 'none') return [];
    const width = px(el.props.get('outline-width'), 'outline-width', address);
    if (width <= 0) return [];
    // analysis/paint-values/outline.ts refuses every other painting style on the native targets, so it never reaches a program.
    if (style.value !== 'solid' && style.value !== 'double') return [];
    const offset = px(el.props.get('outline-offset'), 'outline-offset', address);
    const c = el.props.get('outline-color');
    const own = el.props.get('color');
    if (c === undefined || own === undefined) throw new ProgramError(`${address}: outline-color did not resolve`);
    const color = c.value.kind === 'keyword' && c.value.value === 'currentcolor' ? colorChannels(own.value, address) : colorChannels(c.value, address);
    if (color.alpha === 0) return [];
    const lengths = radiusLengths(el.props, address);
    return [{ kind: 'outline', style: style.value, width, offset, color, radii: roundsAnyCorner(lengths) ? lengths : null }];
  },
};
