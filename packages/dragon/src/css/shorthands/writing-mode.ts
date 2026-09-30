// css-writing-modes-4 §2-§3, §5.1, §9.1 in horizontal-tb (properties/writing-mode.ts): writing-mode, text-orientation and
// text-combine-upright set no longhand. writing-mode refuses every value Chrome 145 computes to a vertical mode; text-combine-upright
// refuses digits, which Chrome 145 does not parse.
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../../types.ts';
import { spanOf } from '../ast.ts';
import { HORIZONTAL_WRITING_MODES } from '../properties/writing-mode.ts';
import type { ShorthandHandler } from './shared.ts';

const HORIZONTAL: ReadonlySet<string> = new Set(HORIZONTAL_WRITING_MODES);

/**
 * A surrogate that sets nothing: a grammar-valid value is accepted or refused, and a CSS-wide keyword sets nothing either. One
 * with a refuse check also refuses a var() value (css/stylesheet.ts), which it could not check after substitution.
 */
const inert = (refuse?: (tokens: readonly CssNode[], base: Span) => Diagnostic | null): ShorthandHandler =>
  refuse === undefined ? { longhands: [], expand: () => [], expandWide: () => [] } : { longhands: [], expand: () => [], expandWide: () => [], refuse };

const writingMode = inert((tokens, base) => {
  const t = tokens[0] as CssNode;
  if (t.type === 'Identifier' && HORIZONTAL.has(String(t['name']).toLowerCase())) return null;
  return diagnostic('DRAGON_UNSUPPORTED_VALUE', {
    origin: authored(spanOf(t, base)),
    message: `writing-mode: ${generate(t)} is unsupported: Dragon lays out horizontal-tb only`,
    manual: 'Remove writing-mode, or use horizontal-tb.',
  });
});

const textCombineUpright = inert((tokens, base) => {
  const digits = tokens.find((t) => t.type === 'Identifier' && String(t['name']).toLowerCase() === 'digits');
  if (digits === undefined) return null;
  return diagnostic('DRAGON_UNSUPPORTED_VALUE', {
    origin: authored(spanOf(digits, base)),
    message: `text-combine-upright: ${tokens.map((t) => generate(t)).join(' ')} is unsupported: Chrome 145 does not parse digits`,
    manual: 'Use text-combine-upright: none or all.',
  });
});

export const WRITING_MODE_SHORTHANDS = {
  'writing-mode': writingMode,
  'text-orientation': inert(),
  'text-combine-upright': textCombineUpright,
} as const satisfies { readonly [s: string]: ShorthandHandler };
