// The shorthand handler contract and the helpers the family files share. The registry is index.ts.
import type { CssNode } from 'css-tree';
import type { Diagnostic, Span } from '../../types.ts';
import type { Longhand } from '../properties.ts';
import type { LonghandValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

/**
 * How one shorthand expands. longhands: every longhand it sets, in order; a CSS-wide keyword sets each of them. expand: the
 * longhand values of a grammar-valid, non-CSS-wide value (values are its tokens, in order). refuse: an optional check run on a
 * grammar-valid, non-CSS-wide value before expansion, for values the grammar accepts but Dragon does not; it returns the
 * diagnostic, or null to accept.
 */
export type ShorthandHandler = {
  readonly longhands: readonly Longhand[];
  readonly expand: (values: readonly CssValue[]) => LonghandValue[];
  readonly refuse?: (tokens: readonly CssNode[], base: Span) => Diagnostic | null;
};

/** A longhand the author's value set. */
export const explicit = (p: Longhand, value: CssValue): LonghandValue => ({ property: p, value, explicit: true });
/** A longhand the shorthand filled with its initial value because the author omitted it. */
export const implicit = (p: Longhand, value: CssValue): LonghandValue => ({ property: p, value, explicit: false });

/** css-box-4 §4 / css-backgrounds-3 §3: one to four values over top, right, bottom and left. */
export function fourSides(names: readonly [Longhand, Longhand, Longhand, Longhand]): ShorthandHandler {
  return {
    longhands: names,
    expand: (values) => {
      const [t, r = t, b = t, l = r] = values as [CssValue, CssValue?, CssValue?, CssValue?];
      return [t, r, b, l].map((v, i) => explicit(names[i] as Longhand, v as CssValue));
    },
  };
}

/** One or two values over two longhands; the second defaults to the first. */
export function twoAxes(names: readonly [Longhand, Longhand]): ShorthandHandler {
  return {
    longhands: names,
    expand: (values) => {
      const [first, second = first] = values as [CssValue, CssValue?];
      return [explicit(names[0], first), explicit(names[1], second as CssValue)];
    },
  };
}
