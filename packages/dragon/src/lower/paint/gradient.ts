// Gradient background layers (BG2, notes/T074-bg2-spec.md): Dragon-owned paint. A box with at least one gradient layer gets one
// write holding its background colour, the colour's clip and every gradient layer (geometry and gradient, currentcolor resolved,
// each linear slope folded from the measured libm table, R3), top first, and the origin of the composited layer it rasters in
// (R4); the device rasterises them with the translated paint-gradient.ts at every layout. Nothing on the device parses CSS. A box
// whose one layer is a url() image gets a background-image write instead (BG2-u, bg-image.ts).
// A box with a gradient mask (MASK-CLIP, analysis/mask.ts) gets one mask-layer write: the gradient as one border-box layer at
// size auto that repeats, as Chrome paints the mask's fill layer, rasterised over transparent; the device masks the box view
// with the raster's alpha.
import type { BoxItem, GradientSpec, LayerGeometrySpec, Obscures } from '../../analysis/paint-values/gradient.ts';
import { bleedAvoidanceOf, compositesSubtree, linearSlope, obscuresOf, resolvedLayers } from '../../analysis/paint-values/gradient.ts';
import type { ResolvedElement, ResolvedValue } from '../../analysis/resolve.ts';
import { elementMaskGradient } from '../../analysis/mask.ts';
import type { Rgba8 } from '../../css/color.ts';
import type { ColorLonghand, Longhand } from '../../css/properties.ts';
import { SIDES } from '../../css/properties.ts';
import { usedColors } from './colors.ts';
import type { BackgroundImageWrite } from './bg-image.ts';
import { lowerUrlLayer } from './bg-image.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

/** A colour stop with its colour resolved to 8-bit channels. */
export type LoweredStop = { readonly color: Rgba8; readonly unit: 'auto' | 'percent' | 'px'; readonly value: number };
/** A gradient as the engine takes it: the slope folded (0 for every direction but an angle). */
export type LoweredGradient = Omit<GradientSpec, 'stops'> & { readonly slope: number; readonly stops: readonly LoweredStop[] };
/** A layer the native raster draws: its repeats are repeat or no-repeat (space and round are refused natively, BG2-t). */
export type LoweredLayer = { readonly geometry: LayerGeometrySpec & { readonly repeatX: 'repeat' | 'no-repeat'; readonly repeatY: 'repeat' | 'no-repeat' }; readonly gradient: LoweredGradient };

export type BackgroundLayersWrite = {
  readonly kind: 'background-layers';
  /** The used background-color, composited under the layers inside the colour's clip. */
  readonly color: Rgba8;
  /** The bottom layer's background-clip, which clips the colour. */
  readonly colorClip: BoxItem;
  /** Whether each border side hides the background under it (top, right, bottom, left); 'double' decides on the device width. */
  readonly obscures: readonly Obscures[];
  /** The gradient layers, top first; layers whose image is none paint nothing and are left out. */
  readonly layers: readonly LoweredLayer[];
  /**
   * Whether the last gradient layer is the box's bottom layer and Blink may paint it on PaintFastBottomLayer: not when the box
   * shrinks its background for bleed avoidance (CanUseBottomLayerFastPath; bleedAvoidanceOf 'shrink').
   */
  readonly lastIsBottom: boolean;
  /** The composited layer's origin in page device px (R4): the root scroller's is (0, 0). */
  readonly layerOrigin: readonly [number, number];
};

/** A gradient mask (MASK-CLIP): its one layer, and the origin of the composited layer it rasters in (R4), as background-layers'. */
export type MaskLayerWrite = { readonly kind: 'mask-layer'; readonly layer: LoweredLayer; readonly layerOrigin: readonly [number, number] };

export type GradientWrite = BackgroundLayersWrite | MaskLayerWrite;

/** The mask's fill layer with every mask longhand but mask-image initial: size auto, position 0% 0%, repeat, border-box. */
const MASK_GEOMETRY: LoweredLayer['geometry'] = {
  sizeKind: 'length', sizeX: { unit: 'auto', value: 0 }, sizeY: { unit: 'auto', value: 0 }, positionX: { unit: 'percent', value: 0 }, positionY: { unit: 'percent', value: 0 },
  repeatX: 'repeat', repeatY: 'repeat', origin: 'border-box', clip: 'border-box',
};

/** A gradient as the engine takes it, with currentcolor resolved and the slope folded (R3). */
function lowerGradient(g: GradientSpec, current: Rgba8, id: string): LoweredGradient {
  const slope = !g.radial && g.direction === 'angle' ? linearSlope(g.angleDeg) : 0;
  if (slope === null) throw new ProgramError(`${id}: the angle ${g.angleDeg}deg is off the measured grid, which the native check refuses (BG2b)`);
  const stops = g.stops.map((s): LoweredStop => ({ color: s.color.kind === 'currentcolor' ? current : s.color.value, unit: s.unit, value: s.value }));
  return { ...g, slope, stops };
}

/** The mask-layer write of a box with a gradient mask, or none. */
function lowerMask(el: ResolvedElement): MaskLayerWrite[] {
  const g = elementMaskGradient(el);
  if (g === null) return [];
  const id = el.element.address;
  if (compositesSubtree(el)) throw new ProgramError(`${id}: a gradient mask in a composited layer the native check refuses (MASK-CLIP)`);
  return [{ kind: 'mask-layer', layer: { geometry: MASK_GEOMETRY, gradient: lowerGradient(g, usedColors(el).color, id) }, layerOrigin: [0, 0] }];
}

const repeat = (r: string, id: string): 'repeat' | 'no-repeat' => {
  if (r === 'repeat' || r === 'no-repeat') return r;
  throw new ProgramError(`${id}: background-repeat ${r} reached the native lowering, which refuses it (BG2-t)`);
};

const IMAGE_TILES = 'the PNG decoded once at build (sRGB); after every layout the tile is placed in its background-origin box at its natural size times the device scale, by its px or % position (a no-repeat axis at a whole device px), and';

export const GRADIENT_LOWERING: PaintLowering<GradientWrite | BackgroundImageWrite> = {
  name: 'gradient',
  vocabulary: {
    uikit: {
      'background-layers': { key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', detail: 'the translated paint-gradient.ts rasterises the colour and the gradient layers into one premultiplied device-pixel CGImage at every layout, drawn 1:1 with no interpolation in the background-layers stage, clipped to the rounded box' },
      'mask-layer': { key: 'dragonMaskLayer', technique: 'dragon-owned-paint', detail: "the translated paint-gradient.ts rasterises the mask's layer into premultiplied device-pixel CGImage strips at every layout, the contents of the view layer's mask (nearest filtering, contentsScale the device scale), so the box and every view inside it keep the raster's alpha" },
      'background-image': { key: 'dragonBackgroundImage', technique: 'dragon-owned-paint', detail: `DragonBoxView CGImage: ${IMAGE_TILES} drawn with UIImage.draw(in:) once per tile that meets the background-clip box, without antialiasing, in the background-layers stage, clipped to that box and the rounded border box` },
    },
    'android-views': {
      'background-layers': { key: 'dragonBackgroundLayers', technique: 'dragon-owned-paint', detail: 'the translated paint-gradient.ts rasterises the colour and the gradient layers into one premultiplied device-pixel Bitmap (copyPixelsFromBuffer) at every layout, drawn 1:1 with a null Paint in the background-layers stage, clipped to the rounded box' },
      'mask-layer': { key: 'dragonMaskLayer', technique: 'dragon-owned-paint', detail: "the translated paint-gradient.ts rasterises the mask's layer into premultiplied device-pixel Bitmaps at every layout; the view's draw runs in a saveLayer clipped to the raster, and the Bitmaps are drawn over it 1:1 with PorterDuff DST_IN, so the box and every view inside it keep the raster's alpha" },
      'background-image': { key: 'dragonBackgroundImage', technique: 'dragon-owned-paint', detail: `DragonBoxView Bitmap: ${IMAGE_TILES} drawn as a BitmapShader (REPEAT on a repeating axis, CLAMP on the other, Paint(FILTER_BITMAP_FLAG)) over the background-clip box, narrowed to the tile on a no-repeat axis, in the background-layers stage, clipped to the rounded border box` },
    },
  },
  css: {
    'background-layers': ['background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
    'mask-layer': ['mask-image'],
    'background-image': ['background-image', 'background-position-x', 'background-position-y', 'background-size', 'background-repeat', 'background-attachment', 'background-origin', 'background-clip'],
  },
  lower: ({ el, images, transformMoves }) => {
    if (el === null) return [];
    const layers = resolvedLayers(el);
    const id = el.element.address;
    if (layers.some((l) => l.image.kind === 'url')) return [lowerUrlLayer(id, layers, images, transformMoves), ...lowerMask(el)];
    if (!layers.some((l) => l.image.kind === 'gradient')) return lowerMask(el);
    if (layers.some((l) => l.clipsToText === true)) throw new ProgramError(`${id}: a gradient box clips a layer to text, which every target refuses (background-clip-text.ts)`);
    const colors = usedColors(el);
    const masks = lowerMask(el);
    const lowered: LoweredLayer[] = [];
    for (const l of layers) {
      if (l.image.kind !== 'gradient') continue;
      lowered.push({ geometry: { ...l.geometry, repeatX: repeat(l.geometry.repeatX, id), repeatY: repeat(l.geometry.repeatY, id) }, gradient: lowerGradient(l.image.gradient, colors.color, id) });
    }
    const bottom = layers[layers.length - 1];
    if (bottom === undefined) throw new ProgramError(`${id}: background layers without a bottom layer`);
    const obscures = SIDES.map((side) => {
      const v = (el.props.get(`border-${side}-style` as Longhand) as ResolvedValue).value;
      return obscuresOf(v.kind === 'keyword' ? v.value : '', colors[`border-${side}-color` as ColorLonghand]);
    });
    if (compositesSubtree(el)) throw new ProgramError(`${id}: a gradient box in a composited layer the native check refuses (BG2c)`);
    const bleed = bleedAvoidanceOf(el);
    if (bleed === 'layer') throw new ProgramError(`${id}: a rounded box whose background Chrome paints into a bleed-avoidance layer, which the native check refuses (BG2c)`);
    return [{ kind: 'background-layers', color: colors['background-color'], colorClip: bottom.geometry.clip, obscures, layers: lowered, lastIsBottom: bottom.image.kind === 'gradient' && bleed !== 'shrink', layerOrigin: [0, 0] }, ...masks];
  },
};
