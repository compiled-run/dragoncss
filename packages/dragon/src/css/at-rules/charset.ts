// @charset (css-syntax-3 §3.2): it only selects the encoding the stylesheet's bytes are decoded with, and Chrome 145's parser then
// drops it, so it never affects rendering on any target. Dragon receives decoded text, so it accepts exactly the UTF-8 form the
// encoding sniffer reads: `@charset "utf-8";` with the label ASCII case-insensitive, double quotes, and the rule at the very start
// of the sheet. Any other encoding (the front end may have decoded the bytes differently) and any @charset elsewhere are refused.
// Only types come from at-rules.ts, so the two modules can import each other.
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { AtRuleContext, AtRuleHandler } from '../at-rules.ts';
import { asciiLower } from '../escapes.ts';

/** The rule's source as css-syntax-3's encoding sniffer reads it: `@charset "` (lowercase), the label, then `";`. */
const SNIFFED = /^@charset "([^"]*)";$/;

// A function declaration, so at-rules.ts can register it while the two modules import each other.
export function charsetAtRule(at: AtRuleContext): ReturnType<AtRuleHandler> {
  const m = at.source === undefined ? null : SNIFFED.exec(at.source);
  const label = m === null ? null : asciiLower(m[1] as string);
  if (at.atSheetStart === true && label === 'utf-8') return { kind: 'drop' };
  const why = at.atSheetStart !== true
    ? 'it is not at the very start of the stylesheet, where the encoding sniffer reads it'
    : label === null
      ? 'it is not written as @charset "<label>"; with double quotes, as the encoding sniffer requires'
      : `its encoding ${label} is not UTF-8, so the source may have been decoded differently than Chrome decodes it`;
  return {
    kind: 'refuse',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(at.span),
      message: `@${at.name} in ${at.where} is not supported: ${why}; only @charset "utf-8"; at the start of a sheet is accepted (Chrome drops it)`,
    }),
  };
}
