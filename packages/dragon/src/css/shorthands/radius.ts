// css-backgrounds-3 §5.1: border-radius is one to four horizontal radii, then optionally "/" and one to four vertical radii, each
// list over top-left, top-right, bottom-right and bottom-left as the four sides expand (a missing vertical list copies the
// horizontal one). Its values are parsed by the paint value hook (css/paint-parsers.ts); a CSS-wide keyword sets each corner.
import type { CssNode } from 'css-tree';
import type { Span } from '../../types.ts';
import type { RadiusComponent } from '../properties/radius.ts';
import { cornerValue, RADIUS_LONGHANDS, radiusToken } from '../properties/radius.ts';
import type { LonghandValue, ParsedValue } from '../stylesheet.ts';
import type { ShorthandHandler } from './shared.ts';

const isSlash = (n: CssNode): boolean => n.type === 'Operator' && n['value'] === '/';

/** One to four values over the four corners, as css-box-4 §4 expands sides. */
function fourCorners(values: readonly RadiusComponent[]): RadiusComponent[] {
  const [tl, tr = tl, br = tl, bl = tr] = values as [RadiusComponent, RadiusComponent?, RadiusComponent?, RadiusComponent?];
  return [tl, tr as RadiusComponent, br as RadiusComponent, bl as RadiusComponent];
}

export function parseBorderRadius(tokens: readonly CssNode[], base: Span): ParsedValue {
  const slashes = tokens.filter(isSlash).length;
  if (slashes > 1) return { kind: 'invalid', reason: 'border-radius takes at most one "/"' };
  const at = tokens.findIndex(isSlash);
  const lists = at < 0 ? [tokens] : [tokens.slice(0, at), tokens.slice(at + 1)];
  const read: RadiusComponent[][] = [];
  for (const list of lists) {
    if (list.length < 1 || list.length > 4) return { kind: 'invalid', reason: 'each side of "/" in border-radius holds one to four radii' };
    const parts: RadiusComponent[] = [];
    for (const t of list) {
      const r = radiusToken('border-radius', t, base);
      if ('refused' in r) return r.refused;
      if ('invalid' in r) return { kind: 'invalid', reason: r.invalid };
      parts.push(r.ok);
    }
    read.push(parts);
  }
  const h = fourCorners(read[0] as RadiusComponent[]);
  const v = read.length === 2 ? fourCorners(read[1] as RadiusComponent[]) : h;
  const longhands: LonghandValue[] = RADIUS_LONGHANDS.map((p, i) => ({ property: p, value: cornerValue(h[i] as RadiusComponent, v[i] as RadiusComponent), explicit: true }));
  return { kind: 'ok', longhands };
}

export const RADIUS_SHORTHANDS = {
  'border-radius': {
    longhands: RADIUS_LONGHANDS,
    // A non-CSS-wide value never reaches expand: the paint value hook parses it (parseBorderRadius).
    expand: () => {
      throw new Error('border-radius values are parsed by the paint value hook (css/paint-parsers.ts)');
    },
  },
} as const satisfies { readonly [s: string]: ShorthandHandler };
