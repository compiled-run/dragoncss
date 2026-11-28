// SELD-R2 (notes/T064-seld-r2-spec.md R4, R5, R7, R9, R13): the interaction states of one case. :hover, :active, :focus and
// :focus-visible match against an InteractionState (match.ts). This file finds the candidates (the elements each pseudo-class is
// ever tested against, to a fixed point), builds the four dimensions (hover chains, active chains, focus with or without
// focus-visible), resolves every combination of them and stores each distinct resolution once. The combinations are a second
// level under the case's app assignment, so case keys and counts do not change; each dimension is linear in the elements.
import { emptyInlineBox } from './paint-values/empty-inline.ts';
import { GENERATED_TAGS, MARKER_TAG } from './elements.ts';
import { inputTypeState, isCheckboxType, isControlTag, isRadioType, isTextFieldType } from './elements/controls.ts';
import { isReplacedTag } from './elements/replaced.ts';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { PROPERTY_ASPECTS } from '../css/properties.ts';
import { isAnimationProperty } from '../css/properties/animation.ts';
import type { Longhand } from '../css/properties.ts';
import type { Compound, InteractionPseudo, PseudoClass, Selector } from '../css/selectors.ts';
import type { Rule } from '../css/stylesheet.ts';
import type { VarPart } from '../css/variables.ts';
import type { CssValue } from '../css/values.ts';
import type { CompilerFaults } from '../faults.ts';
import type { SupportProfile } from '../profiles/types.ts';
import { provenContexts } from '../profiles/types.ts';
import type { UaDataset } from '../ua/datasets.ts';
import type { Diagnostic, Origin } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import { initialValue } from './computed.ts';
import type { LinkedElement } from './link.ts';
import type { InteractionProbe, InteractionState } from './match.ts';
import type { ResolvedElement } from './resolve.ts';
import { NO_INTERACTION } from './match.ts';
import { isShared, selectPartOf, textFieldPartOf } from './resolve.ts';
import { holdsAtomicLine, lineAtomics, propagatedFrom } from './computed-checks.ts';
import { hitFactContext, hitFactOtherContext } from '../lower/paint/stacking.ts';
import { emptyClipPathValue, emptyClipRectValue } from '../css/properties/clip-hidden.ts';
import { INDIVIDUAL_TRANSFORM_TYPE, individualTransformOf, matrixParts, TRANSFORM_LIST_TYPE, transformFunctionsOf } from '../css/properties/transform.ts';
import { zIndexOf } from '../css/properties/effects.ts';

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
 * Tags Chrome 145 never focuses on their own: without a valid tabindex, contenteditable, or (for a) an href. Every other tag counts as
 * focusable, so a tag added to the supported set fails closed until it is listed here.
 */
const NEVER_FOCUSABLE: ReadonlySet<string> = new Set([
  'html', 'body', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside',
  'ul', 'ol', 'li', 'blockquote', 'figure', 'figcaption', 'address', 'hr', 'dl', 'dt', 'dd', 'center', 'fieldset', 'legend', 'form', 'span', 'a', 'label', 'br', 'img',
  'svg', 'path', 'rect', 'circle', 'b', 'strong', 'em', 'i',
]);

/**
 * HTML §6.6.3 focusable areas among elements, as Chrome 145 focuses them: a with href, an iframe (a click into it focuses it), any
 * element with a valid tabindex or a contenteditable other than false, and every tag not in NEVER_FOCUSABLE (form controls, and any
 * other tag, fail closed); never input type=hidden. A keyboard-focusable scroller depends on computed overflow (rulesMayScroll).
 * R9's general display: none clause waits for FORM-a (SELD-R2 PR 2).
 */
export function isFocusable(el: LinkedElement): boolean {
  // input type=hidden is display: none in the UA sheet, so a tabindex does not make it focusable either.
  if (el.tag === 'input' && el.attributes.get('type')?.toLowerCase() === 'hidden') return false;
  const tabindex = el.attributes.get('tabindex');
  if (tabindex !== undefined && validTabindex(tabindex)) return true;
  const editable = el.attributes.get('contenteditable');
  if (editable !== undefined && editable.trim().toLowerCase() !== 'false') return true;
  if (el.tag === 'a') return el.attributes.has('href');
  // A generated ::before, ::after or ::marker box is a pseudo-element, which nothing focuses.
  if (GENERATED_TAGS.has(el.tag) || el.tag === MARKER_TAG) return false;
  return !NEVER_FOCUSABLE.has(el.tag);
}

/** The overflow values that never make a box a scroll container, whatever the other axis computes to (css-overflow-3 §3.1). */
const NEVER_SCROLLS: ReadonlySet<string> = new Set(['visible', 'clip', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Whether a rule may make some element a scroll container with overflow auto or scroll, which Chrome 130 and later make keyboard
 * focusable when it has no focusable descendant: any overflow-x or overflow-y value but NEVER_SCROLLS (hidden on one axis computes
 * visible on the other to auto), or one set through var(). Whether the box overflows is not known statically, so this fails closed.
 */
export function rulesMayScroll(rules: readonly Rule[]): boolean {
  const scrolls = (lh: { readonly property: string; readonly value: CssValue }): boolean =>
    (lh.property === 'overflow-x' || lh.property === 'overflow-y') && !(lh.value.kind === 'keyword' && NEVER_SCROLLS.has(lh.value.value));
  return rules.some((r) => r.declarations.some((d) => d.longhands.some(scrolls) || (d.pending?.longhands ?? []).some((p) => p === 'overflow-x' || p === 'overflow-y')));
}

/**
 * Whether a state is reached only by forcing :focus or :focus-visible onto an element no key, tap or click can focus: one isFocusable
 * rejects that is no scroll container in the case or the state (Chrome 130 and later keyboard-focus a scroller). Nothing on a phone
 * forces a state, so the native targets neither check nor lower it; the web output keeps it for a forced Chrome.
 */
export function forcedOnlyFocus(v: InteractionValue, p: InteractionPartition, trees: readonly ResolvedElement[]): boolean {
  if (v.kind !== 'forced-focus' && v.kind !== 'forced-focus-visible') return false;
  const address = v.force[0]?.address;
  if (address === undefined || p.elements.find((e) => e.address === address)?.focusable !== false) return false;
  return !trees.some((t) => mayScrollAt(t, address));
}

function mayScrollAt(root: ResolvedElement, address: string): boolean {
  if (root.element.address === address) {
    const axis = (prop: 'overflow-x' | 'overflow-y'): boolean => {
      const v = (root.props.get(prop) as ResolvedValue | undefined)?.value;
      return v === undefined || v.kind !== 'keyword' || !NEVER_SCROLLS.has(v.value);
    };
    return axis('overflow-x') || axis('overflow-y');
  }
  return root.children.some((c) => c.kind === 'element' && mayScrollAt(c, address));
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
    if (el.props.size > 0) out.push(propsPrint(el.props));
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
  return out.join('\u0000');
}

const PRINTS = new WeakMap<ReadonlyMap<Longhand, ResolvedValue>, string>();

/** One element's longhands in resolvedPrint, made once for shared longhands. */
function propsPrint(props: ReadonlyMap<Longhand, ResolvedValue>): string {
  const known = PRINTS.get(props);
  if (known !== undefined) return known;
  const out: string[] = [];
  for (const [p, v] of props) out.push(`${p}=${JSON.stringify(v.value)}@${v.origin}`);
  const print = out.join('\u0000');
  if (isShared(props)) PRINTS.set(props, print);
  return print;
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
    // R6 and R8: a tap or click focuses the nearest focusable inclusive ancestor, with focus-visible as pointerFocusVisible says; keyboard focus sets it.
    const pointerFocusOf = nodes.map((n) => {
      for (let x: string | null | undefined = n.el.address; x !== null && x !== undefined; x = parentOf.get(x)) {
        const i = order.get(x) as number;
        if (focusable[i]) return focusValue(x, pointerFocusVisible((nodes[i] as { el: LinkedElement }).el));
      }
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

/** Every interaction pseudo-class a rule's selectors test, once each, in source order, arguments included. */
export function interactionPseudosOf(r: Rule): InteractionPseudo[] {
  const out: InteractionPseudo[] = [];
  const inPseudo = (p: PseudoClass): void => {
    if (p.kind === 'interaction') {
      if (!out.includes(p.pseudo)) out.push(p.pseudo);
      return;
    }
    const list = p.kind === 'is' || p.kind === 'not' || p.kind === 'has' ? p.selectors : p.kind === 'nth' && p.of !== null ? p.of : [];
    for (const s of list) inSelector(s);
  };
  const inSelector = (s: Selector): void => {
    for (const part of s.parts) for (const p of part.compound.pseudos) inPseudo(p);
  };
  for (const s of r.selectors) inSelector(s);
  return out;
}

/** The first interaction pseudo-class a rule's selectors test, in source order, arguments included. */
export const firstInteractionPseudo = (r: Rule): InteractionPseudo | null => interactionPseudosOf(r)[0] ?? null;

/**
 * The declarations of interaction rules Dragon cannot resolve per state. direction is resolved before the cascade (logical.ts)
 * without the interaction state. The transition and animation lists (analysis/animations.ts) cascade in the none state only, and
 * the web output writes them on the base classes alone. Either in such a rule is refused rather than compiled in the wrong state.
 */
export function interactionRefusals(rules: readonly Rule[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  // ANIM-v: the custom properties a transition or animation value reads through var(), which an interaction rule may not set either.
  const names = (parts: readonly VarPart[]): string[] => parts.flatMap((p) => (p.kind === 'var' ? [p.name, ...names(p.fallback ?? [])] : []));
  const animVars = new Set(rules.flatMap((r) => r.declarations.flatMap((d) => names(d.animation?.pending?.parts ?? []))));
  for (const r of rules) {
    if (!ruleIsInteractive(r)) continue;
    for (const d of r.declarations) {
      if (d.custom !== undefined && animVars.has(d.custom.name)) {
        out.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
          origin: authored(d.span),
          message: `${d.property} in a rule that tests :hover, :active, :focus or :focus-visible is not supported: a transition or animation value reads it through var(), and those values are resolved without the interaction states (a later SELD-R2 package)`,
          manual: `Set ${d.property} in a rule without :hover, :active, :focus or :focus-visible, or write the transition or animation value without var(${d.property}).`,
        }));
        continue;
      }
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
 * Whether a tap or click that focuses el gives it :focus-visible, as Chrome 145 does for a text field and a textarea (T064 P6) and
 * a select (form-b-select-focus.test.ts); every other element gets :focus alone. The partition and the runtime both read this.
 */
export function pointerFocusVisible(el: LinkedElement): boolean {
  return el.tag === 'select' || el.tag === 'textarea' || (el.tag === 'input' && KEYBOARD_INPUT_TYPES.has(inputTypeState(el.attributes.get('type'))));
}

/** The input types a tap gives focus-visible, as for an element that may show a virtual keyboard (T064 P6). */
const KEYBOARD_INPUT_TYPES: ReadonlySet<string> = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/** SELD-R2 PR 5: the inputs an interaction row is proven for, each its own profile context interaction/<input>. */
export const INTERACTION_INPUTS = ['forced-only', 'keyboard', 'mouse', 'touch'] as const;
export type InteractionInput = (typeof INTERACTION_INPUTS)[number];
export const interactionContext = (input: InteractionInput): string => `interaction/${input}`;
export const interactionRowFeature = (pseudo: InteractionPseudo): string => `selector:pseudo-class(:${pseudo})`;

/**
 * The inputs that can put an element of a document into a pseudo-class. Any element can be hovered or pressed; :focus and
 * :focus-visible need a focusable element, so with none they are reached only by forcing (forced-only), and with one a key, a click
 * or a tap reaches them (keyboard, mouse, touch).
 */
export function interactionInputs(pseudo: InteractionPseudo, focusable: boolean): readonly InteractionInput[] {
  if (pseudo === 'focus' || pseudo === 'focus-visible') return focusable ? ['keyboard', 'mouse', 'touch'] : ['forced-only'];
  return ['mouse', 'touch'];
}

/** Whether a profile proves any interaction row for a pointer (mouse or touch), so a pointer reaches a compiled state (R13). */
export const provesPointerRow = (profile: SupportProfile): boolean =>
  profile.rows.some((r) => r.status !== 'unsupported' && r.feature.startsWith('selector:pseudo-class(') && (r.context === interactionContext('mouse') || r.context === interactionContext('touch')));

/** Whether any case of a document has a focusable element; unknown cases (null) count as having one. */
export const anyFocusable = (cases: readonly { readonly root: LinkedElement }[] | null): boolean =>
  cases === null || cases.some((c) => preorder(c.root).some((n) => isFocusable(n.el)));

/** Whether an input can focus some element of a document: a focusable element in some case, or a rule that may make a scroller. */
export const focusReachable = (rules: readonly Rule[], cases: readonly { readonly root: LinkedElement }[] | null): boolean => anyFocusable(cases) || rulesMayScroll(rules);

/**
 * SELD-R2 PR 5 (seld-r2-pr5-design.md section 3): on each native target an interaction rule compiles only where the profile proves
 * each of its pseudo-classes, in context interaction/<input>, for every input that can reach that state in the document's cases;
 * otherwise it is refused, naming the missing rows. profileOf null (a derive compile) reads no profile, so every rule is refused.
 */
export function gateInteractionFeatures(rules: readonly Rule[], cases: readonly { readonly root: LinkedElement }[] | null, targets: readonly ('ios' | 'android')[], profileOf: ((t: 'ios' | 'android') => SupportProfile) | null, faults: Pick<CompilerFaults, 'interactionRowIgnored'>): Diagnostic[] {
  const out: Diagnostic[] = [];
  const focusable = focusReachable(rules, cases);
  for (const t of targets) {
    const profile = profileOf === null ? null : profileOf(t);
    for (const r of rules) {
      const pseudos = interactionPseudosOf(r);
      const first = r.declarations[0];
      if (pseudos.length === 0 || first === undefined) continue;
      const keys = pseudos.flatMap((p) => interactionInputs(p, focusable).map((i) => ({ feature: interactionRowFeature(p), context: interactionContext(i) })));
      const missing = keys.filter((k) => profile === null || !provenContexts(profile, k.feature).includes(k.context));
      if (missing.length === 0 || faults.interactionRowIgnored) continue;
      const where = profile === null ? 'a derive compile reads no support profile' : `support profile ${profile.revision}`;
      const m = missing[0] as { feature: string; context: string };
      out.push(diagnostic('DRAGON_UNSUPPORTED_SELECTOR', {
        origin: authored(first.span),
        target: t,
        message: `${pseudos.map((p) => `:${p}`).join(', ')} is not supported on ${t}: no passing device proof of ${missing.map((k) => `${k.feature} in ${k.context}`).join(', ')} (${where})`,
        manual: `Style the state with a component state and a class, or target web only, until the ${t} profile proves it.`,
        ...(profile === null ? {} : { profile: { target: t, profileRevision: profile.revision, feature: m.feature, context: m.context, status: 'unsupported' as const } }),
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
// OVFL: rt-hit clips hidden and clip at the padding box. auto and scroll are native scroll views (OVFL-B) the user scrolls, and the
// hit test does not read scroll offsets yet (OVFL-B2), so they are unmodelled facts.
const OVERFLOW_AT_REST = new Set(['visible', 'hidden', 'clip']);
const overflowAtRest = (v: CssValue): boolean => v.kind === 'keyword' && OVERFLOW_AT_REST.has(v.value);
/** none, or translate and non-negative scale functions (no translate after a scale) with a rotate only by 0, as rt-hit.ts hitTransformRefusal models. */
export const hitModelsTransform = (v: CssValue): boolean => {
  if (v.kind === 'keyword') return v.value === 'none';
  if (v.kind !== 'other' || v.type !== TRANSFORM_LIST_TYPE) return false;
  const fs = transformFunctionsOf(v.text);
  const scaled = fs.findIndex((f) => f.kind === 'scale' && (f.sx !== 1 || f.sy !== 1));
  if (scaled >= 0 && fs.slice(scaled + 1).some((f) => f.kind === 'translate')) return false;
  return fs.every((f) => f.kind === 'translate' || (f.kind === 'scale' && f.sx >= 0 && f.sy >= 0) || (f.kind !== 'scale' && (f.kind === 'rotate' ? f.deg : matrixParts(f.values).deg) === 0));
};
/** none, or a translate: css-transforms-2 §4 applies it first, before rotate, scale and transform, so it never follows a scale. */
export const hitModelsTranslate = (v: CssValue): boolean => (v.kind === 'keyword' && v.value === 'none') || (v.kind === 'other' && v.type === INDIVIDUAL_TRANSFORM_TYPE && individualTransformOf('translate', v.text).kind === 'translate');

/**
 * R13: the paint longhands Dragon's hit test (packages/layout/src/rt-hit.ts) models, each with the values it models. Box
 * geometry (every layout longhand) and pointer-events are modelled too. Every other paint longhand at any value but its
 * initial one is an unmodelled fact (fail closed): a later paint package is refused here until the hit test reads it (T146).
 * The individual rotate and scale stay unmodelled until a Chrome capture covers them.
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
  // SELD-R2b: rt-hit.ts clips a hit to the rounded border box, and a clipping box's in-flow content to its rounded padding edge.
  ['border-top-left-radius', all],
  ['border-top-right-radius', all],
  ['border-bottom-right-radius', all],
  ['border-bottom-left-radius', all],
  // Blink hits the border box (box-shadow is ink only); opacity, 0 too, moves no hit, and below 1 is a layer rt-hit.ts orders.
  ['box-shadow', all],
  ['opacity', all],
  // internal.ts hitFacts reads a box that is not visible as pointer-events none, as Blink's hit test does.
  ['visibility', all],
  ['transform', hitModelsTransform],
  // transform-hit-translate: the hit facts carry it as the transform's first op (elementTransformWrite).
  ['translate', hitModelsTranslate],
  // rt-hit.ts orders z-index auto, 0 and positive stacking contexts as Appendix E paints them; a negative one paints under its context's flow.
  ['z-index', (v) => (zIndexOf(v) ?? 0) >= 0],
  // css-view-transitions-2: a name only captures its box once a transition starts, and the only one that compiles is the UA
  // sheet's :root { view-transition-name: root } (scroll-containment.ts VIEW_TRANSITION), so it changes no hit.
  ['view-transition-name', all],
  // SVG-a1: the svg family paints only an <svg>'s shapes, never a box; an <svg> itself is an unmodelled fact (hitUnmodelledFact),
  // as Chrome hits its painted shapes (pointer-events: visiblePainted), which the hit test does not model yet.
  ['fill', all],
  ['stroke', all],
  ['stroke-width', all],
  ['fill-opacity', all],
  ['stroke-opacity', all],
  ['stroke-linecap', all],
  ['stroke-linejoin', all],
  ['stroke-miterlimit', all],
  ['fill-rule', all],
  ['stroke-dasharray', all],
  ['stroke-dashoffset', all],
  ['cx', all],
  ['cy', all],
  ['r', all],
  ['x', all],
  ['y', all],
  ['paint-order', all],
  ['rx', all],
  ['ry', all],
  ['vector-effect', all],
  ['clip-rule', all],
  ['marker-start', all],
  ['marker-mid', all],
  ['marker-end', all],
  ['stop-color', all],
  ['stop-opacity', all],
  ['flood-color', all],
  ['flood-opacity', all],
  ['lighting-color', all],
  ['mask-type', all],
  ['text-anchor', all],
  ['dominant-baseline', all],
  ['alignment-baseline', all],
  ['d', all],
  // SELD-R2b: Blink hit-tests a box by its border box and never by its outline, so no outline value moves a hit; the outline-*
  // fixtures in the hit lane (parity hit-report.test) match Chrome with rt-hit.ts reading no outline.
  ['outline-color', all],
  ['outline-style', all],
  ['outline-width', all],
  ['outline-offset', all],
  // MASK-CLIP-path-hidden: an empty clip or clip-path leaves its box and subtree out of the hit test (internal.ts hitFacts).
  ['clip-path', (v) => (v.kind === 'keyword' && v.value === 'none') || emptyClipPathValue(v)],
  ['clip', (v) => (v.kind === 'keyword' && v.value === 'auto') || emptyClipRectValue(v)],
  // SELD-R2b: Blink hits a replaced box by its border box (LayoutReplaced::NodeAtPoint), wherever object-fit and object-position put
  // its image; replaced-fit's hit points equal Chrome over every object-fit value and object-position form.
  ['object-fit', all],
  ['object-position', all],
]);

/** A select, text field or textarea (textFieldPartOf holds both), whose UA shadow parts Chrome retargets to it, so the hit table holds it as one box (rt-hit.ts hitControlBox). */
export function hitRetargetsParts(el: ResolvedElement): boolean {
  return selectPartOf(el)?.part === null || textFieldPartOf(el)?.part === null;
}

/**
 * FORM-a: the first form control of a resolved tree in preorder whose box the hit table does not model (rt-hit.ts hitModelsControl),
 * or null. A button, a select, a text field, a textarea, a checkbox and a radio (a plain box or a theme leaf, FORM-checkbox) are modelled;
 * a range is not (its touch, T064 P7), nor a block fieldset or any other control tag.
 */
export function hitUnmodelledControl(root: ResolvedElement): string | null {
  const tag = root.element.tag;
  if (isControlTag(tag) && tag !== 'button' && tag !== 'select' && tag !== 'textarea' && !(tag === 'input' && (isTextFieldType(root.element.attributes.get('type')) || isCheckboxType(root.element.attributes.get('type')) || isRadioType(root.element.attributes.get('type'))))) return root.element.address;
  // A block fieldset lays out as the fieldset control with its rendered legend (ios-layout.ts), which the table refuses too.
  const display = root.props.get('display');
  if (tag === 'fieldset' && display !== undefined && display.value.kind === 'keyword' && display.value.value === 'block') return root.element.address;
  for (const c of root.children) {
    if (c.kind !== 'element') continue;
    const found = hitUnmodelledControl(c);
    if (found !== null) return found;
  }
  return null;
}

/** The kinds of box hitUnmodelledBox names, with the package each waits for. */
export type HitUnmodelledBox = {
  readonly address: string;
  readonly kind: 'float' | 'inline-grid box' | 'block with percentage padding around atomic inlines' | 'atomic inline forming a stacking context' | 'inline replaced element';
  readonly pkg: 'FLT' | 'G-INL' | 'INL2a' | 'INL2c' | 'INL2d';
  /** For INL2c, what besides opacity or a transform makes the atomic inline a stacking context (stacking.ts hitFactOtherContext). */
  readonly reason?: string;
};

/**
 * The first box of a resolved tree the hit table does not model whose value compiles, in preorder, or null: a float in block flow
 * (FLT), which rt-hit.ts refuses in a block or inline-block container, and a block container of an atomic inline's line with
 * percentage padding (INL2a), whose lines rt-hit.ts places over a content box it does not resolve percentages for. No Chrome hit
 * capture has a float yet. A sticky or fixed box is hit where the layout places it at scroll offset 0 (layout.ts), as a positioned layer.
 */
export function hitUnmodelledBox(root: ResolvedElement, compiles: (v: ResolvedValue) => boolean = () => true): HitUnmodelledBox | null {
  const key = (el: ResolvedElement, p: 'display' | 'float' | 'position'): string => {
    const v = el.props.get(p);
    return v !== undefined && v.value.kind === 'keyword' ? v.value.value : '';
  };
  const percent = (v: ResolvedValue): boolean => v.value.kind === 'percentage' || (v.value.kind === 'other' && v.value.text.includes('%'));
  const visit = (el: ResolvedElement): HitUnmodelledBox | null => {
    if (holdsAtomicLine(el)) {
      for (const p of ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'] as const) {
        const v = el.props.get(p);
        if (v !== undefined && percent(v) && compiles(v)) return { address: el.element.address, kind: 'block with percentage padding around atomic inlines', pkg: 'INL2a' };
      }
    }
    for (const a of lineAtomics(el)) {
      const other = hitFactContext(a) ? hitFactOtherContext(a) : '';
      if (other !== '') return { address: a.element.address, kind: 'atomic inline forming a stacking context', pkg: 'INL2c', reason: other };
      // Only an inline <img> has a Chrome hit capture on a line (inline-replaced-img, hit-atomic-inline); an inline <svg> is refused as SVG.
      if (isReplacedTag(a.element.tag) && a.element.tag !== 'img' && a.element.tag !== 'svg') return { address: a.element.address, kind: 'inline replaced element', pkg: 'INL2d' };
    }
    const block = key(el, 'display') === 'block' || key(el, 'display') === 'inline-block';
    for (const c of el.children) {
      if (c.kind !== 'element') continue;
      const f = c.props.get('float');
      const p = c.props.get('position');
      // rt-hit.ts refuses an inline-grid as an atomic inline (G-INL); a block-level grid is hit in order-modified document order.
      const d = c.props.get('display');
      if (d !== undefined && key(c, 'display') === 'inline-grid' && compiles(d)) return { address: c.element.address, kind: 'inline-grid box', pkg: 'G-INL' };
      if (block && f !== undefined && key(c, 'float') !== 'none' && key(c, 'position') !== 'absolute' && key(c, 'position') !== 'fixed' && compiles(f)) return { address: c.element.address, kind: 'float', pkg: 'FLT' };
      const found = visit(c);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(root);
}

/** R13: the first paint fact of a resolved tree the hit test does not model and that compiles, in preorder and longhand order, or null. */
export function hitUnmodelledFact(root: ResolvedElement, ua: UaDataset, compiles: (v: ResolvedValue) => boolean = () => true): { readonly property: Longhand; readonly address: string } | null {
  const initial = new Map<Longhand, string>();
  // css-overflow-3 §3.3: the element the viewport took its overflow from uses visible, so its overflow is no fact of its box.
  const propagated = propagatedFrom(root);
  const visit = (el: ResolvedElement): { property: Longhand; address: string } | null => {
    if (el.element.tag === 'svg') return { property: 'fill', address: el.element.address };
    if (emptyInlineBox(el)) return null;
    // An overflow value computed from its partner (computeOverflowPair) has no declaration: it compiles only when the partner does.
    const partner = (p: Longhand): ResolvedValue | undefined => (p === 'overflow-x' ? el.props.get('overflow-y') : p === 'overflow-y' ? el.props.get('overflow-x') : undefined);
    const oneBox = hitRetargetsParts(el);
    for (const [p, v] of el.props) {
      const other = partner(p);
      if (!PROPERTY_ASPECTS[p].paint || !compiles(v) || (other !== undefined && !compiles(other))) continue;
      if (other !== undefined && el === propagated) continue;
      // A control hit as one box has no content its scrolling could move, and Chrome hits its border box at any scroll offset.
      if (other !== undefined && oneBox) continue;
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
    if (oneBox) return null;
    for (const c of el.children) {
      if (c.kind !== 'element') continue;
      const found = visit(c);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(root);
}
