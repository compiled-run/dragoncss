// @layer (css-cascade-5 §6.4), decided at build time as Chrome 145 orders cascade layers: a statement declares layers, a block
// declares one (or an anonymous one) and puts its rules in it, and the layer order is the order of first declaration, each
// layer's sublayers before its own rules, and unlayered rules after every layer. A layer declared inside @media or @supports counts
// only where the condition holds (probed in Chrome 145), so one first declared there is refused. Only types come from at-rules.ts,
// so the two modules can import each other.
import type { CssNode } from 'css-tree';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { AtRuleContext, AtRuleHandler } from '../at-rules.ts';
import { asciiLower } from '../escapes.ts';
import { CSS_WIDE } from '../values.ts';

// <layer-name> = <ident> [ '.' <ident> ]*, with no white space around the dots; Dragon reads only unescaped identifiers.
const IDENT = /^-?[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\-\u0080-\uffff]*$/;

/** The parts of one <layer-name>, or a reason it is not one Dragon reads. */
function layerName(text: string): string[] | string {
  const parts = text.split('.');
  for (const p of parts) {
    if (!IDENT.test(p)) return `"${text}" is not a layer name Dragon reads (an identifier, or identifiers joined by dots with no white space)`;
    if (CSS_WIDE.has(asciiLower(p)) || asciiLower(p) === 'default') return `"${p}" is a CSS-wide keyword or default, which Dragon does not accept as a layer name`;
  }
  return parts;
}

/**
 * A statement (@layer a, b.c;) gives every name it declares, and a block gives its one name, or none for an anonymous layer;
 * anything else is refused. The parse driver places the names and checks the enclosing context.
 */
export function layerAtRule(at: AtRuleContext): ReturnType<AtRuleHandler> {
  const block = at.node['block'] as CssNode | null | undefined;
  const hasBlock = block !== null && block !== undefined;
  const prelude = (at.prelude ?? '').trim();
  const refuse = (why: string): ReturnType<AtRuleHandler> => ({ kind: 'refuse', diagnostic: diagnostic('DRAGON_UNSUPPORTED_AT_RULE', { origin: authored(at.span), message: `@${at.name}${prelude === '' ? '' : ` ${prelude}`} in ${at.where} is not supported: ${why}` }) });
  if (at.where === 'a rule block') return refuse('@layer nested in a style rule is not built yet');
  if (prelude === '') return hasBlock ? { kind: 'layer', names: [], block: true } : refuse('a statement must name at least one layer');
  const texts = prelude.split(',').map((t) => t.trim());
  if (hasBlock && texts.length !== 1) return refuse('a layer block takes one name, so Chrome drops the rule');
  const names: string[][] = [];
  for (const t of texts) {
    const n = layerName(t);
    if (typeof n === 'string') return refuse(n);
    names.push(n);
  }
  return { kind: 'layer', names, block: hasBlock };
}

/**
 * The cascade rank of each layer key (its dotted path; anonymous layers have unique keys) from the keys in order of first
 * declaration: sublayers before their parent's own rules, siblings in declaration order. A higher rank wins for normal
 * declarations and loses for !important ones; unlayered rules have no rank and rank above every layer.
 */
export function layerRanks(declared: readonly string[]): Map<string, number> {
  const children = new Map<string, string[]>([['', []]]);
  for (const key of declared) {
    if (children.has(key)) continue;
    children.set(key, []);
    const dot = key.lastIndexOf('.');
    const parent = dot < 0 ? '' : key.slice(0, dot);
    const siblings = children.get(parent);
    if (siblings === undefined) throw new Error(`layer ${key} was declared before its parent ${parent}`);
    siblings.push(key);
  }
  const ranks = new Map<string, number>();
  const visit = (key: string): void => {
    for (const c of children.get(key) ?? []) visit(c);
    if (key !== '') ranks.set(key, ranks.size);
  };
  visit('');
  return ranks;
}
