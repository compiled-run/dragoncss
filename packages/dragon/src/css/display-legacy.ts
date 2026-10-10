// The legacy display keywords Chrome 145 parses beyond css-display-3: -webkit-flex and -webkit-inline-flex compute to flex and
// inline-flex (Blink has no EDisplay of their own), and -webkit-box and -webkit-inline-box select Blink's legacy box layout.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../types.ts';
import { spanOf } from './ast.ts';
import { asciiLower } from './escapes.ts';
import type { CssValue } from './values.ts';

const COMPUTES_AS: ReadonlyMap<string, string> = new Map([['-webkit-flex', 'flex'], ['-webkit-inline-flex', 'inline-flex']]);
const LEGACY_BOX: ReadonlySet<string> = new Set(['-webkit-box', '-webkit-inline-box']);

export type LegacyDisplay = { readonly kind: 'value'; readonly value: CssValue } | { readonly kind: 'refused'; readonly diagnostic: Diagnostic } | null;

/** A grammar-valid display value that is one legacy keyword, as Dragon takes it; null for every other value. */
export function legacyDisplay(tokens: readonly CssNode[], base: Span): LegacyDisplay {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Identifier') return null;
  const name = asciiLower(String(t['name']));
  const as = COMPUTES_AS.get(name);
  if (as !== undefined) return { kind: 'value', value: { kind: 'keyword', value: as } };
  if (!LEGACY_BOX.has(name)) return null;
  return {
    kind: 'refused',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(spanOf(t, base)),
      message: `display: ${name} is unsupported: it selects Chrome's legacy -webkit-box layout, which Dragon does not lay out, line clamping with -webkit-box-orient: vertical and -webkit-line-clamp included`,
      manual: name === '-webkit-box' ? 'Use display: flex, with flex-direction and the flex properties.' : 'Use display: inline-flex, with flex-direction and the flex properties.',
    }),
  };
}
