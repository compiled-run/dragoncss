// css-logical-1 §4: logical property groups. In horizontal-tb a flow-relative longhand and the physical longhand it maps to on
// an element share one cascade: a flow-relative declaration competes, by specificity then order of appearance, as the physical
// longhand its mapping picks for the element's own direction (css-logical-1 §3), which is what Chrome does. The parse expands a
// flow-relative declaration into one tagged physical value per direction (shorthands/logical.ts); here each declaration is
// narrowed to the values of one direction, before the per-longhand cascade.
import type { Declaration, Rule } from '../css/stylesheet.ts';
import type { CssValue } from '../css/values.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Candidate } from './cascade.ts';
import { beats } from './cascade.ts';
import { substituteVariables } from './computed.ts';
import type { LinkedElement } from './link.ts';
import { selectorMatches } from './match.ts';

export type Direction = 'ltr' | 'rtl';

/**
 * What an element's direction is when it declares none (its parent's, or the environment's at the root), and what inherit,
 * unset and revert give it (its parent's, or the root's initial-value parent at the root).
 */
export type DirectionContext = { readonly undeclared: Direction; readonly inherited: Direction };

const directional = new WeakMap<readonly Rule[], boolean>();

/** Whether any declaration of rules maps to a physical longhand by direction; without one, no element needs its direction. */
export function hasDirectionalValues(rules: readonly Rule[]): boolean {
  let known = directional.get(rules);
  if (known === undefined) {
    known = rules.some((r) => r.declarations.some((d) => d.longhands.some((lh) => lh.direction !== undefined)));
    directional.set(rules, known);
  }
  return known;
}

/**
 * css-writing-modes-4 §2.1: the computed direction of chain's last element, from its own cascade of direction (css-cascade-5
 * §6.4-§6.5, with the var() substitution hook applied) and its context. Chrome resolves direction before the logical mappings
 * that read it.
 */
export function elementDirection(rules: readonly Rule[], chain: readonly LinkedElement[], faults: CompilerFaults, context: DirectionContext): Direction {
  let winner: Candidate | undefined;
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!selectorMatches(rule, sel, chain, chain.length - 1, 0, faults)) continue;
      for (const d of rule.declarations) {
        for (const lh of d.longhands) {
          if (lh.property !== 'direction') continue;
          const cand: Candidate = { declaration: d, value: lh.value, specificity: sel.specificity };
          if (winner === undefined || beats(cand, winner)) winner = cand;
        }
      }
    }
  }
  if (winner === undefined) return context.undeclared;
  const value: CssValue = substituteVariables(winner.value, 'direction', chain[chain.length - 1] as LinkedElement);
  if (value.kind !== 'keyword') return context.inherited;
  if (value.value === 'ltr' || value.value === 'rtl') return value.value;
  // css-writing-modes-4 §2.1: the initial value is ltr; inherit, unset and revert (direction is inherited) take the parent's.
  return value.value === 'initial' ? 'ltr' : context.inherited;
}

const twins = { ltr: new WeakMap<Declaration, Declaration>(), rtl: new WeakMap<Declaration, Declaration>() };

/**
 * The declaration as it applies on an element of this direction: itself when it has no direction-tagged value, or else one twin
 * per direction (the same object for every element of that direction) holding only the values of that direction.
 */
export function inDirection(d: Declaration, direction: Direction): Declaration {
  if (!d.longhands.some((lh) => lh.direction !== undefined)) return d;
  const cache = twins[direction];
  let twin = cache.get(d);
  if (twin === undefined) {
    twin = { ...d, longhands: d.longhands.filter((lh) => lh.direction === undefined || lh.direction === direction) };
    cache.set(d, twin);
  }
  return twin;
}
