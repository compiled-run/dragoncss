// The font-variant longhands (css-fonts-4 §6.4-§6.10, css-fonts-4 §6.12 font-variant-emoji): font-variant-ligatures, -caps,
// -numeric, -east-asian, -alternates, -position and -emoji, each inherited with initial normal, set together by the font-variant
// shorthand (shorthands/font-variant.ts) and reset by font. Ligatures, numeric, east-asian and alternates select OpenType features of
// the used face, which Ahem has none of, so Chrome draws Ahem the same whatever they say: Dragon accepts them, computed as Chrome
// serializes them, and refuses them over text in a real face (analysis/font-variant.ts). Caps, position and emoji make Chrome
// synthesize small capitals, move glyphs or pick an emoji face; Dragon draws none of that, so a non-normal value of any of them is
// refused on every target, as are the alternates functions, which name @font-feature-values Dragon does not read.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import type { PropertyAspect } from '../properties.ts';
import type { ParsedValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';

export const FONT_VARIANT_LONGHANDS = [
  'font-variant-ligatures', 'font-variant-caps', 'font-variant-alternates', 'font-variant-numeric', 'font-variant-east-asian', 'font-variant-position', 'font-variant-emoji',
] as const;
export const FONT_VARIANT_SHORTHANDS = ['font-variant'] as const;
export const FONT_VARIANT_INHERITED: readonly FontVariantLonghand[] = [...FONT_VARIANT_LONGHANDS];
export const FONT_VARIANT_CONTAINER: readonly FontVariantLonghand[] = [];
export const FONT_VARIANT_TEXT_ROLE: readonly FontVariantLonghand[] = [...FONT_VARIANT_LONGHANDS];

export type FontVariantLonghand = (typeof FONT_VARIANT_LONGHANDS)[number];

export const FONT_VARIANT_ASPECTS: { readonly [P in FontVariantLonghand]: PropertyAspect } = {
  'font-variant-ligatures': { layout: true, paint: false },
  'font-variant-caps': { layout: true, paint: false },
  'font-variant-alternates': { layout: true, paint: false },
  'font-variant-numeric': { layout: true, paint: false },
  'font-variant-east-asian': { layout: true, paint: false },
  'font-variant-position': { layout: true, paint: false },
  'font-variant-emoji': { layout: true, paint: false },
};

/** The longhands whose non-normal values select OpenType features only (accepted over Ahem). */
export const FEATURE_VARIANTS: readonly FontVariantLonghand[] = ['font-variant-ligatures', 'font-variant-alternates', 'font-variant-numeric', 'font-variant-east-asian'];

/** The CssValue type of a multi-keyword variant value; its text is the keywords as Chrome serializes them. */
export const VARIANT_LIST = 'font-variant-list';

/** Each feature longhand's keyword groups, in the order Chrome serializes them; a value takes at most one keyword of each group. */
const GROUPS: { readonly [P in FontVariantLonghand]?: readonly (readonly string[])[] } = {
  'font-variant-ligatures': [['common-ligatures', 'no-common-ligatures'], ['discretionary-ligatures', 'no-discretionary-ligatures'], ['historical-ligatures', 'no-historical-ligatures'], ['contextual', 'no-contextual']],
  'font-variant-numeric': [['lining-nums', 'oldstyle-nums'], ['proportional-nums', 'tabular-nums'], ['diagonal-fractions', 'stacked-fractions'], ['ordinal'], ['slashed-zero']],
  'font-variant-east-asian': [['jis78', 'jis83', 'jis90', 'jis04', 'simplified', 'traditional'], ['full-width', 'proportional-width'], ['ruby']],
  'font-variant-alternates': [['historical-forms']],
};
const CAPS = ['small-caps', 'all-small-caps', 'petite-caps', 'all-petite-caps', 'unicase', 'titling-caps'];
const POSITION = ['sub', 'super'];
const EMOJI = ['text', 'emoji', 'unicode'];
const ALTERNATE_FUNCTIONS = ['stylistic', 'styleset', 'character-variant', 'swash', 'ornaments', 'annotation'];

const ident = (n: CssNode | undefined): string | null => (n !== undefined && n.type === 'Identifier' ? asciiLower(String(n['name'])) : null);

/** The longhand a keyword of the font-variant shorthand sets, or null. */
export function variantLonghandOf(k: string): FontVariantLonghand | null {
  for (const [p, groups] of Object.entries(GROUPS) as [FontVariantLonghand, readonly (readonly string[])[]][]) if (groups.some((g) => g.includes(k))) return p;
  if (CAPS.includes(k)) return 'font-variant-caps';
  if (POSITION.includes(k)) return 'font-variant-position';
  if (EMOJI.includes(k)) return 'font-variant-emoji';
  return null;
}

/** A feature longhand's keywords as Chrome computes them: one per group, in group order; normal when there are none. */
export function variantValue(property: FontVariantLonghand, keywords: readonly string[]): CssValue {
  const groups = GROUPS[property];
  if (groups === undefined || keywords.length === 0) return { kind: 'keyword', value: keywords[0] ?? 'normal' };
  const ordered = groups.flatMap((g) => keywords.filter((k) => g.includes(k)));
  return ordered.length === 1 ? { kind: 'keyword', value: ordered[0] as string } : { kind: 'other', type: VARIANT_LIST, text: ordered.join(' ') };
}

/**
 * Why a grammar-valid font-variant longhand or shorthand value is refused, as a diagnostic at the token: a non-normal caps, position
 * or emoji keyword, or an alternates function. property names the declaration.
 */
export function variantRefusal(tokens: readonly CssNode[], base: Span, property: string): ReturnType<typeof diagnostic> | null {
  for (const t of tokens) {
    const k = ident(t);
    const fn = t.type === 'Function' ? asciiLower(String(t['name'])) : null;
    let why: string | null = null;
    if (k !== null && CAPS.includes(k)) why = `${k} makes Chrome draw small or petite capitals, synthesized where the face has none, which Dragon does not draw yet`;
    else if (k !== null && POSITION.includes(k)) why = `${k} makes Chrome draw subscript or superscript glyphs, which Dragon does not draw yet`;
    else if (k !== null && EMOJI.includes(k)) why = `${k} picks the presentation of emoji characters, which Dragon does not apply yet`;
    else if (fn !== null && ALTERNATE_FUNCTIONS.includes(fn)) why = `${fn}() names a @font-feature-values alternate, which Dragon does not read`;
    if (why === null) continue;
    return diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(t, base)),
      message: `${property}: ${fn === null ? k : `${fn}()`} is unsupported: ${why}`,
      manual: `Remove ${fn === null ? k : `${fn}()`} from ${property}.`,
    });
  }
  return null;
}

function parseVariant(property: FontVariantLonghand, tokens: readonly CssNode[], base: Span): ParsedValue {
  const refused = variantRefusal(tokens, base, property);
  if (refused !== null) return { kind: 'refused', diagnostic: refused };
  const keywords = tokens.map(ident);
  if (keywords.some((k) => k === null)) return { kind: 'invalid', reason: `${property} takes keywords` };
  const ks = keywords as string[];
  const only = ks.length === 1 ? (ks[0] as string) : null;
  const value: CssValue | null = only === 'normal' || (only === 'none' && property === 'font-variant-ligatures') ? { kind: 'keyword', value: only }
    : ks.every((k) => variantLonghandOf(k) === property) ? variantValue(property, ks) : null;
  if (value === null) return { kind: 'invalid', reason: `${property} does not take ${ks.join(' ')}` };
  return { kind: 'ok', longhands: [{ property, value, explicit: true }] };
}

/** The value parsers of the font-variant family (the value hook, css/paint-parsers.ts). */
export const FONT_VARIANT_VALUE_PARSERS: { readonly [P in FontVariantLonghand]: (tokens: readonly CssNode[], base: Span) => ParsedValue } = {
  'font-variant-ligatures': (tokens, base) => parseVariant('font-variant-ligatures', tokens, base),
  'font-variant-caps': (tokens, base) => parseVariant('font-variant-caps', tokens, base),
  'font-variant-alternates': (tokens, base) => parseVariant('font-variant-alternates', tokens, base),
  'font-variant-numeric': (tokens, base) => parseVariant('font-variant-numeric', tokens, base),
  'font-variant-east-asian': (tokens, base) => parseVariant('font-variant-east-asian', tokens, base),
  'font-variant-position': (tokens, base) => parseVariant('font-variant-position', tokens, base),
  'font-variant-emoji': (tokens, base) => parseVariant('font-variant-emoji', tokens, base),
};
