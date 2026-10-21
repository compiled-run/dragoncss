// The four border sides: Dragon-owned paint. Widths come from the engine at the device scale; styles and colours are lowered here.
import type { Rgba8 } from '../../css/color.ts';
import type { ColorLonghand, Longhand } from '../../css/properties.ts';
import { SIDES } from '../../css/properties.ts';
import type { ResolvedElement, ResolvedValue } from '../../analysis/resolve.ts';
import { borderImageGradient, borderImageOf, borderImageRefusal } from '../../analysis/paint-values/border-image.ts';
import { compositesSubtree, linearSlope } from '../../analysis/paint-values/gradient.ts';
import type { RepeatKeyword } from '../../css/properties/border-image.ts';
import { BORDER_IMAGE_LONGHANDS } from '../../css/properties/border-image.ts';
import { usedColors } from './colors.ts';
import type { LoweredGradient, LoweredStop } from './gradient.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type BorderStyleName = 'none' | 'hidden' | 'solid' | 'dotted' | 'dashed' | 'double';
export type Sides<T> = readonly [T, T, T, T];

export type BorderWrite =
  /** Border widths as the engine resolves them at the device scale (box.ts resolveBorder of the zoomed style). */
  | { readonly kind: 'border-widths' }
  | { readonly kind: 'border-styles'; readonly styles: Sides<BorderStyleName> }
  | { readonly kind: 'border-colors'; readonly colors: Sides<Rgba8> }
  | BorderImageWrite;

/**
 * MISC-PAINT: a gradient border image, its pieces stretched or tiled by border-image-repeat (analysis/border-image.ts and
 * paint-values/border-image-tiling.ts admit only what the native raster draws exactly). The device plans
 * it at every layout with the translated paint-gradient.ts planBorderImage on the engine's border box and device-px borders, and
 * draws its raster in place of the border styles in the border stage (emit/paint/border-image.ts).
 */
export type BorderImageWrite = {
  readonly kind: 'border-image';
  readonly gradient: LoweredGradient;
  /** Top, right, bottom, left. */
  readonly slices: Sides<{ readonly unit: 'number' | 'percent'; readonly value: number }>;
  readonly fill: boolean;
  readonly widths: Sides<{ readonly unit: 'number' | 'px' | 'auto'; readonly value: number }>;
  /** The composited layer's origin in page device px: the root scroller's (0, 0) (compositesSubtree is refused natively). */
  readonly layerOrigin: readonly [number, number];
  /** border-image-repeat, horizontal then vertical (MISC-PAINT part 2; a tiled piece is proven whole device px by border-image-tiling.ts). */
  readonly repeat: readonly [RepeatKeyword, RepeatKeyword];
};

const BORDER_PAINT = 'Dragon draws each side as a band of its width: solid fills it; double draws two bands of a third of the width. A box with a visible dashed or dotted side is drawn as Blink 145 draws it in device px (translated paint-dash.ts): sides in Blink\'s paint order with its corner miters; dashes of 3 (under 3 device px thick) or 2 times the thickness with the gap fitted so a dash ends each side; dotted sides of 3 device px or less as square dots with whole end dots; thicker dotted sides as round dots with a fitted gap';

const BORDER_IMAGE_PAINT = 'the translated paint-gradient.ts plans Chrome 145\'s nine pieces (NinePieceImageGrid on the border box at the device scale, each piece stretched by GradientGeneratedImage::Draw or, under border-image-repeat, tiled 1:1 through the paint-record shader GeneratedImage::DrawPattern makes) and rasterises them into one premultiplied device-pixel image at every layout, drawn 1:1 with no interpolation in the border stage in place of the border styles';

const BORDER_STYLES: readonly BorderStyleName[] = ['none', 'hidden', 'solid', 'dotted', 'dashed', 'double'];

export const BORDER_LOWERING: PaintLowering<BorderWrite> = {
  name: 'border',
  vocabulary: {
    uikit: {
      'border-widths': { key: 'dragonBorder.widths', technique: 'dragon-owned-paint', detail: `DragonBoxView side widths in points (device px / scale). ${BORDER_PAINT}` },
      'border-styles': { key: 'dragonBorder.styles', technique: 'dragon-owned-paint', detail: `DragonBoxView side styles. ${BORDER_PAINT}` },
      'border-colors': { key: 'dragonBorder.colors', technique: 'dragon-owned-paint', detail: `DragonBoxView side colours (sRGB RGBA8). ${BORDER_PAINT}` },
      'border-image': { key: 'dragonBorderImage', technique: 'dragon-owned-paint', detail: `DragonBoxView CGImage: ${BORDER_IMAGE_PAINT}` },
    },
    'android-views': {
      'border-widths': { key: 'dragonBorder.widthsPx', technique: 'dragon-owned-paint', detail: `DragonBoxView side widths in whole device px. ${BORDER_PAINT}` },
      'border-styles': { key: 'dragonBorder.styles', technique: 'dragon-owned-paint', detail: `DragonBoxView side styles. ${BORDER_PAINT}` },
      'border-colors': { key: 'dragonBorder.colors', technique: 'dragon-owned-paint', detail: `DragonBoxView side colours (sRGB RGBA8). ${BORDER_PAINT}` },
      'border-image': { key: 'dragonBorderImage', technique: 'dragon-owned-paint', detail: `DragonBoxView Bitmap (copyPixelsFromBuffer): ${BORDER_IMAGE_PAINT}` },
    },
  },
  css: {
    'border-widths': SIDES.map((s) => `border-${s}-width` as Longhand),
    'border-styles': SIDES.map((s) => `border-${s}-style` as Longhand),
    'border-colors': SIDES.map((s) => `border-${s}-color` as Longhand),
    'border-image': [...BORDER_IMAGE_LONGHANDS],
  },
  // An anonymous box has no border and currentcolor borders of its enclosing element's color (CSS2 §9.2.1.1).
  lower: ({ box, el, parentColor, propagated }) => {
    const image = el === null ? null : borderImageWrite(box.id, el, propagated ?? null);
    return image === null ? borderWrites(box.id, el, parentColor) : [...borderWrites(box.id, el, parentColor), image];
  },
};

/**
 * A box's border image write, or null when its source is none; a border image the checks refuse here is a compiler fault.
 * propagated is the element whose overflow the viewport takes, which is no composited scroll container (paint-values/border.ts).
 */
export function borderImageWrite(id: string, el: ResolvedElement, propagated: ResolvedElement | null = null): BorderImageWrite | null {
  const parts = borderImageOf(el);
  if (parts === null) return null;
  const why = borderImageRefusal(el);
  if (why !== null) throw new ProgramError(`${id}: a border image every target refuses reached the native lowering (${why.at}: ${why.reason})`);
  if (compositesSubtree(el, propagated)) throw new ProgramError(`${id}: a border image in a composited layer the native check refuses (MISC-PAINT)`);
  const g = borderImageGradient(parts.source as NonNullable<typeof parts.source>);
  if (g === null) throw new ProgramError(`${id}: a border image source that is not a linear gradient reached the native lowering`);
  const slope = g.direction === 'angle' ? linearSlope(g.angleDeg) : 0;
  if (slope === null) throw new ProgramError(`${id}: the angle ${g.angleDeg}deg is off the measured grid, which the check refuses (MISC-PAINT)`);
  const stops = g.stops.map((s): LoweredStop => {
    if (s.color.kind !== 'rgba') throw new ProgramError(`${id}: a currentcolor border image stop reached the native lowering`);
    return { color: s.color.value, unit: s.unit, value: s.value };
  });
  const widths = parts.widths.map((w) => {
    if (w.unit === 'number' || w.unit === 'auto') return { unit: w.unit, value: w.value };
    if (w.unit === 'length' && w.lengthUnit === 'px') return { unit: 'px' as const, value: w.value };
    throw new ProgramError(`${id}: a border image width in ${w.unit === 'length' ? w.lengthUnit : '%'} reached the native lowering`);
  });
  return {
    kind: 'border-image',
    gradient: { ...g, slope, stops },
    slices: parts.slices.map((s) => ({ unit: s.unit, value: s.value })) as unknown as BorderImageWrite['slices'],
    fill: parts.fill,
    widths: widths as unknown as BorderImageWrite['widths'],
    layerOrigin: [0, 0],
    repeat: [parts.repeat[0], parts.repeat[1]],
  };
}

/** A node's border writes: its side styles and used colours (an anonymous box's are none and its enclosing element's color). */
export function borderWrites(id: string, el: ResolvedElement | null, parentColor: Rgba8): BorderWrite[] {
  const colors = el === null ? null : usedColors(el);
  const style = (side: string): BorderStyleName => {
    if (el === null) return 'none';
    const v = (el.props.get(`border-${side}-style` as Longhand) as ResolvedValue).value;
    const k = v.kind === 'keyword' ? v.value : '';
    if (!(BORDER_STYLES as readonly string[]).includes(k)) throw new ProgramError(`${id}: border-${side}-style ${k} has no native paint technique`);
    return k as BorderStyleName;
  };
  const sideColor = (side: string): Rgba8 => (colors === null ? parentColor : colors[`border-${side}-color` as ColorLonghand]);
  return [
    { kind: 'border-widths' },
    { kind: 'border-styles', styles: SIDES.map(style) as unknown as Sides<BorderStyleName> },
    { kind: 'border-colors', colors: SIDES.map(sideColor) as unknown as Sides<Rgba8> },
  ];
}
