// line-break's legacy name (aliases.ts). Chrome 145 lists -webkit-line-break as a surrogate_for line-break, not an alias_for
// (css_properties.json5): the two share one ComputedStyle field and the later declaration wins between them in the cascade, as
// between an alias and its property, but the surrogate parses its own keywords, auto | loose | normal | strict | after-white-space.
// So -webkit-line-break: anywhere is dropped (LINE_BREAK_ALIAS_PARSERS), after-white-space, which line-break does not parse and the
// engine does not lay out, is refused (aliases.ts legacyAliasRefusal), and the other keywords parse as line-break's.
// packages/parity/test/line-break-alias.test.ts pins the parse and the cascade against Chrome. Neither is direction-aware, so Dragon
// resolves it as an alias.
import type { CssNode } from 'css-tree';
import { asciiLower } from '../escapes.ts';
import type { LINE_BREAK_LONGHANDS } from '../properties/line-break.ts';
import type { ParsedValue } from '../stylesheet.ts';

export const LINE_BREAK_ALIASES = {
  '-webkit-line-break': 'line-break',
} as const satisfies { readonly [alias: string]: (typeof LINE_BREAK_LONGHANDS)[number] };

/** -webkit-line-break: anywhere, which only line-break parses, is dropped; every other value parses as line-break's. */
function parsePrefixedLineBreak(tokens: readonly CssNode[]): ParsedValue | null {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Identifier' || asciiLower(String(t['name'])) !== 'anywhere') return null;
  return { kind: 'invalid', reason: '-webkit-line-break is one of auto, loose, normal, strict and after-white-space' };
}

/** The alias Chrome parses unlike its property, with its own value parser. */
export const LINE_BREAK_ALIAS_PARSERS: { readonly [alias in keyof typeof LINE_BREAK_ALIASES]?: (tokens: readonly CssNode[]) => ParsedValue | null } = {
  '-webkit-line-break': parsePrefixedLineBreak,
};
