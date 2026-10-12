// css-lists-3 §3.4: list-style sets list-style-position, list-style-image and list-style-type, in any order. A none sets whichever
// of image and type no other value set; a lone none sets both (the shorthand's none ambiguity rule).
import type { CssNode } from 'css-tree';
import { generate } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { spanOf } from '../ast.ts';
import { asciiLower } from '../escapes.ts';
import { counterStyleName, isImageToken, stringValue } from '../properties/lists.ts';
import type { CssValue } from '../values.ts';
import { kw } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit } from './shared.ts';

const identOf = (t: CssNode): string | null => (t.type === 'Identifier' ? asciiLower(String(t['name'])) : null);

/** The list-style-type value of a token that is neither the position, none, nor an image: a string or a counter-style name. */
function typeValue(t: CssNode): CssValue {
  if (t.type === 'String') return stringValue(String(t['value']));
  if (t.type !== 'Identifier') throw new Error(`list-style: ${generate(t)} passed the grammar as a list-style-type`);
  return counterStyleName(t);
}

const listStyle: ShorthandHandler = {
  longhands: ['list-style-position', 'list-style-image', 'list-style-type'],
  refuse: (tokens, base) => {
    // webref's <image> takes functions Chrome does not parse (element(), image()), which Chrome drops with the declaration.
    const unparsed = tokens.find((t) => t.type === 'Function' && !isImageToken(t));
    if (unparsed !== undefined) {
      return diagnostic('DRAGON_CSS_INVALID_VALUE', {
        origin: authored(spanOf(unparsed, base)),
        message: `"${generate(unparsed)}" is not a valid value for list-style: Chrome 145 parses no ${asciiLower(String(unparsed['name']))}() image`,
        manual: 'Use a value that matches the list-style grammar.',
      });
    }
    const image = tokens.find(isImageToken);
    if (image === undefined) return null;
    return diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(image, base)),
      message: `list-style: ${generate(image)} is not supported yet: images in generated content and list-style-image (GEN-d4)`,
      manual: 'Leave the image out of list-style.',
    });
  },
  expand: (_values, tokens) => {
    let position: CssValue | null = null;
    let type: CssValue | null = null;
    let nones = 0;
    for (const t of tokens) {
      const ident = identOf(t);
      // A second position keyword is a counter-style name (Chrome: list-style: inside outside has type outside).
      if ((ident === 'inside' || ident === 'outside') && position === null) position = kw(ident);
      else if (ident === 'none') nones++;
      else type = typeValue(t);
    }
    // The grammar admits at most two nones, and only one beside a type; an image is refused before expansion.
    if (nones > 0 && type === null) type = kw('none');
    return [
      position === null ? implicit('list-style-position', kw('outside')) : explicit('list-style-position', position),
      nones > 0 ? explicit('list-style-image', kw('none')) : implicit('list-style-image', kw('none')),
      type === null ? implicit('list-style-type', kw('disc')) : explicit('list-style-type', type),
    ];
  },
};

export const LISTS_SHORTHANDS = {
  'list-style': listStyle,
} as const satisfies { readonly [s: string]: ShorthandHandler };
