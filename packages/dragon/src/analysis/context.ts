// Row keys for the support profiles (M2): the feature (property plus value subset) and the formatting context it is used in.
// checkSupport and scripts/gen-profile-rows.ts both call usedKeys, so a proof and a check always name the same key.
import type { Longhand } from '../css/properties.ts';
import { LONGHANDS, PROPERTY_ROLE } from '../css/properties.ts';
import type { Declaration } from '../css/stylesheet.ts';
import { featureOf } from '../css/stylesheet.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';

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
  | 'single-line-text';

const keyword = (el: ResolvedElement, p: Longhand): string => {
  const v = (el.props.get(p) as ResolvedValue).value;
  return v.kind === 'keyword' ? v.value : '';
};

/**
 * The formatting context a longhand acts in. Item properties: the context the element's box takes part in (root, block,
 * flex-row, flex-column, or display-none under a hidden parent). Container properties: the element's own flex line mode.
 * Text properties: single-line-text, because the milestone-1 engine lays out only single lines and refuses the rest.
 */
export function formattingContext(property: Longhand, el: ResolvedElement, parent: ResolvedElement | null): FormattingContext {
  const role = PROPERTY_ROLE[property];
  if (role === 'text') return 'single-line-text';
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

export type UsedKey = {
  /** "<feature>@<context>", the profile row key. */
  readonly key: string;
  readonly feature: string;
  readonly context: FormattingContext;
  readonly property: Longhand;
  readonly declaration: Declaration;
  readonly address: string;
};

export const rowKey = (feature: string, context: string): string => `${feature}@${context}`;

/** Every author declaration that won the cascade on an element of this case, with its row key. */
export function usedKeys(root: ResolvedElement): UsedKey[] {
  const out: UsedKey[] = [];
  const walk = (el: ResolvedElement, parent: ResolvedElement | null): void => {
    for (const p of LONGHANDS) {
      const v = el.props.get(p) as ResolvedValue;
      if (v.declaration === null || v.declared === null) continue;
      const feature = featureOf(p, v.declared);
      const context = formattingContext(p, el, parent);
      out.push({ key: rowKey(feature, context), feature, context, property: p, declaration: v.declaration, address: el.element.address });
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, el);
  };
  walk(root, null);
  return out;
}
