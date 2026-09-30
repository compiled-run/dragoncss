// The at-rule handler registry. Every at-rule is refused today: each registered name, and any name not registered, gets the
// same DRAGON_UNSUPPORTED_AT_RULE diagnostic, and the parse driver (stylesheet.ts) then analyses the rules inside the at-rule's
// block for diagnostics only (T005 rec 3). A package that supports an at-rule replaces its entry here with its own handler.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../types.ts';
import { asciiLower } from './escapes.ts';

/** One at-rule as the driver meets it: its node, its name as written, where it sits ('the stylesheet', 'a rule block', '@media'...) and its span. */
export type AtRuleContext = { readonly node: CssNode; readonly name: string; readonly where: string; readonly span: Span };

/**
 * What a handler decides. refuse: the diagnostic is reported, the at-rule produces no rules, and its block (if any) is parsed
 * for analysis only, reported with the at-rule (EnclosedRules). It is the only outcome today.
 */
export type AtRuleOutcome = { readonly kind: 'refuse'; readonly diagnostic: Diagnostic };

export type AtRuleHandler = (at: AtRuleContext) => AtRuleOutcome;

/** The milestone-1 refusal, identical for every at-rule. */
export const refuseAtRule: AtRuleHandler = (at) => ({
  kind: 'refuse',
  diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
    origin: authored(at.span),
    message: `@${at.name} in ${at.where} is not supported in milestone 1`,
  }),
});

/**
 * The known at-rules, keyed by lowercased name, one entry each so packages that support different at-rules edit different
 * lines. An at-rule not listed here falls back to refuseAtRule too.
 */
export const AT_RULE_HANDLERS: { readonly [name: string]: AtRuleHandler } = {
  charset: refuseAtRule,
  'color-profile': refuseAtRule,
  container: refuseAtRule,
  'counter-style': refuseAtRule,
  'font-face': refuseAtRule,
  'font-feature-values': refuseAtRule,
  'font-palette-values': refuseAtRule,
  import: refuseAtRule,
  keyframes: refuseAtRule,
  layer: refuseAtRule,
  media: refuseAtRule,
  namespace: refuseAtRule,
  page: refuseAtRule,
  'position-try': refuseAtRule,
  property: refuseAtRule,
  scope: refuseAtRule,
  'starting-style': refuseAtRule,
  supports: refuseAtRule,
  'view-transition': refuseAtRule,
};

/** The handler for an at-rule name: its registered entry (names are ASCII case-insensitive), else refuseAtRule. */
export function atRuleHandler(name: string): AtRuleHandler {
  const key = asciiLower(name);
  return Object.hasOwn(AT_RULE_HANDLERS, key) ? (AT_RULE_HANDLERS[key] as AtRuleHandler) : refuseAtRule;
}

/** Runs the handler of an at-rule node. */
export function handleAtRule(at: AtRuleContext): AtRuleOutcome {
  return atRuleHandler(at.name)(at);
}
