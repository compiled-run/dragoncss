// Gradient background layers (BG2): Dragon-owned paint. A box with at least one gradient layer gets one write holding its
// background colour, the colour's clip and every gradient layer (geometry and gradient, currentcolor resolved), top first;
// the device rasterises them with the translated paint-gradient.ts at every layout (notes/T046-paint-spec.md §1).
import type { BoxItem, GradientSpec, LayerGeometrySpec, Obscures } from '../../analysis/paint-values/gradient.ts';
import { obscuresOf, resolvedLayers } from '../../analysis/paint-values/gradient.ts';
import type { ColorLonghand, Longhand } from '../../css/properties.ts';
import { SIDES } from '../../css/properties.ts';
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

/** A colour stop with its colour resolved to 8-bit channels. */
export type LoweredStop = { readonly color: Rgba8; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number };
export type LoweredGradient = Omit<GradientSpec, 'stops'> & { readonly stops: readonly LoweredStop[] };
export type LoweredLayer = { readonly geometry: LayerGeometrySpec; readonly gradient: LoweredGradient };

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
};

export const GRADIENT_LOWERING: PaintLowering<GradientWrite> = {
  name: 'gradient',
  vocabulary: {
    uikit: { 'background-layers': { key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', detail: 'the translated paint-gradient.ts rasterises the colour and the gradient layers into one device-pixel bitmap at every layout, drawn in the background-layers stage over the native background colour' } },
    'android-views': { 'background-layers': { key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', detail: 'the translated paint-gradient.ts rasterises the colour and the gradient layers into one device-pixel Bitmap at every layout, drawn in the background-layers stage over the native background colour' } },
  },
  css: { 'background-layers': ['background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'] },
  lower: ({ el }) => {
    if (el === null) return [];
    const layers = resolvedLayers(el);
    if (!layers.some((l) => l.image.kind === 'gradient')) return [];
    const colors = usedColors(el);
    const lowered: LoweredLayer[] = [];
    for (const l of layers) {
      if (l.image.kind !== 'gradient') continue;
      const g = l.image.gradient;
      const stops = g.stops.map((s): LoweredStop => ({ color: s.color.kind === 'currentcolor' ? colors.color : s.color.value, unit: s.unit, value: s.value }));
      lowered.push({ geometry: l.geometry, gradient: { ...g, stops } });
    }
    const bottom = layers[layers.length - 1];
    if (bottom === undefined) throw new ProgramError(`${el.element.address}: background layers without a bottom layer`);
    const obscures = SIDES.map((side) => {
      const v = (el.props.get(`border-${side}-style` as Longhand) as ResolvedValue).value;
      return obscuresOf(v.kind === 'keyword' ? v.value : '', colors[`border-${side}-color` as ColorLonghand]);
    });
    return [{ kind: 'background-layers', color: colors['background-color'], colorClip: bottom.geometry.clip, obscures, layers: lowered, lastIsBottom: bottom.image.kind === 'gradient' }];
  },
};
