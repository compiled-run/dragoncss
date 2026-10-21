// BG2-u part 2 (notes/T074-bg2-spec.md R10): a url() background layer is Dragon-owned paint. The lowering embeds the PNG bytes the
// build read (images/compile.ts) with the layer's geometry; after every layout the device places the tile in its origin box at its
// natural size times the device scale, by its px or % position, and draws it on each repeating axis over the clip box
// (emit/paint/bg-image.ts). The every-target check admits one url() layer at size auto, repeat or no-repeat per axis, and a px or %
// position from the left and top edges, so anything else reaching here is a compiler fault.
import type { BoxItem, ElementLayer } from '../../analysis/paint-values/gradient.ts';
import { base64Encode } from '../../images/compile.ts';
import { parsePng } from '../../images/png.ts';
import { ProgramError } from './types.ts';

/** A layer position from the left or top edge of the origin box: px (CSS px) or a percentage of the free space. */
export type TilePosition = { readonly unit: 'px' | 'percent'; readonly value: number };

export type BackgroundImageWrite = {
  readonly kind: 'background-image';
  /** The PNG bytes, base64. */
  readonly data: string;
  /** The natural size in CSS px (a PNG's pixel size). */
  readonly width: number;
  readonly height: number;
  readonly repeatX: 'repeat' | 'no-repeat';
  readonly repeatY: 'repeat' | 'no-repeat';
  readonly positionX: TilePosition;
  readonly positionY: TilePosition;
  readonly origin: BoxItem;
  readonly clip: BoxItem;
  /** Whether the Android stage may draw through its own layer: false under a transform that moves at run time (as the image write). */
  readonly layer: boolean;
};

const repeatOf = (r: string, id: string): 'repeat' | 'no-repeat' => {
  if (r === 'repeat' || r === 'no-repeat') return r;
  throw new ProgramError(`${id}: background-repeat ${r} on a url() layer reached the native lowering, which every target refuses (BG2-t)`);
};

const positionOf = (p: { readonly unit: string; readonly value: number }, id: string): TilePosition => {
  if ((p.unit === 'px' || p.unit === 'percent') && Number.isFinite(p.value)) return { unit: p.unit, value: p.value };
  throw new ProgramError(`${id}: a url() layer position ${p.unit} ${p.value} reached the native lowering, which every target refuses (BG2-u)`);
};

/** The write of a box's one url() layer; images holds the bytes of every drawable src (images/compile.ts). */
export function lowerUrlLayer(id: string, layers: readonly ElementLayer[], images: ReadonlyMap<string, Uint8Array>, transformMoves: boolean): BackgroundImageWrite {
  const [only, ...rest] = layers;
  if (only === undefined || rest.length > 0) throw new ProgramError(`${id}: a url() layer beside other layers reached the native lowering, which every target refuses (BG2-u)`);
  if (only.image.kind !== 'url') throw new ProgramError(`${id}: the url() layer is not a url() image`);
  if (only.clipsToText === true) throw new ProgramError(`${id}: a url() layer clipped to text reached the native lowering, which every target refuses (background-clip-text.ts)`);
  const g = only.geometry;
  if (g.sizeKind !== 'length' || g.sizeX.unit !== 'auto' || g.sizeY.unit !== 'auto') throw new ProgramError(`${id}: a url() layer at a size other than auto reached the native lowering, which every target refuses (BG2-u)`);
  const bytes = images.get(only.image.url);
  if (bytes === undefined) throw new ProgramError(`${id}: no image bytes for its url() layer`);
  const png = parsePng(bytes);
  if (!png.ok) throw new ProgramError(`${id}: the url() layer's bytes are not the PNG images/compile.ts accepted: ${png.reason}`);
  return {
    kind: 'background-image',
    data: base64Encode(bytes),
    width: png.facts.width,
    height: png.facts.height,
    repeatX: repeatOf(g.repeatX, id),
    repeatY: repeatOf(g.repeatY, id),
    positionX: positionOf(g.positionX, id),
    positionY: positionOf(g.positionY, id),
    origin: g.origin,
    clip: g.clip,
    layer: !transformMoves,
  };
}
