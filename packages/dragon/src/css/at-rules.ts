// The at-rule handler registry. @font-face is accepted (fonts/wire.ts), @media is conditional (MQ-a), @container applies per
// query container (CQ, analysis/container-rules.ts), @supports is decided at build time (CASC), and @keyframes, @property and
// @layer have handlers in at-rules/ (ANIM-b1, CASC 2, CASC 3); every other at-rule is refused: each registered name, and any name
// not registered, gets the same DRAGON_UNSUPPORTED_AT_RULE diagnostic, and the parse driver (stylesheet.ts) then analyses the rules
// inside the at-rule's block for diagnostics only (T005 rec 3).
import { generate } from 'css-tree';
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { MediaCondition, MediaQueryList } from '../media/index.ts';
import { featuresOfList, parseMediaPrelude, parseMediaQueryList, refusalsOf, serialiseFeature, serialiseMediaQueryList } from '../media/index.ts';
import type { Diagnostic, Span } from '../types.ts';
import { asciiLower } from './escapes.ts';
import { charsetAtRule } from './at-rules/charset.ts';
import { keyframesAtRule } from './at-rules/keyframes.ts';
import { layerAtRule } from './at-rules/layer.ts';
import { propertyAtRule } from './at-rules/property.ts';
import { supportsAtRule } from './at-rules/supports.ts';

/**
 * One at-rule as the driver meets it: its node, its name as written, where it sits ('the stylesheet', 'a rule block',
 * '@media'...), its span, and its prelude as authored ('' when it has none; absent: generated from the node).
 */
export type AtRuleContext = {
  readonly node: CssNode;
  readonly name: string;
  readonly where: string;
  readonly span: Span;
  readonly prelude?: string;
  /** The at-rule's source text as written, and whether it starts the sheet's text (@charset reads both). */
  readonly source?: string;
  readonly atSheetStart?: boolean;
};

/** The condition of a conditional at-rule: its parsed media query list, that list serialised, and the at-rule's span. */
export type RuleCondition = { readonly list: MediaQueryList; readonly text: string; readonly span: Span };

/**
 * CQ: the condition of a @container rule: the container name it asks for (null: any query container), its size query read as a
 * media condition on the container's content-box width (only width features), the prelude serialised, and the at-rule's span.
 */
export type ContainerCondition = { readonly name: string | null; readonly list: MediaQueryList; readonly text: string; readonly span: Span };

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
  /** @property at the top level: collected for css/at-rules/property.ts parsePropertyRules (CASC 2). */
  | { readonly kind: 'property'; readonly context: AtRuleContext }
  /** @layer (CASC 3): the names a statement declares, or a block's one name (none: anonymous); the driver places them. */
  | { readonly kind: 'layer'; readonly names: readonly (readonly string[])[]; readonly block: boolean }
  | { readonly kind: 'conditional'; readonly condition: RuleCondition }
  /** CQ: @container, whose rules apply to an element only where its query container matches (analysis/container-rules.ts). */
  | { readonly kind: 'container'; readonly condition: ContainerCondition }
  /** @supports, decided at build time (at-rules/supports.ts): holds true keeps the block's rules as plain rules, false drops them. */
  | { readonly kind: 'supports'; readonly holds: boolean; readonly text: string }
  /** Accepted with no effect on any target, as Chrome drops it (@charset "utf-8";). */
  | { readonly kind: 'drop' };

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

/** The media features @media may use (MQ-a, MQ-R0, MQ-R2), as the refusal names them. */
const SUPPORTED_MEDIA_FEATURES = 'width, height, orientation, aspect-ratio, resolution, -webkit-device-pixel-ratio, pointer, any-pointer, hover, any-hover, prefers-reduced-motion and prefers-color-scheme';

/**
 * MQ-a, MQ-R0 and MQ-R2: @media whose features are all viewport features (width, height, orientation, aspect-ratio) or the
 * device features MQ-R2 reads (resolution, pointer, hover, prefers-reduced-motion, prefers-color-scheme; T067 R9) is
 * conditional. A feature that depends on the device or the user (until MQ-R3, notes/T067 §1) and a value Dragon does not
 * evaluate are refused.
 */
export const mediaAtRule: AtRuleHandler = (at) => {
  const prelude = at.node['prelude'] as CssNode | null | undefined;
  const list = at.prelude !== undefined ? parseMediaQueryList(at.prelude) : prelude === null || prelude === undefined ? parseMediaQueryList('') : parseMediaPrelude(prelude);
  const text = serialiseMediaQueryList(list);
  const refused = refusalsOf(list);
  const env = refused.filter((r) => r.reason === 'environment').map((r) => r.feature);
  const values = refused.filter((r) => r.reason === 'value').map((r) => r.feature);
  // T067 §1: MQ-R2 reads every environment feature R9 assigns it (DEVICE_FEATURES), so a refused one waits for MQ-R3.
  const why = env.length > 0
    ? `${env.join(', ')} depends on the device or the user, which Dragon does not read yet (package MQ-R3)`
    : values.length > 0 ? `${values.join(', ')} uses a value Dragon does not evaluate` : null;
  if (why === null) return { kind: 'conditional', condition: { list, text, span: at.span } };
  return {
    kind: 'refuse',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(at.span),
      message: `@media ${text} in ${at.where} is not supported: ${why}; only ${SUPPORTED_MEDIA_FEATURES} media features are supported`,
    }),
  };
};

// css-conditional-5 §3.1: a <container-name> is a <custom-ident> other than none, and, not, or and default (Blink
// ConsumeContainerName, as container-name parses it: css/properties/container-query.ts).
const NOT_CONTAINER_NAMES: ReadonlySet<string> = new Set(['none', 'and', 'not', 'or', 'default', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);
// css-syntax-3 §4.3.10: an ident starts with --, or an optional - and a name-start code point (non-ASCII included). It must end
// at whitespace or the end: `card(` is a function token, so Chrome drops `@container card(min-width: 1px)` (and Dragon refuses it).
const LEADING_NAME = /^\s*(--[A-Za-z0-9_\u0080-\uFFFF-]*|-?[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF-]*)(?=\s|$)/;
const FUNCTION_START = /^\s*(-?-?[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF-]*)\(/;
// css-syntax-3 §4.3.2: a comment is consumed with no token, so one between the name and the condition is whitespace.
const COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;

/**
 * CQ: @container [<container-name>] <container-condition>. The condition is read with the media parser (css-conditional-5 §3.2
 * shares its grammar), on a query container's content-box width: width, min-width and max-width in px, combined with and, or and
 * not. Dragon refuses height, the other size features, style() and scroll-state() queries, units other than px, a list of queries,
 * a name with no condition, and a prelude Chrome drops.
 */
export const containerAtRule: AtRuleHandler = (at) => {
  const prelude = (at.prelude ?? '').replace(COMMENT, ' ');
  const named = LEADING_NAME.exec(prelude);
  const name = named === null || named[1] === undefined || asciiLower(named[1]) === 'not' ? null : named[1];
  const rest = name === null ? prelude : prelude.slice((named as RegExpExecArray)[0].length);
  const list = parseMediaQueryList(rest);
  const why = containerQueryRefusal(name, list, rest);
  if (why === null) return { kind: 'container', condition: { name, list, text: `${name === null ? '' : `${name} `}${serialiseMediaQueryList(list)}`, span: at.span } };
  return {
    kind: 'refuse',
    diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', {
      origin: authored(at.span),
      message: `@container ${prelude.trim()} in ${at.where} is not supported: ${why}`,
    }),
  };
};

function containerQueryRefusal(name: string | null, list: MediaQueryList, rest: string): string | null {
  if (name !== null && NOT_CONTAINER_NAMES.has(asciiLower(name))) return `${name} is not a container name`;
  if (rest.trim() === '') return 'a @container rule without a size query is not supported';
  // css-syntax-3 §4.3.4: an ident followed by ( is a function token, so it is neither a name nor a query; Chrome drops the rule.
  const fn = name === null ? FUNCTION_START.exec(rest) : null;
  if (fn !== null && fn[1] !== undefined && !['style', 'scroll-state'].includes(asciiLower(fn[1]))) return `${fn[1]}( is a function token, not a container name, so Chrome drops this rule`;
  const q = list.queries[0];
  if (list.queries.length !== 1 || q === undefined || !q.valid || q.mediaType !== null || q.modifier !== null || q.condition === null) return 'only one size query in parentheses is supported';
  if (hasGeneralEnclosed(q.condition)) return 'only width queries are supported, not style() or scroll-state() queries';
  for (const f of featuresOfList(list)) {
    if (f.base !== 'width') return `${f.name} is not supported; a query container is an inline-size container, and Dragon reads only its width`;
    if (f.form === 'boolean') return `(${f.name}) without a value is not supported`;
    const lengths = [f.value, f.left?.value, f.right?.value].filter((v) => v !== null && v !== undefined);
    if (!lengths.every((v) => v.kind === 'length' && !v.length.calc && Object.keys(v.length.terms).every((u) => u === 'px'))) return `${serialiseFeature(f)} is not supported; only px lengths are`;
  }
  return null;
}

function hasGeneralEnclosed(c: MediaCondition): boolean {
  switch (c.type) {
    case 'general-enclosed':
      return true;
    case 'feature':
      return false;
    case 'parens':
      return hasGeneralEnclosed(c.condition);
    case 'not':
      return hasGeneralEnclosed(c.operand);
    default:
      return c.operands.some(hasGeneralEnclosed);
  }
}

/**
 * The known at-rules, keyed by lowercased name, one entry each so packages that support different at-rules edit different
 * lines. An at-rule not listed here falls back to refuseAtRule too.
 */
export const AT_RULE_HANDLERS: { readonly [name: string]: AtRuleHandler } = {
  '-webkit-keyframes': keyframesAtRule,
  charset: charsetAtRule,
  'color-profile': refuseAtRule,
  container: containerAtRule,
  'counter-style': refuseAtRule,
  'font-face': acceptFontFace,
  'font-feature-values': refuseAtRule,
  'font-palette-values': refuseAtRule,
  import: refuseAtRule,
  keyframes: keyframesAtRule,
  layer: layerAtRule,
  media: mediaAtRule,
  namespace: refuseAtRule,
  page: refuseAtRule,
  'position-try': refuseAtRule,
  property: propertyAtRule,
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
