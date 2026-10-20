// css-fonts-4 §6.11: font-variant is normal, none, or any of the font-variant longhands' values, each group at most once, as Chrome
// 145 expands it: normal sets every longhand to normal, none sets font-variant-ligatures to none and the rest to normal, and an
// omitted longhand takes normal. The values the longhands refuse are refused here too (properties/font-variant.ts variantRefusal).
import type { CssNode } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { FontVariantLonghand } from '../properties/font-variant.ts';
import { FONT_VARIANT_LONGHANDS, variantLonghandOf, variantRefusal, variantValue } from '../properties/font-variant.ts';
import { kw } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit } from './shared.ts';

const fontVariant: ShorthandHandler = {
  longhands: FONT_VARIANT_LONGHANDS,
  refuse: (tokens, base) => variantRefusal(tokens, base, 'font-variant'),
  expand: (_values, tokens) => {
    const ks = tokens.map((t: CssNode) => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : ''));
    if (ks.length === 1 && (ks[0] === 'normal' || ks[0] === 'none')) {
      return FONT_VARIANT_LONGHANDS.map((p) => (p === 'font-variant-ligatures' ? explicit(p, kw(ks[0] as string)) : explicit(p, kw('normal'))));
    }
    return FONT_VARIANT_LONGHANDS.map((p: FontVariantLonghand) => {
      const own = ks.filter((k) => variantLonghandOf(k) === p);
      return own.length === 0 ? implicit(p, kw('normal')) : explicit(p, variantValue(p, own));
    });
  },
};

export const FONT_VARIANT_SHORTHANDS = { 'font-variant': fontVariant } as const satisfies { readonly [s: string]: ShorthandHandler };
