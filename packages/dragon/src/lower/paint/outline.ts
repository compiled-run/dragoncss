// Outlines (css-ui-4 §3): Dragon drawing (T046 §1). An outline is one write with its style, the computed width and offset (css px
// at zoom 1), its colour, a 3D style's lighter and darker colours, and the box's radius lengths (the outline follows the border
// radius). The device paints it in a view of its own in the root view, after all the case's content, each box's descendants'
// outlines before its own: Chrome's outline phase of the root stacking context.
// analysis/paint-values/outline.ts refuses what that order cannot match without stacking (an overflow clip around the outline, a
// positioned or transformed box in the case), auto, and a rounded outline in a style other than solid or double. The device resolves
// the rings with the translated paint-radius.ts outlineRings at its scale, and draws a dotted, dashed or 3D outline with the
// translated paint-dash.ts outlinePaintOps. An outline that paints nothing (style none, a zero width, a transparent colour) has no
// write, nor has the outline of a box that is not visible (visibility hidden or collapse, own or inherited): Chrome paints no outline
// for it, while its visible descendants paint theirs. Visibility and outline are static writes only (emit/runtime/state.ts).
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import { insetOutsetTones } from '../../css/color.ts';
import { OUTLINE_LONGHANDS } from '../../css/properties/outline.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { colorChannels } from './colors.ts';
import type { RadiusLengthValue } from './radius.ts';
import { radiusLengths, roundsAnyCorner } from './radius.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type OutlineStyle = 'solid' | 'double' | 'dotted' | 'dashed' | 'groove' | 'ridge' | 'inset' | 'outset';

/** The outline styles the native targets draw: solid and double as rings, the others with Blink's side painter on square corners. */
export const NATIVE_OUTLINE_STYLES: readonly OutlineStyle[] = ['solid', 'double', 'dotted', 'dashed', 'groove', 'ridge', 'inset', 'outset'];
const THREE_D: readonly string[] = ['groove', 'ridge', 'inset', 'outset'];

export type OutlineWrite = {
  readonly kind: 'outline';
  readonly style: OutlineStyle;
  /** css px at zoom 1. */
  readonly width: number;
  readonly offset: number;
  readonly color: Rgba8;
  /** A 3D style's lighter and darker colours (insetOutsetTones), or null for the other styles. */
  readonly tones: readonly [Rgba8, Rgba8] | null;
  /** The eight radius components of the box, or null for square corners. */
  readonly radii: readonly RadiusLengthValue[] | null;
};

const OUTLINE_PAINT = "Dragon draws an outline in a view of its own in the root view, after the case's content, a box's descendants' outlines before its own (the root stacking context's outline phase); its rings come from the translated paint-radius.ts outlineRings: Blink 145's snapped width and truncated offset, the radii outset, double bands of round(width / 3). A dotted, dashed, groove, ridge, inset or outset outline (square corners only) is drawn around the ring's outer rect by Blink's side painter (translated paint-dash.ts outlinePaintOps), a 3D style in its lighter and darker colours";

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
    const visibility = el.props.get('visibility');
    if (visibility === undefined) throw new ProgramError(`${address}: visibility did not resolve`);
    if (!paintsOwn(visibilityOf(visibility.value))) return [];
    const style = el.props.get('outline-style')?.value;
    if (style === undefined || style.kind !== 'keyword') throw new ProgramError(`${address}: outline-style did not resolve`);
    if (style.value === 'none') return [];
    const width = px(el.props.get('outline-width'), 'outline-width', address);
    if (width <= 0) return [];
    // analysis/paint-values/outline.ts refuses auto on the native targets, so it never reaches a program.
    if (!(NATIVE_OUTLINE_STYLES as readonly string[]).includes(style.value)) return [];
    const offset = px(el.props.get('outline-offset'), 'outline-offset', address);
    const c = el.props.get('outline-color');
    const own = el.props.get('color');
    if (c === undefined || own === undefined) throw new ProgramError(`${address}: outline-color did not resolve`);
    const color = c.value.kind === 'keyword' && c.value.value === 'currentcolor' ? colorChannels(own.value, address) : colorChannels(c.value, address);
    if (color.alpha === 0) return [];
    const lengths = radiusLengths(el.props, address);
    const radii = roundsAnyCorner(lengths) ? lengths : null;
    // The side painter styles: a corner with either component positive is rounded for Blink (Radii::IsZero is both zero), and
    // analysis/paint-values/outline.ts refuses it.
    if (style.value !== 'solid' && style.value !== 'double' && lengths.some((l) => l.value > 0)) throw new ProgramError(`${address}: a rounded ${style.value} outline has no native paint technique`);
    return [{ kind: 'outline', style: style.value as OutlineStyle, width, offset, color, tones: THREE_D.includes(style.value) ? insetOutsetTones(color) : null, radii }];
  },
};
