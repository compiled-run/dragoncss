// The compile-time text of every outside list marker in a resolved tree (notes/T151-gen-spec.md R14, "Ordinals and text:
// compile-time"): the static tree as the ordinal walk sees it (analysis/ordinals.ts), and each list item's computed list-style-type
// as a counter style GEN-c writes (css/counter-styles.ts), none, or a type GEN-c refuses, naming GEN-d1.
// Style containment never makes a list owner here: Dragon has no contain longhand, so an authored contain is refused before this
// runs (DRAGON_UNSUPPORTED_PROPERTY), and no UA rule sets it.
import type { CssValue } from '../css/values.ts';
import type { ListStyleType } from '../css/counter-styles.ts';
import { isCounterStyleName, markerText } from '../css/counter-styles.ts';
import { parseSerializedString } from '../css/escapes.ts';
import { STRING_VALUE_TYPE } from '../css/properties/lists.ts';
import type { GenCFaults } from '../faults/gen-c.ts';
import { GEN_C_FAULTS } from '../faults/gen-c.ts';
import type { OrdinalNode } from './ordinals.ts';
import { listItemOrdinals } from './ordinals.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/** The package that owns every counter style R14 does not list (notes/T151-gen-spec.md R14, R15). */
export const COUNTER_STYLE_OWNER = 'counter styles beyond the R14 list and @counter-style (GEN-d1)';

/** A computed list-style-type as GEN-c sees it: a type it writes, none (no marker box), or a refusal reason. */
export type MarkerType = { readonly kind: 'type'; readonly type: ListStyleType } | { readonly kind: 'none' } | { readonly kind: 'refused'; readonly reason: string };

/**
 * css-lists-3 §3.3: a computed list-style-type is a counter-style name or a <string> (GEN-b computes predefined names in lowercase
 * and keeps any other name as written, css/properties/lists.ts). A name outside R14's list is refused rather than drawn with
 * Chrome's decimal fallback for an undefined name (R14).
 */
export function markerTypeOf(value: CssValue): MarkerType {
  if (value.kind === 'other' && value.type === STRING_VALUE_TYPE) return { kind: 'type', type: { kind: 'string', text: parseSerializedString(value.text) } };
  if (value.kind !== 'keyword') throw new Error(`list-style-type computed to a ${value.kind}, not a keyword or a string`);
  if (value.value === 'none') return { kind: 'none' };
  if (isCounterStyleName(value.value)) return { kind: 'type', type: { kind: 'style', name: value.value } };
  return { kind: 'refused', reason: `list-style-type: ${value.value} is not supported yet: ${COUNTER_STYLE_OWNER}` };
}

const keywordOf = (el: ResolvedElement, property: 'display' | 'list-style-type'): CssValue => {
  const v = el.props.get(property) as ResolvedValue | undefined;
  if (v === undefined) throw new Error(`${el.element.address}: ${property} did not resolve`);
  return v.value;
};

const displayOf = (el: ResolvedElement): string => {
  const v = keywordOf(el, 'display');
  return v.kind === 'keyword' ? v.value : '';
};

/** The resolved tree as list_item_ordinal.cc walks it: node ids are element addresses. */
export function ordinalTreeOf(root: ResolvedElement): OrdinalNode {
  const toNode = (el: ResolvedElement, hidden: boolean): OrdinalNode => {
    const display = displayOf(el);
    const none = hidden || display === 'none';
    return {
      id: el.element.address,
      tag: el.element.tag,
      box: none ? 'none' : display === 'contents' ? 'contents' : 'box',
      listItem: display === 'list-item',
      styleContainment: false,
      attributes: el.element.attributes,
      children: el.children.flatMap((c) => (c.kind === 'element' ? [toNode(c, none)] : [])),
    };
  };
  return toNode(root, false);
}

/** One list item's marker: its type and, when GEN-c writes the type, the text Chrome lays out (list_marker.cc MarkerText). */
export type ListItemMarker = { readonly address: string; readonly ordinal: number; readonly type: MarkerType; readonly text: string | null };

/**
 * Every list item with a box, in tree order, with its ordinal and marker. A list-style-image other than none never reaches here
 * (GEN-b refuses every image, css/properties/lists.ts), so list-style-type alone decides the marker.
 */
export function listItemMarkers(root: ResolvedElement, faults: GenCFaults = GEN_C_FAULTS): readonly ListItemMarker[] {
  const ordinals = listItemOrdinals(ordinalTreeOf(root), faults);
  const out: ListItemMarker[] = [];
  const walk = (el: ResolvedElement): void => {
    const ordinal = ordinals.get(el.element.address);
    if (ordinal !== undefined) {
      const type = markerTypeOf(keywordOf(el, 'list-style-type'));
      out.push({ address: el.element.address, ordinal, type, text: type.kind === 'type' ? markerText(type.type, ordinal, faults) : null });
    }
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out;
}
