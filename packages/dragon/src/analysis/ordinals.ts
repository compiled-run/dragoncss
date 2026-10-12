// List item ordinals over the static tree (T151 R14: "Ordinals and text: compile-time"), ported from Chrome 145's
// third_party/blink/renderer/core/html/list_item_ordinal.cc (BSD, "The Chromium Authors"): IsListOwner (:21-29), EnclosingList
// (:70-84), NextListItem (:92-117), PreviousListItem (:122-161), CalcValue (:181-225) and InitialCounterForReversedOrderedList
// (:311-323), with CSSListCounterAccounting off, as it is in Chrome 145 stable (runtime_enabled_features.json5: "experimental").
// The ol start and reversed attributes and the li value attribute follow the HTML standard (§4.4.5, §4.4.8 and §2.3.4.1, the rules
// for parsing integers); Chrome's HTMLOListElement and HTMLLIElement, which read them, are LGPL and not ported (class A).
// Measured against Chrome by test/markers-text.test.ts, which reads the GEN-P probe (docs/research/gen-spike/probe/family5-markers.json).
// counter-reset, counter-set and counter-increment of list-item are not modelled: the caller refuses them (GEN-d1).
import type { GenCFaults } from '../faults/gen-c.ts';
import { GEN_C_FAULTS } from '../faults/gen-c.ts';

/** One node of the flattened static tree, as the ordinal walk sees it. */
export type OrdinalNode = {
  readonly id: string;
  /** The lowercase HTML tag. */
  readonly tag: string;
  /**
   * 'box' when the element generates a box, 'contents' for display: contents (no box, but its children are walked), 'none' when it
   * or an ancestor is display: none (no box anywhere below).
   */
  readonly box: 'box' | 'contents' | 'none';
  /** Its display is list-item (the box is a LayoutListItem). Meaningful only with box 'box'. */
  readonly listItem: boolean;
  /** Its style applies style containment (contain: style, content or strict), which makes it a list owner. */
  readonly styleContainment: boolean;
  /** The static attributes; a missing name is an absent attribute, '' a present empty one. */
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly OrdinalNode[];
};

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;

/** HTML §2.3.4.1, the rules for parsing integers; null is an error. A value outside a C++ int is an error, as in Chrome. */
export function parseHtmlInteger(input: string): number | null {
  const m = /^[\t\n\f\r ]*([-+]?)([0-9]+)/.exec(input);
  if (m === null) return null;
  const magnitude = Number((m[2] as string).replace(/^0+(?=\d)/, ''));
  const value = m[1] === '-' && magnitude !== 0 ? -magnitude : magnitude; // a C++ int has no -0
  return value < INT_MIN || value > INT_MAX ? null : value;
}

/** base::saturated_cast<int>. */
const saturate = (v: number): number => Math.min(INT_MAX, Math.max(INT_MIN, v));

/** The ordinal value of every list item in the tree, by node id. A node without a box or that is not a list item has none. */
export function listItemOrdinals(root: OrdinalNode, faults: GenCFaults = GEN_C_FAULTS): ReadonlyMap<string, number> {
  // The flat tree in preorder (LayoutTreeBuilderTraversal's order), with parents and subtree ends.
  const order: OrdinalNode[] = [];
  const parent = new Map<OrdinalNode, OrdinalNode | null>();
  const end = new Map<OrdinalNode, number>();
  const walk = (node: OrdinalNode, up: OrdinalNode | null): void => {
    parent.set(node, up);
    order.push(node);
    for (const child of node.children) walk(child, node);
    end.set(node, order.length);
  };
  walk(root, null);
  const index = new Map(order.map((n, i) => [n, i]));
  const at = (i: number): OrdinalNode => order[i] as OrdinalNode;
  const endOf = (n: OrdinalNode): number => end.get(n) as number;

  const isListItem = (n: OrdinalNode): boolean => n.box === 'box' && n.listItem;
  // IsListOwner: ul, ol or menu with a box (ListOwnerMustHaveCSSBox is stable), or style containment.
  const isListOwner = (n: OrdinalNode): boolean => n.box === 'box' && (n.tag === 'ul' || n.tag === 'ol' || n.tag === 'menu' || n.styleContainment);
  const isOl = (n: OrdinalNode | null): n is OrdinalNode => n !== null && n.tag === 'ol';

  // EnclosingList: the nearest list owner above the item, or else its parent.
  const enclosing = new Map<OrdinalNode, OrdinalNode | null>();
  const enclosingList = (item: OrdinalNode): OrdinalNode | null => {
    if (enclosing.has(item)) return enclosing.get(item) as OrdinalNode | null;
    const first = parent.get(item) ?? null;
    let found: OrdinalNode | null = first;
    for (let p = first; p !== null; p = parent.get(p) ?? null) {
      if (isListOwner(p)) {
        found = p;
        break;
      }
    }
    enclosing.set(item, found);
    return found;
  };

  // InitialCounterForReversedOrderedList: the number of NextListItem steps, which skip nested list owners.
  const itemCount = (list: OrdinalNode): number => {
    let count = 0;
    for (let i = (index.get(list) as number) + 1; i < endOf(list); ) {
      const n = at(i);
      if (isListOwner(n)) {
        i = endOf(n);
        continue;
      }
      if (isListItem(n)) count++;
      i++;
    }
    return count;
  };

  // InitialCounter: start if it parses, else the item count when reversed, else 1.
  const initialCounter = (ol: OrdinalNode): number => {
    const start = ol.attributes.get('start');
    const parsed = start === undefined ? null : parseHtmlInteger(start);
    if (parsed !== null) return parsed;
    return ol.attributes.has('reversed') && !faults.reversedCountsUp ? itemCount(ol) : 1;
  };

  // PreviousListItem: walk back in preorder, inside the list, to the previous item of the same list; an item of another list
  // jumps to that list (whose own node is then examined), skipping its other items.
  const previousListItem = (list: OrdinalNode | null, item: OrdinalNode): OrdinalNode | null => {
    const stop = list === null ? -1 : (index.get(list) as number);
    for (let i = (index.get(item) as number) - 1; i > stop; ) {
      const n = at(i);
      if (isListItem(n)) {
        const other = enclosingList(n);
        if (other === list) return n;
        if (other !== null) {
          i = index.get(other) as number;
          continue;
        }
      }
      i--;
    }
    return null;
  };

  // CalcValue, in preorder so every previous item is already known.
  const values = new Map<string, number>();
  const valueOf = new Map<OrdinalNode, number>();
  for (const node of order) {
    if (!isListItem(node)) continue;
    const list = enclosingList(node);
    const reversed = isOl(list) && list.attributes.has('reversed') && !faults.reversedCountsUp;
    let value: number;
    const explicit = node.tag === 'li' && node.attributes.has('value') && !faults.ordinalIgnoresValue ? parseHtmlInteger(node.attributes.get('value') as string) : null;
    if (explicit !== null) value = explicit;
    else {
      const previous = previousListItem(list, node);
      let base = 0;
      if (previous !== null) base = valueOf.get(previous) as number;
      else if (isOl(list)) base = initialCounter(list) + (reversed ? 1 : -1);
      value = saturate(base + (reversed ? -1 : 1));
    }
    valueOf.set(node, value);
    values.set(node.id, value);
  }
  return values;
}
