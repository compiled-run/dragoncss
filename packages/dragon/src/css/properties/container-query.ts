// css-conditional-5 §3: container-type (initial normal) and container-name (none), not inherited, and the container shorthand,
// <'container-name'> [ / <'container-type'> ]? (Chrome 145 css_properties.json5). Dragon has no @container queries yet, and a
// container-type other than normal applies size or inline-size containment to the box, so it accepts the initial values alone,
// where no box is a query container, and refuses every other value (analysis/scroll-containment.ts checkContainerQuery). Rows are
// proven by the computed value, as no layout lane reads them.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import type { InitialOnlyParser } from './initial-only.ts';
import { initialOnlyLonghand, kwInitial, nonInitial, spellsInitial } from './initial-only.ts';

export const CONTAINER_QUERY_LONGHANDS = ['container-name', 'container-type'] as const;
export const CONTAINER_QUERY_SHORTHANDS = ['container'] as const;
export const CONTAINER_QUERY_INHERITED: readonly (typeof CONTAINER_QUERY_LONGHANDS)[number][] = [];
export const CONTAINER_QUERY_CONTAINER: readonly (typeof CONTAINER_QUERY_LONGHANDS)[number][] = [];
export const CONTAINER_QUERY_TEXT_ROLE: readonly (typeof CONTAINER_QUERY_LONGHANDS)[number][] = [];

type ContainerQueryLonghand = (typeof CONTAINER_QUERY_LONGHANDS)[number];

export const CONTAINER_QUERY_ASPECTS: { readonly [P in ContainerQueryLonghand]: PropertyAspect } = {
  'container-name': { layout: false, paint: true },
  'container-type': { layout: false, paint: true },
};

/** Each longhand's initial value, the only one Dragon accepts. */
export const CONTAINER_QUERY_INITIAL: { readonly [P in ContainerQueryLonghand]: CssValue } = {
  'container-name': kwInitial('none'),
  'container-type': kwInitial('normal'),
};

/** container: none, or none / normal, sets both longhands to their initial values; any other value is kept on both and refused. */
export function parseContainer(tokens: readonly CssNode[], _base: Span): ParsedValue {
  if (tokens.length === 0) return { kind: 'invalid', reason: 'container needs a value' };
  const slash = tokens[1];
  const withType = tokens.length === 3 && slash?.type === 'Operator' && String(slash['value']) === '/' && spellsInitial(CONTAINER_QUERY_INITIAL['container-type'], tokens[2]);
  const initial = spellsInitial(CONTAINER_QUERY_INITIAL['container-name'], tokens[0]) && (tokens.length === 1 || withType);
  return {
    kind: 'ok',
    longhands: [
      { property: 'container-name', value: initial ? CONTAINER_QUERY_INITIAL['container-name'] : nonInitial(tokens), explicit: true },
      { property: 'container-type', value: initial ? CONTAINER_QUERY_INITIAL['container-type'] : nonInitial(tokens), explicit: !initial || withType },
    ],
  };
}

export const CONTAINER_QUERY_VALUE_PARSERS: { readonly [P in ContainerQueryLonghand | (typeof CONTAINER_QUERY_SHORTHANDS)[number]]: InitialOnlyParser } = {
  'container-name': initialOnlyLonghand('container-name', CONTAINER_QUERY_INITIAL['container-name']),
  'container-type': initialOnlyLonghand('container-type', CONTAINER_QUERY_INITIAL['container-type']),
  container: parseContainer,
};
