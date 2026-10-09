// SELD-R2 (notes/T064-seld-r2-spec.md R4, R5, R7, R9, R13): the interaction states of one case. :hover, :active, :focus and
// :focus-visible match against an InteractionState (match.ts). This file finds the candidates (the elements each pseudo-class is
// ever tested against, to a fixed point), builds the four dimensions (hover chains, active chains, focus with or without
// focus-visible), resolves every combination of them and stores each distinct resolution once. The combinations are a second
// level under the case's app assignment, so case keys and counts do not change; each dimension is linear in the elements.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { PROPERTY_ASPECTS } from '../css/properties.ts';
import { isAnimationProperty } from '../css/properties/animation.ts';
import type { Longhand } from '../css/properties.ts';
import type { Compound, InteractionPseudo, PseudoClass, Selector } from '../css/selectors.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { CssValue } from '../css/values.ts';
import type { CompilerFaults } from '../faults.ts';
import type { UaDataset } from '../ua/datasets.ts';
import type { Diagnostic, Origin } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import { initialValue } from './computed.ts';
import type { LinkedElement } from './link.ts';
import type { InteractionProbe, InteractionState } from './match.ts';
import { NO_INTERACTION } from './match.ts';
import type { ResolvedElement } from './resolve.ts';

/** R7: the distinct reachable interaction states one app assignment compiles; more are refused (package SELD-R2s). */
export const MAX_INTERACTION_STATES = 256;
/** The combinations of one app assignment Dragon resolves to find its distinct states; more are refused before resolving. */
export const MAX_INTERACTION_COMBINATIONS = 16 * MAX_INTERACTION_STATES;

export type InteractionKind = 'reachable' | 'forced-hover' | 'forced-active' | 'forced-focus' | 'forced-focus-visible';

/** One element forced into one interaction pseudo-class, by its address. */
export type ForcedPseudo = { readonly address: string; readonly pseudo: InteractionPseudo };

/** One interaction state of a case: the candidates that match each pseudo-class in it, in tree order. */
export type InteractionValue = {
  readonly key: string;
  readonly kind: InteractionKind;
  readonly hover: readonly string[];
  readonly active: readonly string[];
  readonly focus: string | null;
  readonly focusVisible: string | null;
  /** What CSS.forcePseudoState forces to reach the state in Chrome: a real pointer's whole chains and focus, or one element. */
  readonly force: readonly ForcedPseudo[];
};

/** One element of the case tree, in preorder: its parent and whether a tap, click or key can focus it (R9). */
export type InteractionElement = { readonly address: string; readonly parent: string | null; readonly focusable: boolean };

/** A hover or active dimension value: the matching candidates, and the first element in preorder whose chain gives them. */
export type ChainValue = { readonly set: readonly string[]; readonly target: string | null };
/** A focus dimension value: the :focus and :focus-visible candidates it matches, and the focused element. */
export type FocusValue = { readonly focus: string | null; readonly focusVisible: string | null; readonly target: string | null };

export type InteractionPartition = {
  /** The addresses each pseudo-class is tested against in some state, in tree order. */
  readonly candidates: { readonly hover: readonly string[]; readonly active: readonly string[]; readonly focus: readonly string[]; readonly focusVisible: readonly string[] };
  /** R4: each dimension's distinct values, none first. */
  readonly dimensions: { readonly hover: readonly ChainValue[]; readonly active: readonly ChainValue[]; readonly focus: readonly FocusValue[] };
  /** R5 and R7: per combination (comboIndex), the state it resolves as, or -1 for the none state. */
  readonly combos: readonly number[];
  /** Every distinct state but none: the reachable ones in combination order, then the forced ones that differ from all of them. */
  readonly states: readonly InteractionValue[];
  readonly elements: readonly InteractionElement[];
  /** Per element in preorder: the hover and active dimension values a pointer over it or pressing it gives. */
  readonly chainOf: readonly number[];
  readonly activeChainOf: readonly number[];
  /** Per element in preorder: the focus value a tap or click on it gives (R6), and keyboard focus on it (-1: not focusable; R8). */
  readonly pointerFocusOf: readonly number[];
  readonly keyboardFocusOf: readonly number[];
  /** Per element in preorder: the state a forced pseudo-class on it alone gives, or -1 for none. */
  readonly forcedHoverOf: readonly number[];
  readonly forcedActiveOf: readonly number[];
  readonly forcedFocusOf: readonly number[];
  readonly forcedFocusVisibleOf: readonly number[];
};

/** The combination index of hover value h, active value a and focus value f. */
export const comboIndex = (p: Pick<InteractionPartition, 'dimensions'>, h: number, a: number, f: number): number => (h * p.dimensions.active.length + a) * p.dimensions.focus.length + f;

/** The match state of a partition state. */
export function interactionStateOf(v: Pick<InteractionValue, 'hover' | 'active' | 'focus' | 'focusVisible'>): InteractionState {
  return { hover: new Set(v.hover), active: new Set(v.active), focus: new Set(v.focus === null ? [] : [v.focus]), focusVisible: new Set(v.focusVisible === null ? [] : [v.focusVisible]) };
}

/** HTML §2.3.4.1 rules for parsing integers, as tabindex uses them: leading ASCII whitespace, an optional sign, then digits. */
export const validTabindex = (v: string): boolean => /^[\t\n\f\r ]*[-+]?[0-9]/.test(v);

/**
 * HTML §6.6.3 focusable areas among elements: a with href, form controls, and any element with a valid tabindex; never input
 * type=hidden. R9's general display: none clause waits for FORM-a (SELD-R2 PR 2).
 */
export function isFocusable(el: LinkedElement): boolean {
  // input type=hidden is display: none in the UA sheet, so a tabindex does not make it focusable either.
  if (el.tag === 'input' && el.attributes.get('type')?.toLowerCase() === 'hidden') return false;
  const tabindex = el.attributes.get('tabindex');
  if (tabindex !== undefined && validTabindex(tabindex)) return true;
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

/** R5: a resolved tree's identity, every element's every longhand value and origin; two trees with one print lower alike. */
export function resolvedPrint(root: ResolvedElement): string {
  const out: string[] = [];
  const walk = (el: ResolvedElement): void => {
    out.push(el.element.address);
    for (const [p, v] of el.props) out.push(`${p}=${JSON.stringify(v.value)}@${v.origin}`);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out.join('\u0000');
}

/**
 * The partition of one case and each state's resolution. over: null, or why the case is refused: more than MAX_INTERACTION_STATES
 * distinct reachable states, or more than MAX_INTERACTION_COMBINATIONS combinations (count), which are not resolved.
 */
export type InteractionBuild = {
  readonly partition: InteractionPartition;
  readonly resolved: readonly ResolvedElement[];
  readonly over: null | { readonly kind: 'states' } | { readonly kind: 'combinations'; readonly count: number };
};

type MatchSets = { readonly hover: readonly string[]; readonly active: readonly string[]; readonly focus: readonly string[]; readonly focusVisible: readonly string[] };

/**
 * The partition of one case tree. resolve resolves the tree in a state with its probe recording; the candidates grow to a fixed
 * point, since a state can test elements no other state reached (".a:hover .b:hover" tests .a only once .b is hovered). Every
 * combination of the dimensions is resolved (R7: compiled in full, never composed at run time), and states that resolve alike
 * are stored once (R5). Plants: interactionRuleDropped loses the last hover candidate; comboStateDropped resolves a combination
 * of two or more dimensions as its first non-none dimension alone.
 */
export function interactionPartition(root: LinkedElement, resolve: (ix: InteractionState) => ResolvedElement, faults: Pick<CompilerFaults, 'interactionRuleDropped' | 'comboStateDropped'>): InteractionBuild {
  const nodes = preorder(root);
  const order = new Map(nodes.map((n, i) => [n.el.address, i]));
  const byOrder = (a: string, b: string): number => (order.get(a) ?? -1) - (order.get(b) ?? -1);
  const probe: InteractionProbe = { hover: new Set(), active: new Set(), focus: new Set(), focusVisible: new Set() };
  const parentOf = new Map(nodes.map((n) => [n.el.address, n.parent]));
  const chain = (address: string): string[] => {
    const out: string[] = [];
    for (let a: string | null | undefined = address; a !== null && a !== undefined; a = parentOf.get(a)) out.unshift(a);
    return out;
  };
  const focusable = nodes.map((n) => isFocusable(n.el));
  const sizes = (): number => probe.hover.size + probe.active.size + probe.focus.size + probe.focusVisible.size;
  const cache = new Map<string, { resolved: ResolvedElement; print: string }>();
  const run = (m: MatchSets): { resolved: ResolvedElement; print: string } => {
    const key = JSON.stringify([m.hover, m.active, m.focus, m.focusVisible]);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const resolved = resolve({ hover: new Set(m.hover), active: new Set(m.active), focus: new Set(m.focus), focusVisible: new Set(m.focusVisible), probe });
    const out = { resolved, print: resolvedPrint(resolved) };
    cache.set(key, out);
    return out;
  };
  const none = run({ hover: [], active: [], focus: [], focusVisible: [] });
  // Only tree elements are candidates: the modelled <head> never matches a selector a state can change.
  const inTree = (set: ReadonlySet<string>): string[] => [...set].filter((a) => order.has(a)).sort(byOrder);
  const build = (): InteractionBuild => {
    let hover = inTree(probe.hover);
    if (faults.interactionRuleDropped && hover.length > 0) hover = hover.slice(0, -1);
    const candidates = { hover, active: inTree(probe.active), focus: inTree(probe.focus), focusVisible: inTree(probe.focusVisible) };
    const chainDimension = (cands: readonly string[]): { values: ChainValue[]; of: number[] } => {
      const values: ChainValue[] = [{ set: [], target: null }];
      const at = new Map<string, number>([['[]', 0]]);
      const of = nodes.map((n) => {
        const set = chain(n.el.address).filter((a) => cands.includes(a)).sort(byOrder);
        const key = JSON.stringify(set);
        const known = at.get(key);
        if (known !== undefined) return known;
        values.push({ set, target: n.el.address });
        at.set(key, values.length - 1);
        return values.length - 1;
      });
      return { values, of };
    };
    const h = chainDimension(candidates.hover);
    const a = chainDimension(candidates.active);
    const focusValues: FocusValue[] = [{ focus: null, focusVisible: null, target: null }];
    const focusAt = new Map<string, number>([['[null,null]', 0]]);
    const focusValue = (target: string | null, visible: boolean): number => {
      if (target === null) return 0;
      const v = { focus: candidates.focus.includes(target) ? target : null, focusVisible: visible && candidates.focusVisible.includes(target) ? target : null, target };
      const key = JSON.stringify([v.focus, v.focusVisible]);
      const known = focusAt.get(key);
      if (known !== undefined) return known;
      focusValues.push(v);
      focusAt.set(key, focusValues.length - 1);
      return focusValues.length - 1;
    };
    // R6 and R8: a tap or click focuses the nearest focusable inclusive ancestor, without focus-visible; keyboard focus sets it.
    const pointerFocusOf = nodes.map((n) => {
      for (let x: string | null | undefined = n.el.address; x !== null && x !== undefined; x = parentOf.get(x)) if (focusable[order.get(x) as number]) return focusValue(x, false);
      return 0;
    });
    const keyboardFocusOf = nodes.map((n, i) => (focusable[i] ? focusValue(n.el.address, true) : -1));
    const states: InteractionValue[] = [];
    const resolved: ResolvedElement[] = [];
    const byPrint = new Map<string, number>();
    const store = (v: Omit<InteractionValue, 'key'>, r: { resolved: ResolvedElement; print: string }): number => {
      if (r.print === none.print) return -1;
      const known = byPrint.get(r.print);
      if (known !== undefined) return known;
      states.push({ key: JSON.stringify([v.hover, v.active, v.focus, v.focusVisible]), ...v });
      resolved.push(r.resolved);
      byPrint.set(r.print, states.length - 1);
      return states.length - 1;
    };
    const partition = (combos: number[], forced: { hover: number[]; active: number[]; focus: number[]; focusVisible: number[] }): InteractionPartition => ({
      candidates,
      dimensions: { hover: h.values, active: a.values, focus: focusValues },
      combos,
      states,
      elements: nodes.map((n, i) => ({ address: n.el.address, parent: n.parent, focusable: focusable[i] as boolean })),
      chainOf: h.of,
      activeChainOf: a.of,
      pointerFocusOf,
      keyboardFocusOf,
      forcedHoverOf: forced.hover,
      forcedActiveOf: forced.active,
      forcedFocusOf: forced.focus,
      forcedFocusVisibleOf: forced.focusVisible,
    });
    const combos: number[] = [];
    const count = h.values.length * a.values.length * focusValues.length;
    if (count > MAX_INTERACTION_COMBINATIONS) return { partition: partition([], { hover: [], active: [], focus: [], focusVisible: [] }), resolved, over: { kind: 'combinations', count } };
    for (let hi = 0; hi < h.values.length; hi++) {
      for (let ai = 0; ai < a.values.length; ai++) {
        for (let fi = 0; fi < focusValues.length; fi++) {
          if (hi === 0 && ai === 0 && fi === 0) {
            combos.push(-1);
            continue;
          }
          const hv = h.values[hi] as ChainValue;
          const av = a.values[ai] as ChainValue;
          const fv = focusValues[fi] as FocusValue;
          const sets: MatchSets = { hover: hv.set, active: av.set, focus: fv.focus === null ? [] : [fv.focus], focusVisible: fv.focusVisible === null ? [] : [fv.focusVisible] };
          const dims = [hi, ai, fi].filter((x) => x > 0).length;
          const used = faults.comboStateDropped && dims > 1 ? (hi > 0 ? { ...sets, active: [], focus: [], focusVisible: [] } : { ...sets, focus: [], focusVisible: [] }) : sets;
          const force: ForcedPseudo[] = [
            ...(hv.target === null ? [] : chain(hv.target).map((x) => ({ address: x, pseudo: 'hover' as const }))),
            ...(av.target === null ? [] : chain(av.target).map((x) => ({ address: x, pseudo: 'active' as const }))),
            ...(fv.target === null ? [] : [{ address: fv.target, pseudo: 'focus' as const }]),
            ...(fv.target === null || fv.focusVisible === null ? [] : [{ address: fv.target, pseudo: 'focus-visible' as const }]),
          ];
          combos.push(store({ kind: 'reachable', hover: sets.hover, active: sets.active, focus: fv.focus, focusVisible: fv.focusVisible, force }, run(used)));
          if (states.length > MAX_INTERACTION_STATES) return { partition: partition(combos, { hover: [], active: [], focus: [], focusVisible: [] }), resolved, over: { kind: 'states' } };
        }
      }
    }
    const forcedOf = (pseudo: InteractionPseudo, cands: readonly string[]): number[] =>
      nodes.map((n) => {
        const x = n.el.address;
        if (!cands.includes(x)) return -1;
        const sets: MatchSets = { hover: pseudo === 'hover' ? [x] : [], active: pseudo === 'active' ? [x] : [], focus: pseudo === 'focus' ? [x] : [], focusVisible: pseudo === 'focus-visible' ? [x] : [] };
        return store({ kind: `forced-${pseudo}`, hover: sets.hover, active: sets.active, focus: sets.focus[0] ?? null, focusVisible: sets.focusVisible[0] ?? null, force: [{ address: x, pseudo }] }, run(sets));
      });
    const forced = { hover: forcedOf('hover', candidates.hover), active: forcedOf('active', candidates.active), focus: forcedOf('focus', candidates.focus), focusVisible: forcedOf('focus-visible', candidates.focusVisible) };
    return { partition: partition(combos, forced), resolved, over: null };
  };
  for (;;) {
    const before = sizes();
    const out = build();
    if (out.over !== null || sizes() === before) return out;
  }
}

/** The match sets of one state: its candidates matching each pseudo-class. */
export type StateMatch = Pick<InteractionValue, 'hover' | 'active' | 'focus' | 'focusVisible'>;

/**
 * Every match a state stands for (R5): each reachable combination stored as it, in combination order, then the state's own value
 * when it is forced. A web condition per member keeps every collapsed combination styled.
 */
export function stateMembers(p: InteractionPartition): StateMatch[][] {
  const out: StateMatch[][] = p.states.map(() => []);
  const { hover, active, focus } = p.dimensions;
  hover.forEach((hv, h) => active.forEach((av, a) => focus.forEach((fv, f) => {
    const k = p.combos[comboIndex(p, h, a, f)];
    if (k === undefined || k < 0) return;
    (out[k] as StateMatch[]).push({ hover: hv.set, active: av.set, focus: fv.focus, focusVisible: fv.focusVisible });
  })));
  p.states.forEach((v, k) => {
    if (v.kind !== 'reachable') (out[k] as StateMatch[]).push({ hover: v.hover, active: v.active, focus: v.focus, focusVisible: v.focusVisible });
  });
  return out;
}

/** The partition of a case no interaction rule applies to: no candidates and no state but none. */
export function emptyPartition(root: LinkedElement): InteractionPartition {
  const nodes = preorder(root);
  const zero = nodes.map(() => 0);
  const minus = nodes.map(() => -1);
  return {
    candidates: { hover: [], active: [], focus: [], focusVisible: [] },
    dimensions: { hover: [{ set: [], target: null }], active: [{ set: [], target: null }], focus: [{ focus: null, focusVisible: null, target: null }] },
    combos: [-1],
    states: [],
    elements: nodes.map((n) => ({ address: n.el.address, parent: n.parent, focusable: isFocusable(n.el) })),
    chainOf: zero,
    activeChainOf: zero,
    pointerFocusOf: zero,
    keyboardFocusOf: nodes.map((n) => (isFocusable(n.el) ? 0 : -1)),
    forcedHoverOf: minus,
    forcedActiveOf: minus,
    forcedFocusOf: minus,
    forcedFocusVisibleOf: minus,
  };
}

/** The hover dimension value a real pointer at target gives (its hover chain): 0 for none, as when there is no target. */
export function chainStateOf(p: InteractionPartition, target: string | null): number {
  if (target === null) return 0;
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

/** Whether a selector tests :hover, :active, :focus or :focus-visible anywhere, arguments included. */
export function selectorIsInteractive(s: Selector): boolean {
  return s.parts.some((p) => compoundIsInteractive(p.compound));
}

/** Whether a rule only applies in some interaction state. */
export const ruleIsInteractive = (r: Rule): boolean => r.selectors.some(selectorIsInteractive);

/** The first interaction pseudo-class a rule's selectors test, in source order, arguments included. */
export function firstInteractionPseudo(r: Rule): InteractionPseudo | null {
  const inPseudo = (p: PseudoClass): InteractionPseudo | null => {
    if (p.kind === 'interaction') return p.pseudo;
    const list = p.kind === 'is' || p.kind === 'not' || p.kind === 'has' ? p.selectors : p.kind === 'nth' && p.of !== null ? p.of : [];
    for (const s of list) {
      const found = inSelector(s);
      if (found !== null) return found;
    }
    return null;
  };
  const inSelector = (s: Selector): InteractionPseudo | null => {
    for (const part of s.parts) {
      for (const p of part.compound.pseudos) {
        const found = inPseudo(p);
        if (found !== null) return found;
      }
    }
    return null;
  };
  for (const s of r.selectors) {
    const found = inSelector(s);
    if (found !== null) return found;
  }
  return null;
}

/**
 * The declarations of interaction rules Dragon cannot resolve per state. direction is resolved before the cascade (logical.ts)
 * without the interaction state. The transition and animation lists (analysis/animations.ts) cascade in the none state only, and
 * the web output writes them on the base classes alone. Either in such a rule is refused rather than compiled in the wrong state.
 */
export function interactionRefusals(rules: readonly Rule[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of rules) {
    if (!ruleIsInteractive(r)) continue;
    for (const d of r.declarations) {
      if (d.animation !== undefined || isAnimationProperty(d.property)) {
        out.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
          origin: authored(d.span),
          message: `${d.property} in a rule that tests :hover, :active, :focus or :focus-visible is not supported: transitions and animations are resolved without the interaction states (a later SELD-R2 package)`,
          manual: `Set ${d.property} in a rule without :hover, :active, :focus or :focus-visible.`,
        }));
        continue;
      }
      if (!d.longhands.some((lh) => lh.property === 'direction') && d.pending?.longhands.includes('direction') !== true) continue;
      out.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
        origin: authored(d.span),
        message: `${d.property} in a rule that tests :hover, :active, :focus or :focus-visible is not supported: direction is resolved before the interaction states`,
        manual: 'Set direction in a rule without :hover, :active, :focus or :focus-visible.',
      }));
    }
  }
  return out;
}

/**
 * Native has no interaction runtime until SELD-R2 PR 3 (rt-interaction.ts) and PR 4 (the UIKit and Android glue), and no support
 * profile row: every interaction rule is refused on each native target. lanes: the parity lanes compile the states on native to
 * prove their resolution (forced cases), so they skip this refusal.
 */
export function nativeInteractionRefusals(rules: readonly Rule[], targets: readonly ('ios' | 'android')[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const t of targets) {
    for (const r of rules) {
      const pseudo = firstInteractionPseudo(r);
      const first = r.declarations[0];
      if (pseudo === null || first === undefined) continue;
      out.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
        origin: authored(first.span),
        target: t,
        message: `:${pseudo} is not supported on ${t} yet: the native interaction runtime arrives with SELD-R2 PR 3 and PR 4`,
        manual: `Style the state with a component state and a class, or target web only, until the ${t} interaction runtime lands.`,
      }));
    }
  }
  return out;
}

/** Where a refusal about an interaction rule points: its first declaration, else the fallback. */
export const interactionRuleOrigin = (r: Rule, fallback: Origin): Origin => {
  const span = r.declarations[0]?.span;
  return span === undefined ? fallback : authored(span);
};

/** R7: the refusal of a case with more reachable interaction states than Dragon compiles (package SELD-R2s). */
export function interactionCapRefusal(caseLabel: string, over: NonNullable<InteractionBuild['over']>, rules: readonly Rule[], fallback: Origin): Diagnostic {
  const rule = rules.find(ruleIsInteractive);
  const what = over.kind === 'states' ? `more than ${MAX_INTERACTION_STATES} interaction states` : `${over.count} interaction combinations, above the ${MAX_INTERACTION_COMBINATIONS} Dragon resolves,`;
  return diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
    origin: rule === undefined ? fallback : interactionRuleOrigin(rule, fallback),
    message: `${what} in the case ${caseLabel}; at most ${MAX_INTERACTION_STATES} are compiled (package SELD-R2s)`,
    manual: 'Give fewer elements their own :hover, :active or :focus style in one component state, or move some of the styles to component states.',
  });
}

const all = (): boolean => true;
// OVFL: rt-hit clips hidden, auto, scroll and clip at the padding box. That is the hit at scroll offset 0, and native views do not
// scroll until OVFL Phase B, which adds the offsets to the hit test.
const OVERFLOW_AT_REST = new Set(['visible', 'hidden', 'clip', 'auto', 'scroll']);
const overflowAtRest = (v: CssValue): boolean => v.kind === 'keyword' && OVERFLOW_AT_REST.has(v.value);

/**
 * R13: the paint longhands Dragon's hit test (packages/layout/src/rt-hit.ts) models, each with the values it models. Box
 * geometry (every layout longhand) and pointer-events are modelled too. Every other paint longhand at any value but its
 * initial one is an unmodelled fact (fail closed): a later paint package is refused here until the hit test reads it (T146).
 * transform-origin only moves a transform, which is itself unmodelled.
 */
export const HIT_MODELLED: ReadonlyMap<Longhand, (v: CssValue) => boolean> = new Map<Longhand, (v: CssValue) => boolean>([
  ['color', all],
  ['background-color', all],
  ['border-top-style', all],
  ['border-right-style', all],
  ['border-bottom-style', all],
  ['border-left-style', all],
  ['border-top-color', all],
  ['border-right-color', all],
  ['border-bottom-color', all],
  ['border-left-color', all],
  ['overflow-x', overflowAtRest],
  ['overflow-y', overflowAtRest],
  ['transform-origin', all],
]);

/**
 * R13: the first grid container of a resolved tree whose display compiles, in preorder, or null. rt-hit.ts refuses grid containers
 * (Blink paints grid items atomically in order-modified document order, which the hit table does not model yet).
 */
export function hitUnmodelledGrid(root: ResolvedElement, compiles: (v: ResolvedValue) => boolean = () => true): string | null {
  const d = root.props.get('display');
  if (d !== undefined && d.value.kind === 'keyword' && (d.value.value === 'grid' || d.value.value === 'inline-grid') && compiles(d)) return root.element.address;
  for (const c of root.children) {
    if (c.kind !== 'element') continue;
    const found = hitUnmodelledGrid(c, compiles);
    if (found !== null) return found;
  }
  return null;
}

/** R13: the first paint fact of a resolved tree the hit test does not model and that compiles, in preorder and longhand order, or null. */
export function hitUnmodelledFact(root: ResolvedElement, ua: UaDataset, compiles: (v: ResolvedValue) => boolean = () => true): { readonly property: Longhand; readonly address: string } | null {
  const initial = new Map<Longhand, string>();
  const visit = (el: ResolvedElement): { property: Longhand; address: string } | null => {
    // An overflow value computed from its partner (computeOverflowPair) has no declaration: it compiles only when the partner does.
    const partner = (p: Longhand): ResolvedValue | undefined => (p === 'overflow-x' ? el.props.get('overflow-y') : p === 'overflow-y' ? el.props.get('overflow-x') : undefined);
    for (const [p, v] of el.props) {
      const other = partner(p);
      if (!PROPERTY_ASPECTS[p].paint || !compiles(v) || (other !== undefined && !compiles(other))) continue;
      const modelled = HIT_MODELLED.get(p);
      if (modelled !== undefined) {
        if (modelled(v.value)) continue;
        return { property: p, address: el.element.address };
      }
      let init = initial.get(p);
      if (init === undefined) {
        init = JSON.stringify(initialValue(p, ua));
        initial.set(p, init);
      }
      if (JSON.stringify(v.value) !== init) return { property: p, address: el.element.address };
    }
    for (const c of el.children) {
      if (c.kind !== 'element') continue;
      const found = visit(c);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(root);
}
