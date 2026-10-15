// The legacy display keywords Chrome 145 parses beyond css-display-3: -webkit-flex and -webkit-inline-flex compute to flex and
// inline-flex (Blink has no EDisplay of their own), and -webkit-box and -webkit-inline-box select Blink's legacy box layout, which
// the line-clamp pattern turns into flow-root and inline-block at computed-value time; analysis/line-clamp.ts refuses the rest.
import type { CssNode } from 'css-tree';
import type { Diagnostic, Span } from '../types.ts';
import { asciiLower } from './escapes.ts';
import type { CssValue } from './values.ts';

const COMPUTES_AS: ReadonlyMap<string, string> = new Map([['-webkit-flex', 'flex'], ['-webkit-inline-flex', 'inline-flex']]);
const LEGACY_BOX: ReadonlySet<string> = new Set(['-webkit-box', '-webkit-inline-box']);

export type LegacyDisplay = { readonly kind: 'value'; readonly value: CssValue } | { readonly kind: 'refused'; readonly diagnostic: Diagnostic } | null;

/** A grammar-valid display value that is one legacy keyword, as Dragon takes it; null for every other value. */
export function legacyDisplay(tokens: readonly CssNode[], _base: Span): LegacyDisplay {
  const t = tokens[0];
  if (tokens.length !== 1 || t === undefined || t.type !== 'Identifier') return null;
  const name = asciiLower(String(t['name']));
  const as = COMPUTES_AS.get(name);
  if (as !== undefined) return { kind: 'value', value: { kind: 'keyword', value: as } };
  return LEGACY_BOX.has(name) ? { kind: 'value', value: { kind: 'keyword', value: name } } : null;
}
