// css-conditional-5 §2: container-type (initial normal) and container-name (none), not inherited, and the container shorthand,
// <'container-name'> [ / <'container-type'> ]? (Chrome 145 css_properties.json5). Dragon parses every value Chrome 145 parses.
// container-name only names a query container for @container rules (analysis/container-rules.ts), so every name compiles.
// container-type: inline-size makes the box a query container with style and inline-size containment and an independent
// formatting context (lower/ios-layout.ts containInlineSize); analysis/scroll-containment.ts refuses every other value other than
// normal.
import type { CssNode } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import { CSS_WIDE } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { kwInitial } from './initial-only.ts';

export const CONTAINER_QUERY_LONGHANDS = ['container-name', 'container-type'] as const;
export const CONTAINER_QUERY_SHORTHANDS = ['container'] as const;
export const CONTAINER_QUERY_INHERITED: readonly (typeof CONTAINER_QUERY_LONGHANDS)[number][] = [];
export const CONTAINER_QUERY_CONTAINER: readonly (typeof CONTAINER_QUERY_LONGHANDS)[number][] = [];
export const CONTAINER_QUERY_TEXT_ROLE: readonly (typeof CONTAINER_QUERY_LONGHANDS)[number][] = [];

type ContainerQueryLonghand = (typeof CONTAINER_QUERY_LONGHANDS)[number];

export const CONTAINER_QUERY_ASPECTS: { readonly [P in ContainerQueryLonghand]: PropertyAspect } = {
  'container-name': { layout: false, paint: false },
  'container-type': { layout: true, paint: false },
};

/** Each longhand's initial value. */
export const CONTAINER_QUERY_INITIAL: { readonly [P in ContainerQueryLonghand]: CssValue } = {
  'container-name': kwInitial('none'),
  'container-type': kwInitial('normal'),
};

/** The value type of a container-name list of names, case kept (featureOf key container-name:container-names). */
export const CONTAINER_NAMES_TYPE = 'container-names';

// Blink ConsumeContainerName: a <custom-ident> other than none, and, not, or and default (css-values-4 §4.2 adds the CSS-wide keywords).
const NOT_NAMES: ReadonlySet<string> = new Set([...CSS_WIDE, 'none', 'and', 'not', 'or', 'default']);

/** container-name: none alone, or one or more names (repeats kept). */
function names(tokens: readonly CssNode[]): CssValue | null {
  if (tokens.length === 1 && tokens[0]?.type === 'Identifier' && asciiLower(String(tokens[0]['name'])) === 'none') return CONTAINER_QUERY_INITIAL['container-name'];
  const out: string[] = [];
  for (const t of tokens) {
    if (t.type !== 'Identifier' || NOT_NAMES.has(asciiLower(String(t['name'])))) return null;
    out.push(String(t['name']));
  }
  return out.length === 0 ? null : { kind: 'other', type: CONTAINER_NAMES_TYPE, text: out.join(' ') };
}

// Blink ConsumeContainerType: normal alone, or one of size and inline-size, scroll-state and anchored, each at most once in any order;
// it computes in this order (probed in Chrome 145: scroll-state size computes to size scroll-state).
const TYPE_ORDER = ['size', 'inline-size', 'scroll-state', 'anchored'] as const;

/** container-type as its computed keyword, or null. */
function containerType(tokens: readonly CssNode[]): CssValue | null {
  const ks = tokens.map((t) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : ''));
  if (ks.length === 1 && ks[0] === 'normal') return CONTAINER_QUERY_INITIAL['container-type'];
  if (ks.length === 0 || new Set(ks).size !== ks.length || !ks.every((k) => (TYPE_ORDER as readonly string[]).includes(k))) return null;
  if (ks.includes('size') && ks.includes('inline-size')) return null;
  return kwInitial(TYPE_ORDER.filter((k) => ks.includes(k)).join(' '));
}

const isSlash = (t: CssNode | undefined): boolean => t?.type === 'Operator' && String(t['value']) === '/';

/** container: a name list, then optionally / and a type; the type defaults to normal. */
export function parseContainer(tokens: readonly CssNode[]): ParsedValue {
  const at = tokens.findIndex(isSlash);
  const name = names(at < 0 ? tokens : tokens.slice(0, at));
  const type = at < 0 ? CONTAINER_QUERY_INITIAL['container-type'] : containerType(tokens.slice(at + 1));
  if (name === null || type === null) return { kind: 'invalid', reason: 'container takes container-name values, then optionally / and container-type values' };
  return {
    kind: 'ok',
    longhands: [
      { property: 'container-name', value: name, explicit: true },
      { property: 'container-type', value: type, explicit: at >= 0 },
    ],
  };
}

export const CONTAINER_QUERY_VALUE_PARSERS: { readonly [P in ContainerQueryLonghand | (typeof CONTAINER_QUERY_SHORTHANDS)[number]]: InitialOnlyParser } = {
  'container-name': (tokens) => {
    const v = names(tokens);
    return v === null ? { kind: 'invalid', reason: 'container-name takes none or names other than and, not, or and default' } : { kind: 'ok', longhands: [{ property: 'container-name', value: v, explicit: true }] };
  },
  'container-type': (tokens) => {
    const v = containerType(tokens);
    return v === null ? { kind: 'invalid', reason: 'container-type takes normal, or size or inline-size, scroll-state and anchored, each at most once' } : { kind: 'ok', longhands: [{ property: 'container-type', value: v, explicit: true }] };
  },
  container: parseContainer,
};
