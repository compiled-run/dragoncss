// Legacy property aliases: the alias_for entries of third_party/blink/renderer/core/css/css_properties.json5 at tag 145.0.7632.6
// (sha256 abdc48ff9bf1815acd8f01907eecb26cc788f44ecd6163dd9821521d815f71e3, lines 7995-8099, 9098-9110 and 9687-9963). Chrome
// resolves an alias to its property at parse time, so a declaration of either is the same declaration and the later one wins in
// the cascade. Each family's aliases live in aliases/<family>.ts, spread here one line per family, sorted by family id. An alias
// is listed only when its property is a Dragon longhand or shorthand and Chrome parses the two alike: the aliases Chrome parses
// with UseAliasParsing (css_parsing_utils.cc: -webkit-border-radius, -webkit-transform, -webkit-perspective,
// -webkit-background-*, -webkit-mask-*, -webkit-appearance) wait for their property's lane, -webkit-writing-mode is a surrogate,
// not an alias, and grid-gap, grid-row-gap and grid-column-gap are already shorthands of the grid family (properties/grid.ts).
// The animation family's targets are the transition and animation list properties, which stay out of LONGHANDS (T065 option B).
import type { Longhand, Shorthand } from './properties.ts';
import { isLonghand, isShorthand } from './properties.ts';
import type { AnimLonghand } from './properties/animation.ts';
import { isAnimationProperty } from './properties/animation.ts';
import { ANIMATION_ALIASES } from './aliases/animation.ts';
import { BOX_ALIASES } from './aliases/box.ts';
import { FLEX_ALIASES } from './aliases/flex.ts';
import { LOGICAL_ALIASES } from './aliases/logical.ts';

/** Each family's aliases, one line per family, sorted by family id (test/registry-claims.test.ts). */
export const ALIAS_FAMILIES: { readonly [family: string]: { readonly [alias: string]: Longhand | Shorthand | AnimLonghand | 'transition' | 'animation' } } = {
  animation: ANIMATION_ALIASES,
  box: BOX_ALIASES,
  flex: FLEX_ALIASES,
  logical: LOGICAL_ALIASES,
};

const ALIASES: ReadonlyMap<string, string> = new Map(Object.values(ALIAS_FAMILIES).flatMap((f) => Object.entries(f)));

if (ALIASES.size !== Object.values(ALIAS_FAMILIES).reduce((n, f) => n + Object.keys(f).length, 0)) throw new Error('an alias belongs to two families');
for (const [alias, property] of ALIASES) {
  if (isLonghand(alias) || isShorthand(alias) || isAnimationProperty(alias)) throw new Error(`${alias} is both an alias and a property`);
  if (!isLonghand(property) && !isShorthand(property) && !isAnimationProperty(property)) throw new Error(`${alias} aliases ${property}, which is not a Dragon property`);
}

/** The property a lower-cased property name stands for: its alias target, or the name itself. */
export function resolveAlias(name: string): string {
  return ALIASES.get(name) ?? name;
}
