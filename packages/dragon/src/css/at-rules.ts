// The at-rule handler registry. @font-face is accepted (fonts/wire.ts), @media is conditional (MQ-a) and @supports is decided at
// build time (CASC); every other at-rule is refused: each registered name, and any name not registered, gets the same
// DRAGON_UNSUPPORTED_AT_RULE diagnostic, and the parse driver (stylesheet.ts) then analyses the rules inside the at-rule's block for diagnostics only (T005 rec 3).
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { MediaQueryList } from '../media/index.ts';
import { featuresOfList, parseMediaPrelude, parseMediaQueryList, refusalsOf, serialiseMediaQueryList } from '../media/index.ts';
import type { Diagnostic, Span } from '../types.ts';
import { asciiLower } from './escapes.ts';
import { keyframesAtRule } from './at-rules/keyframes.ts';
import { supportsAtRule } from './at-rules/supports.ts';

/**
 * One at-rule as the driver meets it: its node, its name as written, where it sits ('the stylesheet', 'a rule block',
 * '@media'...), its span, and its prelude as authored ('' when it has none; absent: generated from the node).
 */
export type AtRuleContext = { readonly node: CssNode; readonly name: string; readonly where: string; readonly span: Span; readonly prelude?: string };

/** The condition of a conditional at-rule: its parsed media query list, that list serialised, and the at-rule's span. */
export type RuleCondition = { readonly list: MediaQueryList; readonly text: string; readonly span: Span };

/**
 * What a handler decides. refuse: the diagnostic is reported, the at-rule produces no rules, and its block (if any) is parsed
 * for analysis only, reported with the at-rule (EnclosedRules). font-face: the rule is accepted and handed to the fonts module
 * (fonts/wire.ts collectFontFaces), with no diagnostic and no enclosed rules. conditional: the rules in its block are real rules
 * that apply only where the condition holds (Rule.condition).
 */
export type AtRuleOutcome =
  | { readonly kind: 'refuse'; readonly diagnostic: Diagnostic }
  | { readonly kind: 'font-face'; readonly context: AtRuleContext }
  | { readonly kind: 'keyframes'; readonly context: AtRuleContext }
  | { readonly kind: 'conditional'; readonly condition: RuleCondition }
  /** @supports, decided at build time (at-rules/supports.ts): holds true keeps the block's rules as plain rules, false drops them. */
  | { readonly kind: 'supports'; readonly holds: boolean; readonly text: string };

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
 * css-fonts-4 §4: @font-face at the top level of a stylesheet, with no prelude and a block, is accepted. Nested in a style rule
 * Chrome ignores it; inside @media (whose rules apply per band) or @supports it is refused: fonts are not resolved per band.
 */
export const acceptFontFace: AtRuleHandler = (at) => {
  const prelude = at.node['prelude'] as CssNode | null | undefined;
  const block = at.node['block'] as CssNode | null | undefined;
  const empty = prelude === null || prelude === undefined || generate(prelude).trim() === '';
  return at.where === 'the stylesheet' && empty && block !== null && block !== undefined ? { kind: 'font-face', context: at } : refuseAtRule(at);
};

/**
 * MQ-a and MQ-R0: @media whose features are all width, height, orientation and aspect-ratio is conditional. A feature that
 * depends on the device or the user (until MQ-R2 or MQ-R3, notes/T067 §1) and a value Dragon does not evaluate are refused.
 */
export const mediaAtRule: AtRuleHandler = (at) => {
  const prelude = at.node['prelude'] as CssNode | null | undefined;
  const list = at.prelude !== undefined ? parseMediaQueryList(at.prelude) : prelude === null || prelude === undefined ? parseMediaQueryList('') : parseMediaPrelude(prelude);
  const text = serialiseMediaQueryList(list);
  const refused = refusalsOf(list);
  const env = refused.filter((r) => r.reason === 'environment').map((r) => r.feature);
  const values = refused.filter((r) => r.reason === 'value').map((r) => r.feature);
  // T067 §1: the environment features MQ-R2 reads (R9), and the rest MQ-R3 does.
  const envPackage = featuresOfList(list).every((f) => f.refused !== 'environment' || MQ_R2_FEATURES.has(f.base)) ? 'MQ-R2' : 'MQ-R3';
  const why = env.length > 0
    ? `${env.join(', ')} depends on the device or the user, which Dragon does not read yet (package ${envPackage})`
    : values.length > 0 ? `${values.join(', ')} uses a value Dragon does not evaluate` : null;
  if (why === null) return { kind: 'conditional', condition: { list, text, span: at.span } };
  return {
    kind: 'refuse',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(at.span),
      message: `@media ${text} in ${at.where} is not supported: ${why}; only width, height, orientation and aspect-ratio media features are supported`,
    }),
  };
};

/** The environment features notes/T067 R9 assigns to package MQ-R2; every other one waits for MQ-R3. */
const MQ_R2_FEATURES: ReadonlySet<string> = new Set(['prefers-color-scheme', 'prefers-reduced-motion', 'hover', 'any-hover', 'pointer', 'any-pointer', 'resolution', '-webkit-device-pixel-ratio']);

/**
 * The known at-rules, keyed by lowercased name, one entry each so packages that support different at-rules edit different
 * lines. An at-rule not listed here falls back to refuseAtRule too.
 */
export const AT_RULE_HANDLERS: { readonly [name: string]: AtRuleHandler } = {
  '-webkit-keyframes': keyframesAtRule,
  charset: refuseAtRule,
  'color-profile': refuseAtRule,
  container: refuseAtRule,
  'counter-style': refuseAtRule,
  'font-face': acceptFontFace,
  'font-feature-values': refuseAtRule,
  'font-palette-values': refuseAtRule,
  import: refuseAtRule,
  keyframes: keyframesAtRule,
  layer: refuseAtRule,
  media: mediaAtRule,
  namespace: refuseAtRule,
  page: refuseAtRule,
  'position-try': refuseAtRule,
  property: refuseAtRule,
  scope: refuseAtRule,
  'starting-style': refuseAtRule,
  supports: supportsAtRule,
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
