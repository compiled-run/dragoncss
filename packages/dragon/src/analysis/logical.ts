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
import { selectorMatches, specificityFor } from './match.ts';
import type { VarScope } from './variables.ts';

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
    known = rules.some((r) => r.declarations.some((d) => d.pending?.sides !== undefined || d.longhands.some((lh) => lh.direction !== undefined)));
    directional.set(rules, known);
  }
  return known;
}

/**
 * css-writing-modes-4 §2.1: the computed direction of chain's last element, from its own cascade of direction (css-cascade-5
 * §6.2-§6.5) and its context. As in Chrome, direction is resolved after the element's custom properties and before the logical
 * mappings that read it: a winner holding var() is substituted with scope first (css-variables-1 §3.1), and one invalid at
 * computed-value time behaves as unset, the parent's direction. writing-mode accepts only horizontal-tb, the only mode.
 */
export function elementDirection(rules: readonly Rule[], chain: readonly LinkedElement[], faults: CompilerFaults, context: DirectionContext, scope: VarScope): Direction {
  let winner: Candidate | undefined;
  for (const rule of rules) {
    for (const sel of rule.selectors) {
      if (!selectorMatches(rule, sel, chain, chain.length - 1, 0, faults)) continue;
      const specificity = specificityFor(sel, faults);
      for (const d of rule.declarations) {
        const values: CssValue[] = d.longhands.filter((lh) => lh.property === 'direction').map((lh) => lh.value);
        // Planted fault directionBeforeVar: a declaration holding var() is skipped, as if direction were resolved before substitution.
        if (d.pending?.longhands.includes('direction') === true && !faults.directionBeforeVar) values.push({ kind: 'other', type: 'var()', text: d.text });
        for (const value of values) {
          const cand: Candidate = { declaration: d, value, specificity };
          if (winner === undefined || beats(cand, winner)) winner = cand;
        }
      }
    }
  }
  if (winner === undefined) return context.undeclared;
  const value = substituteVariables(winner, 'direction', chain[chain.length - 1] as LinkedElement, scope).value;
  if (value.kind !== 'keyword') return context.inherited;
  if (value.value === 'ltr' || value.value === 'rtl') return value.value;
  // css-writing-modes-4 §2.1: the initial value is ltr; inherit, unset and revert (direction is inherited) take the parent's.
  return value.value === 'initial' ? 'ltr' : context.inherited;
}

const twins = { ltr: new WeakMap<Declaration, Declaration>(), rtl: new WeakMap<Declaration, Declaration>() };
const unnarrowed = new WeakMap<Declaration, Declaration>();

/**
 * The declaration as it applies on an element of this direction: itself when it has no direction-tagged value, or else one twin
 * per direction (the same object for every element of that direction) holding only the values of that direction. A declaration
 * holding var() keeps the physical longhands of that direction, and is substituted as that direction's mapping (variables.ts).
 */
export function inDirection(d: Declaration, direction: Direction, faults: CompilerFaults): Declaration {
  const sides = d.pending?.sides;
  if (!d.longhands.some((lh) => lh.direction !== undefined) && sides === undefined) return d;
  // Planted fault varLogicalBothSides: a flow-relative declaration holding var() keeps the longhands of both directions.
  if (faults.varLogicalBothSides && sides !== undefined) {
    let same = unnarrowed.get(d);
    if (same === undefined) {
      same = { ...d, pending: { parts: (d.pending as NonNullable<Declaration['pending']>).parts, longhands: (d.pending as NonNullable<Declaration['pending']>).longhands } };
      unnarrowed.set(d, same);
    }
    return same;
  }
  const cache = twins[direction];
  let twin = cache.get(d);
  if (twin === undefined) {
    const pending = d.pending === undefined || sides === undefined ? {} : { pending: { ...d.pending, longhands: sides[direction], direction } };
    twin = { ...d, longhands: d.longhands.filter((lh) => lh.direction === undefined || lh.direction === direction), ...pending };
    cache.set(d, twin);
  }
  return twin;
}
