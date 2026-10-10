// css-cascade-5 §6: the cascade of author declarations for one element. Only the author origin has declarations (user-agent
// values come from the captured dataset, computed.ts, and Chrome's UA rules for the supported tags hold no !important), so the
// order is importance, then cascade layer, then specificity, then order of appearance.
import type { Longhand } from '../css/properties.ts';
import type { GeneratedPseudo, Selector } from '../css/selectors.ts';
import type { CssValue, Declaration, Rule } from '../css/stylesheet.ts';
import type { Registrations } from '../css/at-rules/property.ts';
import { NO_REGISTRATIONS } from '../css/at-rules/property.ts';
import type { CompilerFaults } from '../faults.ts';
import type { LinkedElement } from './link.ts';
import type { Direction, DirectionContext } from './logical.ts';
import { elementDirection, hasDirectionalValues, inDirection } from './logical.ts';
import type { InteractionState } from './match.ts';
import { NO_INTERACTION, pseudoSelectorMatches, selectorMatches, specificityFor } from './match.ts';
import type { CustomProperties, SubstitutedDeclaration, Substitution, VarScope } from './variables.ts';
import { computeCustoms } from './variables.ts';

/**
 * One declared longhand value competing in the cascade, with the specificity of the selector that matched it. substitution: set by
 * the var() hook on a winner whose declaration held var() (analysis/variables.ts).
 */
export type Candidate = {
  readonly declaration: Declaration;
  readonly value: CssValue;
  readonly specificity: readonly [number, number, number];
  readonly substitution?: Substitution;
};

/**
 * css-cascade-5 §6.2-§6.5: importance (author !important over author normal), cascade layers (a later layer wins for normal
 * declarations and an earlier one for !important ones; unlayered declarations rank above every layer), specificity, then order
 * of appearance.
 */
export function beats(a: Pick<Candidate, 'declaration' | 'specificity'>, b: Pick<Candidate, 'declaration' | 'specificity'>): boolean {
  const ia = a.declaration.important === true;
  const ib = b.declaration.important === true;
  if (ia !== ib) return ia;
  const la = a.declaration.layer ?? Number.POSITIVE_INFINITY;
  const lb = b.declaration.layer ?? Number.POSITIVE_INFINITY;
  if (la !== lb) return ia ? la < lb : la > lb;
  for (let i = 0; i < 3; i++) {
    const x = a.specificity[i] as number;
    const y = b.specificity[i] as number;
    if (x !== y) return x > y;
  }
  return a.declaration.order > b.declaration.order;
}

/**
 * The cascade-group hook (css-logical-1 §4): longhands in one group (a logical property and the physical property it maps to)
 * share one cascade, so the winner of the group decides each member. It runs after the per-longhand winners of an element are
 * chosen, with every candidate that matched it, and returns the winners to use. Empty: the horizontal-tb groups are applied before
 * the per-longhand cascade (logical.ts), so it returns the winners it is given.
 */
export type CascadeGroupHook = (winners: ReadonlyMap<Longhand, Candidate>, candidates: readonly (readonly [Longhand, Candidate])[], el: LinkedElement) => ReadonlyMap<Longhand, Candidate>;

export const cascadeGroups: CascadeGroupHook = (winners) => winners;

/**
 * The cascade result of one element: each longhand's winner, every declaration that matched it, in order of appearance, and the
 * var() scope its winners substitute with (its computed custom properties).
 */
export type CascadeResult = {
  readonly winners: ReadonlyMap<Longhand, Candidate>;
  readonly matched: ReadonlyMap<Longhand, readonly Declaration[]>;
  readonly scope: VarScope;
};

/** GEN-a (notes/T151-gen-spec.md R6): the cascade of a ::before or ::after box, and its host's direction, which it takes. */
export type CascadePseudo = { readonly name: GeneratedPseudo; readonly direction: Direction };

/** css-variables-1 §3.1: a longhand of a declaration holding var() competes with this value until substitution. */
const pendingValue = (d: Declaration): CssValue => ({ kind: 'other', type: 'var()', text: d.text });

/**
 * Runs the cascade for chain's last element over every rule, in rule, selector, declaration and longhand order, in Chrome's
 * order: custom properties first (over the parent's, inherited), then direction with var() substituted, then every other
 * longhand with each flow-relative declaration mapped to the physical side of that direction.
 */
export function cascadeElement(rules: readonly Rule[], chain: readonly LinkedElement[], faults: CompilerFaults, direction: DirectionContext, inheritedCustoms: CustomProperties, ix: InteractionState = NO_INTERACTION, registered: Registrations = NO_REGISTRATIONS, pseudo: CascadePseudo | null = null): CascadeResult {
  // GEN-a: a generated box cascades only its own pseudo-element's selectors, matched on its host's chain (chain ends with the host).
  const matches = (rule: Rule, sel: Selector): boolean => (pseudo === null ? selectorMatches(rule, sel, chain, chain.length - 1, 0, faults, ix) : pseudoSelectorMatches(rule, sel, chain, pseudo.name, faults, ix));
  const customs = new Map<string, { declaration: Declaration; specificity: readonly [number, number, number] }>();
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!matches(rule, sel)) continue;
      const specificity = specificityFor(sel, faults);
      for (const d of rule.declarations) {
        if (d.custom === undefined) continue;
        const cand = { declaration: d, specificity };
        const prev = customs.get(d.custom.name);
        if (prev === undefined || beats(cand, prev)) customs.set(d.custom.name, cand);
      }
    }
  }
  const scope: VarScope = { customs: computeCustoms(new Map([...customs].map(([name, c]) => [name, c.declaration])), inheritedCustoms, registered), memo: new Map<Declaration, SubstitutedDeclaration>() };
  // css-logical-1 §4: flow-relative declarations take part as the physical longhands of the element's direction (logical.ts).
  // A generated box takes its host's direction (R6); computed-checks.ts refuses an authored direction on it.
  const own = !hasDirectionalValues(rules) ? null : pseudo !== null ? pseudo.direction : elementDirection(rules, chain, faults, direction, scope);
  const winners = new Map<Longhand, Candidate>();
  const matched = new Map<Longhand, Declaration[]>();
  const candidates: (readonly [Longhand, Candidate])[] = [];
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!matches(rule, sel)) continue;
      const specificity = specificityFor(sel, faults);
      for (const declared of rule.declarations) {
        const d = own === null ? declared : inDirection(declared, own, faults);
        const pending = (d.pending?.longhands ?? []).map((property) => ({ property, value: pendingValue(d) }));
        for (const lh of [...d.longhands, ...pending]) {
          const cand: Candidate = { declaration: d, value: lh.value, specificity };
          candidates.push([lh.property, cand]);
          const prev = winners.get(lh.property);
          if (prev === undefined || beats(cand, prev)) winners.set(lh.property, cand);
          const all = matched.get(lh.property) ?? [];
          if (!all.includes(d)) all.push(d);
          matched.set(lh.property, all);
        }
      }
    }
  }
  return {
    winners: cascadeGroups(winners, candidates, chain[chain.length - 1] as LinkedElement),
    matched,
    scope,
  };
}
