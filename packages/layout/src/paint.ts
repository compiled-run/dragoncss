// The paint seam of the engine package (notes/T046-paint-spec.md §3 item 4): the types the translated paint-*.ts references
// share. Layout-size-dependent paint geometry (percent radii, gradient lines, shadow rects, transform origins) runs on the
// device, so it lives in the paint-*.ts roots (translate/src/generate.ts), never in the compiler.

/** A box's paint shape in device px: the snapped border-box edges, the border widths and the eight corner radii (horizontal then vertical, top-left first). */
export type BoxShape = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly borders: readonly number[];
  readonly radii: readonly number[];
};
