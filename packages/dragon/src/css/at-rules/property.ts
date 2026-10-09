// @property (css-properties-values-api-1 §3), decided at build time as Chrome 145 registers it (property_registration.cc
// MaybeCreateForDeclaredProperty): a top-level rule with a valid syntax, an inherits descriptor and, unless the syntax is "*", a
// computationally independent initial value registers its name; the last valid rule for a name wins. Dragon accepts the universal
// syntax and the single types whose computed value it can write without the element (px lengths, numbers, percentages, colours);
// every other rule, including those Chrome ignores, is refused, so a registration never differs silently from Chrome's.
// Only types come from at-rules.ts, so the two modules can import each other.
import type { CssNode } from 'css-tree';
import { parse } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic, Span } from '../../types.ts';
import type { AtRuleContext, AtRuleHandler } from '../at-rules.ts';
import { list, spanOf } from '../ast.ts';
import { chromeNumber } from '../chrome-number.ts';
import { parseColorNode, serializeColor } from '../color.ts';
import { asciiLower, decodeName } from '../escapes.ts';
import { CSS_WIDE } from '../values.ts';

/** The syntaxes Dragon registers: the universal syntax and single data types with an element-independent computed value. */
export const REGISTERED_SYNTAXES = ['*', '<length>', '<number>', '<integer>', '<percentage>', '<length-percentage>', '<color>'] as const;
export type RegisteredSyntax = (typeof REGISTERED_SYNTAXES)[number];

/** One registered custom property. initial: its computed initial value, null for the guaranteed-invalid value ("*" only). */
export type Registration = { readonly name: string; readonly syntax: RegisteredSyntax; readonly inherits: boolean; readonly initial: string | null; readonly span: Span };
export type Registrations = ReadonlyMap<string, Registration>;
export const NO_REGISTRATIONS: Registrations = new Map();

/** An accepted @property as the parse driver collects it, with what its descriptors need to be located. */
export type PropertySource = { readonly context: AtRuleContext; readonly base: Span; readonly text: string };

/**
 * A value of a registered property at computed-value time: ok with its computed text, invalid (it does not match the syntax, so
 * the declaration is invalid at computed-value time), or refused with a reason when its computed value depends on what Dragon does
 * not resolve here (a relative unit, a math function, currentcolor) or Dragon cannot tell whether it matches.
 */
export type Computed = { readonly kind: 'ok'; readonly text: string } | { readonly kind: 'invalid' } | { readonly kind: 'refused'; readonly reason: string };

const INVALID: Computed = { kind: 'invalid' };

/** The single component value of text, or null when it holds none or more than one. */
function soleToken(text: string): CssNode | null {
  let ast: CssNode;
  try {
    ast = parse(text, { context: 'value', positions: false });
  } catch {
    return null;
  }
  const ts = list(ast, 'children').filter((n) => n.type !== 'WhiteSpace' && n.type !== 'Comment');
  return ts.length === 1 ? (ts[0] as CssNode) : null;
}

const number = (v: unknown): string => chromeNumber(Number(v));

function lengthOf(t: CssNode): Computed | null {
  if (t.type === 'Number') return Number(t['value']) === 0 ? { kind: 'ok', text: '0px' } : INVALID;
  if (t.type !== 'Dimension') return null;
  const unit = asciiLower(String(t['unit']));
  if (unit === 'px') return { kind: 'ok', text: `${number(t['value'])}px` };
  return { kind: 'refused', reason: `${String(t['value'])}${String(t['unit'])} is not a px length, which Dragon does not compute for a registered property yet` };
}

const percentageOf = (t: CssNode): Computed | null => (t.type === 'Percentage' ? { kind: 'ok', text: `${number(t['value'])}%` } : null);

/** css-properties-values-api-1 §2: the computed value of text for syntax ("*" takes any tokens as written). */
export function computeRegistered(syntax: RegisteredSyntax, text: string): Computed {
  if (syntax === '*') return { kind: 'ok', text };
  if (/var\(/i.test(text)) return { kind: 'refused', reason: 'var() in the value of a typed registered property is not substituted yet' };
  const t = soleToken(text);
  if (t === null) return INVALID;
  if ((t.type === 'Number' || t.type === 'Dimension' || t.type === 'Percentage') && !Number.isFinite(Number(t['value']))) return { kind: 'refused', reason: `${text.trim()} is out of range, and Chrome clamps it` };
  if (t.type === 'Function' && syntax !== '<color>') return { kind: 'refused', reason: `${String(t['name'])}() in the value of a ${syntax} registered property is not computed yet` };
  switch (syntax) {
    case '<length>':
      return lengthOf(t) ?? INVALID;
    case '<percentage>':
      return percentageOf(t) ?? INVALID;
    case '<length-percentage>':
      return lengthOf(t) ?? percentageOf(t) ?? INVALID;
    case '<number>':
      return t.type === 'Number' ? { kind: 'ok', text: number(t['value']) } : INVALID;
    case '<integer>':
      return t.type === 'Number' ? (/^[+-]?\d+$/.test(String(t['value'])) ? { kind: 'ok', text: String(Number(t['value'])) } : INVALID) : INVALID;
    case '<color>': {
      if (t.type !== 'Hash' && t.type !== 'Identifier' && t.type !== 'Function') return INVALID;
      const c = parseColorNode(t);
      if (!c.ok) return { kind: 'refused', reason: c.reason };
      if (c.kind === 'keyword') return c.keyword === 'transparent' ? { kind: 'ok', text: 'rgba(0, 0, 0, 0)' } : { kind: 'refused', reason: 'currentcolor in a registered <color> computes against the element, which is not built yet' };
      return { kind: 'ok', text: serializeColor(c.value) };
    }
  }
}

/** At the top level with a block, @property is collected (parsePropertyRules decides it); anywhere else it is refused. */
// A function declaration, so at-rules.ts can register it while the two modules import each other.
export function propertyAtRule(at: AtRuleContext): ReturnType<AtRuleHandler> {
  const block = at.node['block'] as CssNode | null | undefined;
  if (at.where === 'the stylesheet' && block !== null && block !== undefined) return { kind: 'property', context: at };
  const message = at.where === 'the stylesheet' ? `@${at.name} ${at.prelude ?? ''} needs a block of descriptors` : `@${at.name} in ${at.where} is not supported; register custom properties at the top level of a stylesheet`;
  return { kind: 'refuse', diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', { origin: authored(at.span), message }) };
}

/** The name of the prelude: one <custom-property-name> (a dashed ident other than "--"), or null. */
function nameOf(prelude: CssNode | null | undefined): string | null {
  const ts = prelude === null || prelude === undefined ? [] : list(prelude, 'children').filter((c) => c.type !== 'WhiteSpace');
  const t = ts[0];
  if (ts.length !== 1 || t === undefined || t.type !== 'Identifier') return null;
  const name = decodeName(String(t['name']));
  return name.startsWith('--') && name !== '--' ? name : null;
}

/**
 * The registrations of the collected @property rules, in document order, so the last valid rule for a name wins. A rule Dragon
 * cannot register as Chrome would is refused with DRAGON_UNSUPPORTED_AT_RULE and registers nothing.
 */
export function parsePropertyRules(sources: readonly PropertySource[], diagnostics: Diagnostic[]): Map<string, Registration> {
  const out = new Map<string, Registration>();
  for (const src of sources) {
    const at = src.context;
    const label = `@${at.name} ${at.prelude ?? ''}`.trim();
    const refuse = (why: string): void => {
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_AT_RULE', { origin: authored(at.span), message: `${label} is not supported: ${why}` }));
    };
    const name = nameOf(at.node['prelude'] as CssNode | null | undefined);
    if (name === null) {
      refuse('the prelude must be one custom property name, or Chrome ignores the rule');
      continue;
    }
    const descriptors = new Map<string, { node: CssNode; source: string }>();
    let bad: string | null = null;
    for (const d of list(at.node['block'] as CssNode, 'children')) {
      if (d.type === 'Raw' && /^[\s;]*$/.test(String(d['value']))) continue;
      if (d.type !== 'Declaration') {
        bad = `its block holds a ${d.type}, not only descriptors`;
        break;
      }
      if (d['important'] !== false) {
        bad = `!important on a descriptor is invalid, so Chrome drops it`;
        break;
      }
      const valueNode = d['value'] as CssNode;
      const valueSpan = spanOf(valueNode, src.base);
      const source = src.text.slice(valueSpan.start - src.base.start, valueSpan.end - src.base.start).trim();
      descriptors.set(asciiLower(decodeName(String(d['property']))), { node: valueNode, source });
    }
    if (bad !== null) {
      refuse(bad);
      continue;
    }
    const syntaxNode = descriptors.get('syntax');
    const syntaxTokens = syntaxNode === undefined ? [] : list(syntaxNode.node, 'children').filter((c) => c.type !== 'WhiteSpace');
    const syntaxString = syntaxTokens.length === 1 && syntaxTokens[0]?.type === 'String' ? String(syntaxTokens[0]['value']).trim() : null;
    if (syntaxString === null) {
      refuse('it has no syntax descriptor holding one string, so Chrome ignores the rule');
      continue;
    }
    const syntax = REGISTERED_SYNTAXES.find((s) => s === syntaxString);
    if (syntax === undefined) {
      refuse(`syntax "${syntaxString}" is not supported (supported: ${REGISTERED_SYNTAXES.map((s) => `"${s}"`).join(', ')})`);
      continue;
    }
    const inheritsNode = descriptors.get('inherits');
    const inheritsWord = inheritsNode === undefined ? null : asciiLower(inheritsNode.source);
    if (inheritsWord !== 'true' && inheritsWord !== 'false') {
      refuse('it has no inherits descriptor of true or false, so Chrome ignores the rule');
      continue;
    }
    const initialNode = descriptors.get('initial-value');
    let initial: string | null = null;
    if (initialNode !== undefined && initialNode.source === '') {
      refuse('an empty initial-value is not supported (for "*" it is an empty value, not the guaranteed-invalid value)');
      continue;
    }
    if (initialNode === undefined) {
      if (syntax !== '*') {
        refuse(`syntax "${syntax}" needs an initial-value, so Chrome ignores the rule`);
        continue;
      }
    } else {
      if (CSS_WIDE.has(asciiLower(initialNode.source))) {
        refuse(`the initial-value ${initialNode.source} is a CSS-wide keyword, which no syntax accepts, so Chrome ignores the rule`);
        continue;
      }
      if (/var\(/i.test(initialNode.source)) {
        refuse('the initial-value holds var(), which is not computationally independent, so Chrome ignores the rule');
        continue;
      }
      const c = computeRegistered(syntax, initialNode.source);
      if (c.kind === 'invalid') {
        refuse(`the initial-value ${initialNode.source} does not match syntax "${syntax}", so Chrome ignores the rule`);
        continue;
      }
      if (c.kind === 'refused') {
        refuse(`the initial-value ${initialNode.source}: ${c.reason}`);
        continue;
      }
      initial = c.text;
    }
    out.set(name, { name, syntax, inherits: inheritsWord === 'true', initial, span: at.span });
  }
  return out;
}
