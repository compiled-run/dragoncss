// Row keys for the support profiles (M2): the feature (property plus value subset) and the formatting context it is used in.
// checkSupport and scripts/gen-profile-rows.ts both call usedKeys, so a proof and a check always name the same key.
import type { Longhand } from '../css/properties.ts';
import { LONGHANDS, PROPERTY_ROLE } from '../css/properties.ts';
import type { Declaration } from '../css/stylesheet.ts';
import { featureOf } from '../css/stylesheet.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/** The direction facet (docs/api.md §10.1): a left-to-right proof never covers right-to-left. */
export type DirectionFacet = 'ltr' | 'rtl';

/** The main-axis facet of the flex text contexts. */
export type AxisFacet = 'row' | 'column';

/**
 * The context a text node is laid out in, from tree facts alone: text-in-block (the only content of a block container),
 * text-in-flex-item (the only content of a flex item), text-in-anonymous-block (beside block boxes, so the compiler wraps it
 * in an anonymous block, CSS2 §9.2.1.1), text-as-anonymous-flex-item (directly in a flex container, css-flexbox-1 §4), or
 * text-in-display-none. The facets are the block container's direction and, for the flex contexts, the flex container's main axis.
 */
export type TextContext =
  | `text-in-block/${DirectionFacet}`
  | `text-in-anonymous-block/${DirectionFacet}`
  | `text-in-display-none/${DirectionFacet}`
  | `text-in-flex-item/${AxisFacet}/${DirectionFacet}`
  | `text-as-anonymous-flex-item/${AxisFacet}/${DirectionFacet}`;

export type BoxContext =
  | 'root'
  | 'block'
  | 'flex-row'
  | 'flex-column'
  | 'display-none'
  | 'flex-row-single-line'
  | 'flex-row-multi-line'
  | 'flex-column-single-line'
  | 'flex-column-multi-line'
  | 'not-flex-container';

export type FormattingContext = `${BoxContext}/${DirectionFacet}` | TextContext;

const keyword = (el: ResolvedElement, p: Longhand): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/** The element's computed direction, the direction facet of the contexts its algorithms define. */
export function directionFacet(el: ResolvedElement): DirectionFacet {
  return keyword(el, 'direction') === 'rtl' ? 'rtl' : 'ltr';
}

const axisFacet = (flexContainer: ResolvedElement): AxisFacet => (keyword(flexContainer, 'flex-direction').startsWith('column') ? 'column' : 'row');

/**
 * The formatting context of an element-level longhand, with the direction of the box whose algorithm consumes it. Item
 * properties: the context the element's box takes part in (root, block, flex-row, flex-column, or display-none under a hidden
 * parent) and the parent's direction (the root's own). Container properties: the element's own flex line mode and direction.
 * Text properties are keyed per text node instead (textContext).
 */
export function formattingContext(property: Longhand, el: ResolvedElement, parent: ResolvedElement | null): FormattingContext {
  const role = PROPERTY_ROLE[property];
  if (role === 'text') throw new Error(`${property} is keyed per text node (textContext)`);
  if (role === 'container') {
    const own = directionFacet(el);
    if (keyword(el, 'display') !== 'flex') return `not-flex-container/${own}`;
    const single = keyword(el, 'flex-wrap') === 'nowrap';
    return `flex-${axisFacet(el)}-${single ? 'single' : 'multi'}-line/${own}`;
  }
  if (parent === null) return `root/${directionFacet(el)}`;
  const dir = directionFacet(parent);
  const display = keyword(parent, 'display');
  if (display === 'none') return `display-none/${dir}`;
  if (display === 'flex') return `flex-${axisFacet(parent)}/${dir}`;
  return `block/${dir}`;
}

/** The context of the text children of insertion parent el, whose own parent is parent; the facet is el's direction. */
export function textContext(el: ResolvedElement, parent: ResolvedElement | null): TextContext {
  const dir = directionFacet(el);
  const display = keyword(el, 'display');
  if (display === 'none') return `text-in-display-none/${dir}`;
  if (display === 'flex') return `text-as-anonymous-flex-item/${axisFacet(el)}/${dir}`;
  if (el.children.some((c) => c.kind === 'element' && keyword(c, 'display') !== 'none')) return `text-in-anonymous-block/${dir}`;
  if (parent !== null && keyword(parent, 'display') === 'flex') return `text-in-flex-item/${axisFacet(parent)}/${dir}`;
  return `text-in-block/${dir}`;
}

export type UsedKey = {
  /** "<feature>@<context>", the profile row key. */
  readonly key: string;
  readonly feature: string;
  readonly context: FormattingContext;
  readonly property: Longhand;
  readonly declaration: Declaration;
  /** The element address, or for a text property the address of the text node the value reaches. */
  readonly address: string;
};

export const rowKey = (feature: string, context: string): string => `${feature}@${context}`;

/**
 * Every author declaration that won the cascade on an element of this case, with its row key. A text property is keyed at each
 * text node its value reaches by inheritance, in that text node's context, with the declaration it was inherited from.
 */
export function usedKeys(root: ResolvedElement): UsedKey[] {
  const out: UsedKey[] = [];
  const walk = (el: ResolvedElement, chain: readonly ResolvedElement[]): void => {
    const parent = chain[chain.length - 1];
    for (const p of LONGHANDS) {
      if (PROPERTY_ROLE[p] === 'text') continue;
      const v = el.props.get(p) as ResolvedValue;
      if (v.declaration === null || v.declared === null) continue;
      const feature = featureOf(p, v.declared);
      const context = formattingContext(p, el, parent === undefined ? null : parent);
      out.push({ key: rowKey(feature, context), feature, context, property: p, declaration: v.declaration, address: el.element.address });
    }
    for (const c of el.children) {
      if (c.kind === 'element') {
        walk(c, [...chain, el]);
        continue;
      }
      const context = textContext(el, parent === undefined ? null : parent);
      for (const p of LONGHANDS) {
        if (PROPERTY_ROLE[p] !== 'text') continue;
        let at: ResolvedElement | undefined = el;
        let up = chain.length;
        while (at !== undefined) {
          const v = at.props.get(p) as ResolvedValue;
          if (v.declaration !== null && v.declared !== null) {
            const feature = featureOf(p, v.declared);
            out.push({ key: rowKey(feature, context), feature, context, property: p, declaration: v.declaration, address: c.node.address });
            break;
          }
          if (v.origin !== 'inherited') break;
          up--;
          at = chain[up];
        }
      }
    }
  };
  walk(root, []);
  return out;
}
