// css-backgrounds-3 §5.1: border-radius is one to four horizontal radii, then optionally "/" and one to four vertical radii, each
// list over top-left, top-right, bottom-right and bottom-left as the four sides expand (a missing vertical list copies the
// horizontal one). -webkit-border-radius is the same but for Chrome's legacy parsing (css_parsing_utils.cc ConsumeRadii with
// use_legacy_parsing): exactly two values and no "/" mean one horizontal and one vertical radius for every corner. Their values
// are parsed by the paint value hook (css/paint-parsers.ts); a CSS-wide keyword sets each corner.
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

function parseRadii(property: 'border-radius' | '-webkit-border-radius', tokens: readonly CssNode[], base: Span): ParsedValue {
  const slashes = tokens.filter(isSlash).length;
  if (slashes > 1) return { kind: 'invalid', reason: `${property} takes at most one "/"` };
  const at = tokens.findIndex(isSlash);
  // Chrome's legacy parsing: "-webkit-border-radius: a b" is "border-radius: a / b".
  const legacy = property === '-webkit-border-radius' && at < 0 && tokens.length === 2;
  const lists = legacy ? [tokens.slice(0, 1), tokens.slice(1)] : at < 0 ? [tokens] : [tokens.slice(0, at), tokens.slice(at + 1)];
  const read: RadiusComponent[][] = [];
  for (const list of lists) {
    if (list.length < 1 || list.length > 4) return { kind: 'invalid', reason: `each side of "/" in ${property} holds one to four radii` };
    const parts: RadiusComponent[] = [];
    for (const t of list) {
      const r = radiusToken(property, t, base);
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

export const parseBorderRadius = (tokens: readonly CssNode[], base: Span): ParsedValue => parseRadii('border-radius', tokens, base);
export const parseWebkitBorderRadius = (tokens: readonly CssNode[], base: Span): ParsedValue => parseRadii('-webkit-border-radius', tokens, base);

// A non-CSS-wide value never reaches expand: the paint value hook parses it (parseBorderRadius, parseWebkitBorderRadius).
const hooked = (): never => {
  throw new Error('border-radius values are parsed by the paint value hook (css/paint-parsers.ts)');
};

export const RADIUS_SHORTHANDS = {
  'border-radius': { longhands: RADIUS_LONGHANDS, expand: hooked },
  '-webkit-border-radius': { longhands: RADIUS_LONGHANDS, expand: hooked },
} as const satisfies { readonly [s: string]: ShorthandHandler };
