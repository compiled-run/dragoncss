// SELD-R2a (notes/T047-runtime-spec.md, Amendment T064J): the interaction states of one case. :hover, :focus and :focus-visible
// match against an InteractionState (match.ts); this file finds which elements those pseudo-classes are ever tested against (the
// candidates) and partitions every state Chrome can reach into the distinct sets of matching candidates: none, the hover chain
// of each hit target, a forced :hover on one element where it differs from a chain, and a forced :focus or :focus-visible. The
// partition is a separate set inside each case, so case keys and counts do not change; it is linear in the elements, never 2^n.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import type { Compound, PseudoClass, Selector } from '../css/selectors.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Diagnostic, Origin } from '../types.ts';
import type { LinkedElement } from './link.ts';
import type { InteractionProbe, InteractionState } from './match.ts';
import { NO_INTERACTION } from './match.ts';

export type InteractionKind = 'hover' | 'forced-hover' | 'forced-focus' | 'forced-focus-visible';

/** One interaction state of a case: the candidates that match each pseudo-class in it, in tree order. */
export type InteractionValue = {
  readonly key: string;
  readonly kind: InteractionKind;
  readonly hover: readonly string[];
  readonly focus: string | null;
  readonly focusVisible: string | null;
};

/** One element of the case tree, in preorder: its parent and whether a tap or click can focus it (HTML §6.6.3). */
export type InteractionElement = { readonly address: string; readonly parent: string | null; readonly focusable: boolean };

export type InteractionPartition = {
  /** The addresses each pseudo-class is tested against in some state, in tree order. */
  readonly candidates: { readonly hover: readonly string[]; readonly focus: readonly string[]; readonly focusVisible: readonly string[] };
  /** Every state but none, in discovery order: the hover chains by target in preorder, then forced hover, focus, focus-visible. */
  readonly states: readonly InteractionValue[];
  readonly elements: readonly InteractionElement[];
  /** Per element in preorder: the state index the pointer over it gives (its hover chain), or -1 for none. */
  readonly chainOf: readonly number[];
  /** Per element in preorder: the state a forced :hover, :focus or :focus-visible on it alone gives, or -1 for none. */
  readonly forcedHoverOf: readonly number[];
  readonly forcedFocusOf: readonly number[];
  readonly forcedFocusVisibleOf: readonly number[];
};

export const INTERACTION_NONE = 'none';

/** The match state of a partition state. */
export function interactionStateOf(v: InteractionValue): InteractionState {
  return { hover: new Set(v.hover), focus: new Set(v.focus === null ? [] : [v.focus]), focusVisible: new Set(v.focusVisible === null ? [] : [v.focusVisible]) };
}

/** HTML §6.6.3 focusable areas among elements: a with href, form controls and any element with tabindex. */
export function isFocusable(el: LinkedElement): boolean {
  if (el.attributes.has('tabindex')) return true;
  if (el.tag === 'a') return el.attributes.has('href');
  return el.tag === 'button' || el.tag === 'input' || el.tag === 'select' || el.tag === 'textarea';
}

function preorder(root: LinkedElement): { el: LinkedElement; parent: string | null }[] {
  const out: { el: LinkedElement; parent: string | null }[] = [];
  const visit = (el: LinkedElement, parent: string | null): void => {
    out.push({ el, parent });
    for (const c of el.children) if (c.kind === 'element') visit(c, el.address);
  };
  visit(root, null);
  return out;
}

/**
 * The partition of one case tree. resolve resolves the tree in a state with its probe recording; the candidates grow to a fixed
 * point, since a state can test elements no other state reached (".a:hover .b:hover" tests .a only once .b is hovered).
 * faults.interactionRuleDropped plants a partition that loses the last hover candidate.
 */
export function interactionPartition(root: LinkedElement, resolve: (ix: InteractionState) => void, faults: Pick<CompilerFaults, 'interactionRuleDropped'>): InteractionPartition {
  const nodes = preorder(root);
  const order = new Map(nodes.map((n, i) => [n.el.address, i]));
  const byOrder = (a: string, b: string): number => (order.get(a) ?? -1) - (order.get(b) ?? -1);
  const probe: InteractionProbe = { hover: new Set(), focus: new Set(), focusVisible: new Set() };
  const parentOf = new Map(nodes.map((n) => [n.el.address, n.parent]));
  const chain = (address: string): Set<string> => {
    const out = new Set<string>();
    for (let a: string | null | undefined = address; a !== null && a !== undefined; a = parentOf.get(a)) out.add(a);
    return out;
  };
  const sizes = (): number => probe.hover.size + probe.focus.size + probe.focusVisible.size;
  const build = (): { partition: InteractionPartition; states: InteractionValue[] } => {
    // Only tree elements are candidates: the modelled <head> never matches a selector a state can change.
    let hover = [...probe.hover].filter((a) => order.has(a)).sort(byOrder);
    if (faults.interactionRuleDropped && hover.length > 0) hover = hover.slice(0, -1);
    const focus = [...probe.focus].filter((a) => order.has(a)).sort(byOrder);
    const focusVisible = [...probe.focusVisible].filter((a) => order.has(a)).sort(byOrder);
    const states: InteractionValue[] = [];
    const index = new Map<string, number>();
    const add = (v: Omit<InteractionValue, 'key'>, key: string): number => {
      const at = index.get(key);
      if (at !== undefined) return at;
      states.push({ key, ...v });
      index.set(key, states.length - 1);
      return states.length - 1;
    };
    const hoverState = (set: ReadonlySet<string>, kind: InteractionKind): number => {
      const k = hover.filter((a) => set.has(a));
      if (k.length === 0) return -1;
      const key = `hover${JSON.stringify(k)}`;
      return add({ kind: index.has(key) ? 'hover' : kind, hover: k, focus: null, focusVisible: null }, key);
    };
    const chainOf = nodes.map((n) => hoverState(chain(n.el.address), 'hover'));
    const forcedHoverOf = nodes.map((n) => hoverState(new Set([n.el.address]), 'forced-hover'));
    const forcedFocusOf = nodes.map((n) => (focus.includes(n.el.address) ? add({ kind: 'forced-focus', hover: [], focus: n.el.address, focusVisible: null }, `focus${JSON.stringify(n.el.address)}`) : -1));
    const forcedFocusVisibleOf = nodes.map((n) => (focusVisible.includes(n.el.address) ? add({ kind: 'forced-focus-visible', hover: [], focus: null, focusVisible: n.el.address }, `focus-visible${JSON.stringify(n.el.address)}`) : -1));
    const elements = nodes.map((n) => ({ address: n.el.address, parent: n.parent, focusable: isFocusable(n.el) }));
    return { partition: { candidates: { hover, focus, focusVisible }, states, elements, chainOf, forcedHoverOf, forcedFocusOf, forcedFocusVisibleOf }, states };
  };
  resolve({ ...NO_INTERACTION, probe });
  for (;;) {
    const before = sizes();
    const { partition, states } = build();
    for (const s of states) resolve({ ...interactionStateOf(s), probe });
    if (sizes() === before) return partition;
  }
}

/**
 * The refusal of a case whose pointer can give hover and focus at once: a click focuses a focusable :focus candidate, then the
 * pointer moves over a chain that matches a :hover candidate. The partition has no state for both, so the case is refused, never
 * compiled without it. Today every focusable element is refused by its tag or attribute; this keeps the rule when they are lifted.
 */
export function combinedStateRefusal(p: InteractionPartition, rules: readonly Rule[], fallback: Origin): Diagnostic | null {
  const focused = p.elements.filter((e, i) => e.focusable && (p.forcedFocusOf[i] as number) >= 0).map((e) => e.address);
  if (focused.length === 0 || !p.chainOf.some((k) => k >= 0)) return null;
  const span = rules.find((r) => ruleIsInteractive(r) && r.declarations.length > 0)?.declarations[0]?.span;
  return diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
    origin: span === undefined ? fallback : authored(span),
    message: `:focus on ${focused.join(', ')} together with :hover is not supported: a pointer can focus ${focused.length === 1 ? 'it' : 'them'} and then hover, a state Dragon does not compile`,
    manual: 'Style the focused element without :focus, or remove the :hover rules from this document.',
  });
}

/** The partition of a case no interaction rule applies to: no candidates and no state but none. */
export function emptyPartition(root: LinkedElement): InteractionPartition {
  const nodes = preorder(root);
  const none = nodes.map(() => -1);
  return {
    candidates: { hover: [], focus: [], focusVisible: [] },
    states: [],
    elements: nodes.map((n) => ({ address: n.el.address, parent: n.parent, focusable: isFocusable(n.el) })),
    chainOf: none,
    forcedHoverOf: none,
    forcedFocusOf: none,
    forcedFocusVisibleOf: none,
  };
}

/** The state a real pointer at target gives (its hover chain), or -1: no target, or a chain that matches no candidate. */
export function chainStateOf(p: InteractionPartition, target: string | null): number {
  if (target === null) return -1;
  const i = p.elements.findIndex((e) => e.address === target);
  if (i < 0) throw new Error(`no element ${target} in the interaction partition`);
  return p.chainOf[i] as number;
}

/** The nearest focusable inclusive ancestor of target, which a tap or click focuses, or null: focus is cleared. */
export function focusTargetOf(p: InteractionPartition, target: string | null): string | null {
  const byAddress = new Map(p.elements.map((e) => [e.address, e]));
  for (let a = target; a !== null;) {
    const e = byAddress.get(a);
    if (e === undefined) throw new Error(`no element ${a} in the interaction partition`);
    if (e.focusable) return a;
    a = e.parent;
  }
  return null;
}

const interactive = (p: PseudoClass): boolean =>
  p.kind === 'interaction' || ((p.kind === 'is' || p.kind === 'not' || p.kind === 'has') && p.selectors.some(selectorIsInteractive)) || (p.kind === 'nth' && p.of !== null && p.of.some(selectorIsInteractive));
const compoundIsInteractive = (c: Compound): boolean => c.pseudos.some(interactive);

/** Whether a selector tests :hover, :focus or :focus-visible anywhere, arguments included. */
export function selectorIsInteractive(s: Selector): boolean {
  return s.parts.some((p) => compoundIsInteractive(p.compound));
}

/** Whether a rule only applies in some interaction state. */
export const ruleIsInteractive = (r: Rule): boolean => r.selectors.some(selectorIsInteractive);

/**
 * The declarations of interaction rules Dragon cannot resolve per state: direction is resolved before the cascade (logical.ts)
 * without the interaction state, so a direction declaration in such a rule is refused rather than resolved in the wrong state.
 */
export function interactionRefusals(rules: readonly Rule[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of rules) {
    if (!ruleIsInteractive(r)) continue;
    for (const d of r.declarations) {
      if (!d.longhands.some((lh) => lh.property === 'direction') && d.pending?.longhands.includes('direction') !== true) continue;
      out.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
        origin: authored(d.span),
        message: `${d.property} in a rule that tests :hover, :focus or :focus-visible is not supported: direction is resolved before the interaction states`,
        manual: 'Set direction in a rule without :hover, :focus or :focus-visible.',
      }));
    }
  }
  return out;
}
