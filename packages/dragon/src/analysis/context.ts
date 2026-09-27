// Row keys for the support profiles (M2): the feature (property plus value subset) and the formatting context it is used in.
// checkSupport and scripts/gen-profile-rows.ts both call usedKeys, so a proof and a check always name the same key.
import type { Longhand } from '../css/properties.ts';
import { LONGHANDS, PROPERTY_ROLE } from '../css/properties.ts';
import type { Declaration } from '../css/stylesheet.ts';
import { featureOf } from '../css/stylesheet.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/**
 * The context a text node is laid out in, from tree facts alone: text-in-block (the only content of a block container),
 * text-in-flex-item (the only content of a flex item), text-in-anonymous-block (beside block boxes, so the compiler wraps it
 * in an anonymous block, CSS2 §9.2.1.1), text-as-anonymous-flex-item (directly in a flex container, css-flexbox-1 §4), or
 * text-in-display-none.
 */
export type TextContext = 'text-in-block' | 'text-in-flex-item' | 'text-in-anonymous-block' | 'text-as-anonymous-flex-item' | 'text-in-display-none';

export type FormattingContext =
  | 'root'
  | 'block'
  | 'flex-row'
  | 'flex-column'
  | 'display-none'
  | 'flex-row-single-line'
  | 'flex-row-multi-line'
  | 'flex-column-single-line'
  | 'flex-column-multi-line'
  | 'not-flex-container'
  | TextContext;

const keyword = (el: ResolvedElement, p: Longhand): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/**
 * The formatting context of an element-level longhand. Item properties: the context the element's box takes part in (root,
 * block, flex-row, flex-column, or display-none under a hidden parent). Container properties: the element's own flex line mode.
 * Text properties are keyed per text node instead (textContext).
 */
export function formattingContext(property: Longhand, el: ResolvedElement, parent: ResolvedElement | null): FormattingContext {
  const role = PROPERTY_ROLE[property];
  if (role === 'text') throw new Error(`${property} is keyed per text node (textContext)`);
  if (role === 'container') {
    if (keyword(el, 'display') !== 'flex') return 'not-flex-container';
    const column = keyword(el, 'flex-direction').startsWith('column');
    const single = keyword(el, 'flex-wrap') === 'nowrap';
    return `flex-${column ? 'column' : 'row'}-${single ? 'single' : 'multi'}-line`;
  }
  if (parent === null) return 'root';
  const display = keyword(parent, 'display');
  if (display === 'none') return 'display-none';
  if (display === 'flex') return keyword(parent, 'flex-direction').startsWith('column') ? 'flex-column' : 'flex-row';
  return 'block';
}

/** The context of the text children of insertion parent el, whose own parent is parent. */
export function textContext(el: ResolvedElement, parent: ResolvedElement | null): TextContext {
  const display = keyword(el, 'display');
  if (display === 'none') return 'text-in-display-none';
  if (display === 'flex') return 'text-as-anonymous-flex-item';
  if (el.children.some((c) => c.kind === 'element' && keyword(c, 'display') !== 'none')) return 'text-in-anonymous-block';
  if (parent !== null && keyword(parent, 'display') === 'flex') return 'text-in-flex-item';
  return 'text-in-block';
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
