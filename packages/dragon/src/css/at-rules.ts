// The at-rule handler registry. @media is conditional (MQ-a); every other at-rule is refused: each registered name, and any name
// not registered, gets the same DRAGON_UNSUPPORTED_AT_RULE diagnostic, and the parse driver (stylesheet.ts) then analyses the
// rules inside the at-rule's block for diagnostics only (T005 rec 3). A package that supports an at-rule replaces its entry here.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { MediaQueryList } from '../media/index.ts';
import { mediaAtoms, parseMediaPrelude, parseMediaQueryList, refusalsOf, serialiseMediaQueryList } from '../media/index.ts';
import type { Diagnostic, Span } from '../types.ts';

/**
 * One at-rule as the driver meets it: its node, its name as written, where it sits ('the stylesheet', 'a rule block',
 * '@media'...), its span, and its prelude as authored ('' when it has none; absent: generated from the node).
 */
export type AtRuleContext = { readonly node: CssNode; readonly name: string; readonly where: string; readonly span: Span; readonly prelude?: string };

/** The condition of a conditional at-rule: its parsed media query list, that list serialised, and the at-rule's span. */
export type RuleCondition = { readonly list: MediaQueryList; readonly text: string; readonly span: Span };

/**
 * What a handler decides. refuse: the diagnostic is reported, the at-rule produces no rules, and its block (if any) is parsed
 * for analysis only, reported with the at-rule (EnclosedRules). conditional: the rules in its block are real rules that apply
 * only where the condition holds (Rule.condition).
 */
export type AtRuleOutcome =
  | { readonly kind: 'refuse'; readonly diagnostic: Diagnostic }
  | { readonly kind: 'conditional'; readonly condition: RuleCondition };

export type AtRuleHandler = (at: AtRuleContext) => AtRuleOutcome;

/** The milestone-1 refusal, identical for every at-rule. */
export const refuseAtRule = (at: AtRuleContext): Extract<AtRuleOutcome, { kind: 'refuse' }> => ({
  kind: 'refuse',
  diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
    origin: authored(at.span),
    message: `@${at.name} in ${at.where} is not supported in milestone 1`,
  }),
});

/**
 * MQ-a: @media whose features are all width and height is conditional. A feature that depends on the device or the user, a
 * value Dragon does not evaluate, and aspect-ratio or orientation (which the band partition does not split) are refused until MQ-R.
 */
export const mediaAtRule: AtRuleHandler = (at) => {
  const prelude = at.node['prelude'] as CssNode | null | undefined;
  const list = at.prelude !== undefined ? parseMediaQueryList(at.prelude) : prelude === null || prelude === undefined ? parseMediaQueryList('') : parseMediaPrelude(prelude);
  const text = serialiseMediaQueryList(list);
  const refused = refusalsOf(list);
  const env = refused.filter((r) => r.reason === 'environment').map((r) => r.feature);
  const values = refused.filter((r) => r.reason === 'value').map((r) => r.feature);
  const atoms = mediaAtoms([list]);
  const why = env.length > 0
    ? `${env.join(', ')} depends on the device or the user`
    : values.length > 0
      ? `${values.join(', ')} uses a value Dragon does not evaluate`
      : Array.isArray(atoms) ? null : `${atoms.detail} is not a width or height feature`;
  if (why === null) return { kind: 'conditional', condition: { list, text, span: at.span } };
  return {
    kind: 'refuse',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(at.span),
      message: `@media ${text} in ${at.where} is not supported until MQ-R: ${why}; only width and height media features are supported`,
    }),
  };
};

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
  media: mediaAtRule,
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
  const key = name.toLowerCase();
  return Object.hasOwn(AT_RULE_HANDLERS, key) ? (AT_RULE_HANDLERS[key] as AtRuleHandler) : refuseAtRule;
}

/** Runs the handler of an at-rule node. */
export function handleAtRule(at: AtRuleContext): AtRuleOutcome {
  return atRuleHandler(at.name)(at);
}
