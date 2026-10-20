// @charset (css-syntax-3 §3.2): it only selects the encoding the stylesheet's bytes are decoded with, and Chrome 145's parser then
// drops it, so it never affects rendering on any target. The encoding sniffer reads it only as `@charset "<label>";` at the very
// start of the sheet's bytes; anywhere else, and in any other form, it decodes nothing and Chrome just drops it, so Dragon drops it
// too. Dragon receives decoded text, so the one form it refuses is the sniffed one with a label other than UTF-8 (ASCII
// case-insensitive): the front end may have decoded those bytes differently than Chrome does. Only types come from at-rules.ts, so
// the two modules can import each other.
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { AtRuleContext, AtRuleHandler } from '../at-rules.ts';
import { asciiLower } from '../escapes.ts';

/** The rule's source as css-syntax-3's encoding sniffer reads it: `@charset "` (lowercase), the label, then `";`. */
const SNIFFED = /^@charset "([^"]*)";$/;

// A function declaration, so at-rules.ts can register it while the two modules import each other.
export function charsetAtRule(at: AtRuleContext): ReturnType<AtRuleHandler> {
  const m = at.atSheetStart !== true || at.source === undefined ? null : SNIFFED.exec(at.source);
  const label = m === null ? null : asciiLower(m[1] as string);
  if (label === null || label === 'utf-8') return { kind: 'drop' };
  return {
    kind: 'refuse',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(at.span),
      message: `@${at.name} in ${at.where} is not supported: its encoding ${label} is not UTF-8, so the source may have been decoded differently than Chrome decodes it; at the start of a sheet only @charset "utf-8"; is accepted (Chrome drops it)`,
    }),
  };
}
