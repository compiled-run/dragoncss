// css-cascade-5 §6: the cascade of author declarations for one element. Only the author origin has declarations (user-agent
// values come from the captured dataset, computed.ts), so the order is specificity, then order of appearance.
import type { Longhand } from '../css/properties.ts';
import type { CssValue, Declaration, Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { LinkedElement } from './link.ts';
import { selectorMatches, specificityFor } from './match.ts';

/** One declared longhand value competing in the cascade, with the specificity of the selector that matched it. */
export type Candidate = { readonly declaration: Declaration; readonly value: CssValue; readonly specificity: readonly [number, number, number] };

/** css-cascade-5 §6.4-§6.5: specificity, then order of appearance. */
export function beats(a: Candidate, b: Candidate): boolean {
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
 * chosen, with every candidate that matched it, and returns the winners to use. Empty today: there are no groups, so it returns
 * the winners it is given.
 */
export type CascadeGroupHook = (winners: ReadonlyMap<Longhand, Candidate>, candidates: readonly (readonly [Longhand, Candidate])[], el: LinkedElement) => ReadonlyMap<Longhand, Candidate>;

export const cascadeGroups: CascadeGroupHook = (winners) => winners;

/** The cascade result of one element: each longhand's winner, and every declaration that matched it, in order of appearance. */
export type CascadeResult = { readonly winners: ReadonlyMap<Longhand, Candidate>; readonly matched: ReadonlyMap<Longhand, readonly Declaration[]> };

/** Runs the cascade for chain's last element over every rule, in rule, selector, declaration and longhand order. */
export function cascadeElement(rules: readonly Rule[], chain: readonly LinkedElement[], faults: CompilerFaults): CascadeResult {
  const winners = new Map<Longhand, Candidate>();
  const matched = new Map<Longhand, Declaration[]>();
  const candidates: (readonly [Longhand, Candidate])[] = [];
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!selectorMatches(rule, sel, chain, chain.length - 1, 0, faults)) continue;
      for (const d of rule.declarations) {
        for (const lh of d.longhands) {
          const cand: Candidate = { declaration: d, value: lh.value, specificity: specificityFor(sel, faults) };
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
  return { winners: cascadeGroups(winners, candidates, chain[chain.length - 1] as LinkedElement), matched };
}
