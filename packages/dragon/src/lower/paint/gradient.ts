// Gradient background layers (BG2, notes/T074-bg2-spec.md): Dragon-owned paint. A box with at least one gradient layer gets one
// write holding its background colour, the colour's clip and every gradient layer (geometry and gradient, currentcolor resolved,
// each linear slope folded from the measured libm table, R3), top first, and the origin of the composited layer it rasters in
// (R4); the device rasterises them with the translated paint-gradient.ts at every layout. Nothing on the device parses CSS.
import type { BoxItem, GradientSpec, LayerGeometrySpec, Obscures } from '../../analysis/paint-values/gradient.ts';
import { gradientLayerOf, linearSlope, obscuresOf, resolvedLayers } from '../../analysis/paint-values/gradient.ts';
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import type { ColorLonghand, Longhand } from '../../css/properties.ts';
import { SIDES } from '../../css/properties.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

/** A colour stop with its colour resolved to 8-bit channels. */
export type LoweredStop = { readonly color: Rgba8; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number };
/** A gradient as the engine takes it: the slope folded (0 for every direction but an angle). */
export type LoweredGradient = Omit<GradientSpec, 'stops'> & { readonly slope: number; readonly stops: readonly LoweredStop[] };
/** A layer the native raster draws: its repeats are repeat or no-repeat (space and round are refused natively, BG2-t). */
export type LoweredLayer = { readonly geometry: LayerGeometrySpec & { readonly repeatX: 'repeat' | 'no-repeat'; readonly repeatY: 'repeat' | 'no-repeat' }; readonly gradient: LoweredGradient };

export type GradientWrite = {
  readonly kind: 'background-layers';
  /** The used background-color, composited under the layers inside the colour's clip. */
  readonly color: Rgba8;
  /** The bottom layer's background-clip, which clips the colour. */
  readonly colorClip: BoxItem;
  /** Whether each border side hides the background under it (top, right, bottom, left); 'double' decides on the device width. */
  readonly obscures: readonly Obscures[];
  /** The gradient layers, top first; layers whose image is none paint nothing and are left out. */
  readonly layers: readonly LoweredLayer[];
  /** Whether the last gradient layer is the box's bottom layer (Blink paints a bottom border-box layer on a fast path). */
  readonly lastIsBottom: boolean;
  /** The composited layer's origin in page device px (R4): the root scroller's is (0, 0). */
  readonly layerOrigin: readonly [number, number];
};

const repeat = (r: string, id: string): 'repeat' | 'no-repeat' => {
  if (r === 'repeat' || r === 'no-repeat') return r;
  throw new ProgramError(`${id}: background-repeat ${r} reached the native lowering, which refuses it (BG2-t)`);
};

export const GRADIENT_LOWERING: PaintLowering<GradientWrite> = {
  name: 'gradient',
  vocabulary: {
    uikit: { 'background-layers': { key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', detail: 'the translated paint-gradient.ts rasterises the colour and the gradient layers into one premultiplied device-pixel CGImage at every layout, drawn 1:1 with no interpolation in the background-layers stage, clipped to the rounded box' } },
    'android-views': { 'background-layers': { key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', detail: 'the translated paint-gradient.ts rasterises the colour and the gradient layers into one premultiplied device-pixel Bitmap (copyPixelsFromBuffer) at every layout, drawn 1:1 with a null Paint in the background-layers stage, clipped to the rounded box' } },
  },
  css: { 'background-layers': ['background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'] },
  lower: ({ el }) => {
    if (el === null) return [];
    const layers = resolvedLayers(el);
    if (!layers.some((l) => l.image.kind === 'gradient')) return [];
    const id = el.element.address;
    const colors = usedColors(el);
    const lowered: LoweredLayer[] = [];
    for (const l of layers) {
      if (l.image.kind !== 'gradient') continue;
      const g = l.image.gradient;
      const slope = !g.radial && g.direction === 'angle' ? linearSlope(g.angleDeg) : 0;
      if (slope === null) throw new ProgramError(`${id}: the angle ${g.angleDeg}deg is off the measured grid, which the native check refuses (BG2b)`);
      const stops = g.stops.map((s): LoweredStop => ({ color: s.color.kind === 'currentcolor' ? colors.color : s.color.value, unit: s.unit, value: s.value }));
      lowered.push({ geometry: { ...l.geometry, repeatX: repeat(l.geometry.repeatX, id), repeatY: repeat(l.geometry.repeatY, id) }, gradient: { ...g, slope, stops } });
    }
    const bottom = layers[layers.length - 1];
    if (bottom === undefined) throw new ProgramError(`${id}: background layers without a bottom layer`);
    const obscures = SIDES.map((side) => {
      const v = (el.props.get(`border-${side}-style` as Longhand) as ResolvedValue).value;
      return obscuresOf(v.kind === 'keyword' ? v.value : '', colors[`border-${side}-color` as ColorLonghand]);
    });
    if (gradientLayerOf(el).kind !== 'root') throw new ProgramError(`${id}: a gradient box in a composited layer the native check refuses (BG2c)`);
    return [{ kind: 'background-layers', color: colors['background-color'], colorClip: bottom.geometry.clip, obscures, layers: lowered, lastIsBottom: bottom.image.kind === 'gradient', layerOrigin: [0, 0] }];
  },
};
