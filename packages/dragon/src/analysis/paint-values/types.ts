// The paint-values seam (notes/T046-paint-spec.md §3 item 4): computed values of the paint longhands, one module per feature,
// run by computePaintValues once after computeLengths, so every length is already px when a module reads it.
import type { Longhand } from '../../css/properties.ts';
import type { PaintModuleName } from '../../lower/paint/types.ts';
import type { ResolvedValue } from '../computed.ts';

/** The element's em and rem bases in px (null where computeLengths had none), for values computeLengths leaves as written. */
export type PaintValueContext = { readonly em: number | null; readonly rem: number | null };

export type PaintValues = {
  readonly name: PaintModuleName;
  /** Computes the module's longhands in place; a map without them (the font-size pre-pass) is left alone. */
  readonly compute: (props: Map<Longhand, ResolvedValue>, ctx: PaintValueContext) => void;
};

/** A module with no computed values yet. */
export const stubPaintValues = (name: PaintModuleName): PaintValues => ({ name, compute: () => {} });
