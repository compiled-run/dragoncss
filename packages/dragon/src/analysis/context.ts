// Row keys for the support profiles (M2): the feature (property plus value subset) and the formatting context it is used in.
// checkSupport and scripts/gen-profile-rows.ts both call usedKeys, so a proof and a check always name the same key.
import type { Longhand } from '../css/properties.ts';
import { LONGHANDS, PROPERTY_ROLE } from '../css/properties.ts';
import type { Declaration } from '../css/stylesheet.ts';
import { featureOf } from '../css/stylesheet.ts';
import type { FamilyKeyContext } from '../css/values.ts';
import { GENERATED_TAGS } from './elements.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

/** The direction facet (docs/api.md §10.1): a left-to-right proof never covers right-to-left. */
export type DirectionFacet = 'ltr' | 'rtl';

/** The main-axis facet of the flex text contexts. */
export type AxisFacet = 'row' | 'column';

/**
 * The context a text node is laid out in, from tree facts alone: text-in-inline (in an inline box), text-beside-inline (beside an
 * inline box in its block container), text-in-block (the only content of a block container), text-in-flex-item (the only content
 * of a flex item), text-in-grid-item (the only content of a grid item), text-in-anonymous-block (beside block boxes, so the compiler
 * wraps it in an anonymous block, CSS2 §9.2.1.1), text-as-anonymous-flex-item (directly in a flex container, css-flexbox-1 §4),
 * text-as-anonymous-grid-item (directly in a grid container, css-grid-2 §6), or text-in-display-none. The facets are the block
 * container's direction and, for the flex contexts, the flex container's main axis.
 */
export type TextContext =
  | `text-in-block/${DirectionFacet}`
  | `text-in-inline/${DirectionFacet}`
  | `text-beside-inline/${DirectionFacet}`
  | `text-in-anonymous-block/${DirectionFacet}`
  | `text-in-display-none/${DirectionFacet}`
  | `text-in-flex-item/${AxisFacet}/${DirectionFacet}`
  | `text-as-anonymous-flex-item/${AxisFacet}/${DirectionFacet}`
  | `text-in-grid-item/${DirectionFacet}`
  | `text-as-anonymous-grid-item/${DirectionFacet}`;

export type BoxContext =
  | 'root'
  | 'block'
  | 'inline'
  | 'flex-row'
  | 'flex-column'
  | 'display-none'
  | 'flex-row-single-line'
  | 'flex-row-multi-line'
  | 'flex-column-single-line'
  | 'flex-column-multi-line'
  | 'grid-container'
  | 'grid'
  | 'not-flex-container';

/**
 * The context an element's box takes part in: the root, or its parent's formatting context. inline: an inline box (CSS2 §9.2.2),
 * which takes part in its block container's inline formatting context; a flex or grid item is blockified, so never inline.
 */
export type ItemBase = 'root' | 'block' | 'flex-row' | 'flex-column' | 'grid' | 'display-none' | 'inline';

/**
 * Row contexts. Item properties of a positioned box carry the positioning scheme: a relative box its parent's context and
 * direction (its containing block); an absolute box the context and direction of its parent (which gives its static position)
 * and the direction of its containing block. Paint properties carry only the element's direction.
 */
/**
 * GEN-a (notes/T151-gen-spec.md R2, R8): the context of content on a ::before or ::after box, which decides how the box it
 * generates is laid out: an inline box in its host's inline formatting context (empty or holding text, proven apart: an empty
 * inline box in rtl is placed as Chrome does only where a fixture shows it), a block, a flex or grid item, or an absolutely
 * positioned box; the facets are the host's direction and, for a flex item, its main axis.
 */
export type PseudoContext =
  | `pseudo-inline-in-${'block' | 'inline'}/${DirectionFacet}`
  | `pseudo-empty-inline-in-${'block' | 'inline'}/${DirectionFacet}`
  | `pseudo-block/${DirectionFacet}`
  | `pseudo-flex-item/${AxisFacet}/${DirectionFacet}`
  | `pseudo-grid-item/${DirectionFacet}`
  | `pseudo-abspos-in-${'block' | 'flex' | 'grid'}/${DirectionFacet}`
  | `pseudo-in-display-none/${DirectionFacet}`;

export type FormattingContext =
  | PseudoContext
  | `${BoxContext}/${DirectionFacet}`
  | `relative-in-${ItemBase}/${DirectionFacet}`
  | `absolute-in-${ItemBase}/${DirectionFacet}/cb-${DirectionFacet}`
  | `paint/${DirectionFacet}`
  | TextContext;

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
export function formattingContext(property: Longhand, el: ResolvedElement, ancestors: readonly ResolvedElement[]): FormattingContext {
  const role = PROPERTY_ROLE[property];
  if (role === 'text') throw new Error(`${property} is keyed per text node (textContext)`);
  if (role === 'paint') return `paint/${directionFacet(el)}`;
  const parent = ancestors.length === 0 ? null : (ancestors[ancestors.length - 1] as ResolvedElement);
  if (role === 'container') {
    const own = directionFacet(el);
    // css-grid-2 §7: a grid container's own properties are proven in grid layout, never by their inert use on a block.
    if (keyword(el, 'display') === 'grid') return `grid-container/${own}`;
    if (keyword(el, 'display') !== 'flex') return `not-flex-container/${own}`;
    const single = keyword(el, 'flex-wrap') === 'nowrap';
    return `flex-${axisFacet(el)}-${single ? 'single' : 'multi'}-line/${own}`;
  }
  const base: ItemBase = parent === null ? 'root' : keyword(parent, 'display') === 'none' ? 'display-none' : keyword(el, 'display') === 'inline' ? 'inline' : keyword(parent, 'display') === 'flex' ? `flex-${axisFacet(parent)}` : keyword(parent, 'display') === 'grid' ? 'grid' : 'block';
  const dir = directionFacet(parent === null ? el : parent);
  const position = keyword(el, 'position');
  if (position === 'relative') return `relative-in-${base}/${dir}`;
  if (position === 'absolute') return `absolute-in-${base}/${dir}/cb-${containingBlockDirection(el, ancestors)}`;
  return `${base}/${dir}`;
}

/** GEN-a: the context of content on a generated box el, whose host is the last of ancestors (PseudoContext). */
export function pseudoContext(el: ResolvedElement, ancestors: readonly ResolvedElement[]): PseudoContext {
  const host = ancestors[ancestors.length - 1];
  if (host === undefined) throw new Error(`${el.element.address}: a generated box has no host`);
  const dir = directionFacet(host);
  if (ancestors.some((a) => keyword(a, 'display') === 'none')) return `pseudo-in-display-none/${dir}`;
  const hostDisplay = keyword(host, 'display');
  const container = hostDisplay === 'flex' ? 'flex' : hostDisplay === 'grid' ? 'grid' : 'block';
  if (keyword(el, 'position') === 'absolute') return `pseudo-abspos-in-${container}/${dir}`;
  if (hostDisplay === 'flex') return `pseudo-flex-item/${axisFacet(host)}/${dir}`;
  if (hostDisplay === 'grid') return `pseudo-grid-item/${dir}`;
  if (keyword(el, 'display') !== 'inline') return `pseudo-block/${dir}`;
  const empty = !el.children.some((c) => c.kind === 'text');
  const where = hostDisplay === 'inline' ? 'inline' : 'block';
  return empty ? `pseudo-empty-inline-in-${where}/${dir}` : `pseudo-inline-in-${where}/${dir}`;
}

/** CSS2 §10.1: the nearest positioned ancestor, or the initial containing block, whose direction is the root's. */
function containingBlockDirection(el: ResolvedElement, ancestors: readonly ResolvedElement[]): DirectionFacet {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i] as ResolvedElement;
    if (keyword(a, 'position') !== 'static') return directionFacet(a);
  }
  return directionFacet(ancestors.length === 0 ? el : (ancestors[0] as ResolvedElement));
}

/** The context of the text children of insertion parent el, whose own parent is parent; the facet is el's direction. */
export function textContext(el: ResolvedElement, parent: ResolvedElement | null): TextContext {
  const dir = directionFacet(el);
  const display = keyword(el, 'display');
  if (display === 'none') return `text-in-display-none/${dir}`;
  if (display === 'flex') return `text-as-anonymous-flex-item/${axisFacet(el)}/${dir}`;
  if (display === 'grid') return `text-as-anonymous-grid-item/${dir}`;
  // CSS2 §9.2.2: text in an inline box flows in the inline formatting context of the box's block container, and text beside an
  // inline box shares that context, whose line boxes the boxes size (§10.8): both are their own contexts, proven apart.
  if (display === 'inline' && parent !== null) return `text-in-inline/${dir}`;
  if (el.children.some((c) => c.kind === 'element' && keyword(c, 'display') === 'inline')) return `text-beside-inline/${dir}`;
  // CSS2 §9.2.1.1: text beside block-level boxes is wrapped in an anonymous block.
  if (el.children.some((c) => c.kind === 'element' && keyword(c, 'display') !== 'none')) return `text-in-anonymous-block/${dir}`;
  // css-flexbox-1 §4.1: an absolutely positioned child of a flex container is not a flex item.
  if (parent !== null && keyword(parent, 'display') === 'flex' && keyword(el, 'position') !== 'absolute') return `text-in-flex-item/${axisFacet(parent)}/${dir}`;
  // css-grid-2 §9: an absolutely positioned child of a grid container is not a grid item.
  if (parent !== null && keyword(parent, 'display') === 'grid' && keyword(el, 'position') !== 'absolute') return `text-in-grid-item/${dir}`;
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
 * text node its value reaches by inheritance, in that text node's context, with the declaration it was inherited from. fonts: the
 * project's font context, which keys a font-family value by how it resolves (css/values.ts featureOf).
 */
export function usedKeys(root: ResolvedElement, fonts?: FamilyKeyContext): UsedKey[] {
  const out: UsedKey[] = [];
  const walk = (el: ResolvedElement, chain: readonly ResolvedElement[]): void => {
    const parent = chain[chain.length - 1];
    for (const p of LONGHANDS) {
      if (PROPERTY_ROLE[p] === 'text') continue;
      const v = el.props.get(p) as ResolvedValue;
      if (v.declaration === null || v.declared === null) continue;
      const feature = featureOf(p, v.declared);
      const context = p === 'content' && GENERATED_TAGS.has(el.element.tag) ? pseudoContext(el, chain) : formattingContext(p, el, chain);
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
            const feature = featureOf(p, v.declared, p === 'font-family' ? fonts : undefined);
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
