// The paint-values seam (notes/T046-paint-spec.md §3 item 4): computed values of the paint longhands, one module per feature,
// run by computePaintValues once after computeLengths, so every length is already px when a module reads it.
import type { Longhand } from '../../css/properties.ts';
import type { PaintModuleName } from '../../lower/paint/types.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';

/** The element's em and rem bases in px (null where computeLengths had none), for values computeLengths leaves as written. */
export type PaintValueContext = { readonly em: number | null; readonly rem: number | null };

/**
 * A refusal on an element's computed paint values that no profile row can express (a combination of longhands, such as a rounded
 * dashed border); run by checkComputed on every laid-out element. reported deduplicates across cases.
 */
export type PaintCheck = (el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>) => void;

export type PaintValues = {
  readonly name: PaintModuleName;
  /** Computes the module's longhands in place; a map without them (the font-size pre-pass) is left alone. */
  readonly compute: (props: Map<Longhand, ResolvedValue>, ctx: PaintValueContext) => void;
  /** The module's computed-value refusals, or null. */
  readonly check: PaintCheck | null;
};

/** A module with no computed values yet. */
export const stubPaintValues = (name: PaintModuleName): PaintValues => ({ name, compute: () => {}, check: null });
