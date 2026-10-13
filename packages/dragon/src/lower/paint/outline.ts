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

// Blink 145 Color::Dark and Color::Light (platform/graphics/color.cc:1138-1182) on a legacy sRGB colour, and
// CalculateInsetOutsetColor (core/paint/box_border_painter.cc:616-641) with color_utils::GetContrastRatio (ui/gfx/color_utils.cc
// :58-64, :392-413). Float steps use Math.fround.
const f32 = Math.fround;

/** QuantizeTo8Bit (color.cc:156-159) as the 8-bit channel it draws: the float times the largest float below 256, truncated. */
const quantize = (v: number): number => Math.trunc(f32(v * f32(256 - 2 ** -16)));

function scaled(c: Rgba8, multiplier: (v: number) => number): Rgba8 {
  const ch = [c.r, c.g, c.b].map((x) => f32(x / 255));
  const v = Math.max(...ch);
  const m = multiplier(v);
  const [r, g, b] = ch.map((x) => quantize(f32(x * m))) as [number, number, number];
  return { r, g, b, alpha: c.alpha };
}

/** Color::Dark: white is (171, 171, 171); otherwise each channel times max(0, (v - 0.33) / v) for v its largest channel. */
export function darkColor(c: Rgba8): Rgba8 {
  if (c.r === 255 && c.g === 255 && c.b === 255) return { r: 171, g: 171, b: 171, alpha: c.alpha };
  return scaled(c, (v) => (v === 0 ? 0 : Math.max(0, f32(f32(v - f32(0.33)) / v))));
}

/** Color::Light: black is (84, 84, 84); otherwise each channel times min(1, v + 0.33) / v. */
export function lightColor(c: Rgba8): Rgba8 {
  if (c.r === 0 && c.g === 0 && c.b === 0) return { r: 84, g: 84, b: 84, alpha: c.alpha };
  return scaled(c, (v) => f32(Math.min(1, f32(v + f32(0.33))) / v));
}

const linearize = (x: number): number => (x <= f32(0.04045) ? f32(x / f32(12.92)) : f32(Math.pow(f32(f32(x + f32(0.055)) / f32(1.055)), f32(2.4))));
const luminance = (c: Rgba8): number => {
  const [r, g, b] = [c.r, c.g, c.b].map((x) => linearize(f32(x / 255))) as [number, number, number];
  return f32(f32(f32(f32(0.2126) * r) + f32(f32(0.7152) * g)) + f32(f32(0.0722) * b));
};

/** GetContrastRatio of two colours' relative luminances. */
export function contrastRatio(a: Rgba8, b: Rgba8): number {
  const la = f32(luminance(a) + f32(0.05));
  const lb = f32(luminance(b) + f32(0.05));
  return la > lb ? f32(la / lb) : f32(lb / la);
}

/**
 * A 3D style's two colours (CalculateInsetOutsetColor): the darker is Color::Dark; the lighter is the colour itself, or Color::Light
 * when the colour is dark (red under 150 and green under 92) and contrasts with its darker colour by less than 1.75.
 */
export function insetOutsetTones(c: Rgba8): [Rgba8, Rgba8] {
  const dark = darkColor(c);
  const bright = f32(c.r / 255) >= f32(150 / 255) || f32(c.g / 255) >= f32(92 / 255);
  return [bright || contrastRatio(c, dark) >= f32(1.75) ? c : lightColor(c), dark];
}

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
    if (radii !== null && style.value !== 'solid' && style.value !== 'double') throw new ProgramError(`${address}: a rounded ${style.value} outline has no native paint technique`);
    return [{ kind: 'outline', style: style.value as OutlineStyle, width, offset, color, tones: THREE_D.includes(style.value) ? insetOutsetTones(color) : null, radii }];
  },
};
