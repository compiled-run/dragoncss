// A leaf module: paint-values/stacking.ts reads a select's parts without importing resolve.ts, which would close an import cycle.
import type { LinkedElement } from './link.ts';
import type { ResolvedElement } from './resolve.ts';

/** The part of a single select's UA shadow tree (FORM-b): the inner element. */
export type SelectPart = 'inner';

/** A single select (part null) or its inner element, with the select element. */
export type SelectPartInfo = { readonly part: SelectPart | null; readonly host: LinkedElement };

/** Each resolved single select and inner element, written by resolve.ts as it builds the tree. */
export const selectParts = new WeakMap<ResolvedElement, SelectPartInfo>();

/** The single select or select part a resolved element is, or undefined for every other element. */
export function selectPartOf(el: ResolvedElement): SelectPartInfo | undefined {
  return selectParts.get(el);
}
