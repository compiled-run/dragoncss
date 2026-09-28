// Selector matching over the linked tree (selectors are parsed in css/selectors.ts).
import type { Rule, Selector } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { LinkedElement } from './link.ts';

// A class selector matches only class symbols of the rule's own owner and sheet (docs/api.md §3.1); [ui-*] tests the attribute.
function compoundMatches(el: LinkedElement, rule: Rule, c: Selector['parts'][number]['compound'], faults: CompilerFaults): boolean {
  if (c.tag !== null && c.tag !== el.tag) return false;
  const classes = faults.variantCollapse && c.classes.length >= 2 ? c.classes.slice(0, -1) : c.classes;
  if (!classes.every((k) => el.classes.some((s) => s.owner === rule.owner && s.sheet === rule.sheet && s.name === k))) return false;
  return c.attributes.every((a) => {
    const v = el.attributes.get(a.name);
    return v !== undefined && (a.value === null || a.value === v);
  });
}

/**
 * Selectors-4 §3.3: right-to-left matching over the logical ancestor chain, with backtracking for descendant combinators.
 * chain[index] is the element compared with sel.parts[part]; call with index = chain.length - 1 and part 0 for the subject.
 */
export function selectorMatches(rule: Rule, sel: Selector, chain: readonly LinkedElement[], index: number, part: number, faults: CompilerFaults): boolean {
  const p = sel.parts[part];
  const el = chain[index];
  if (p === undefined || el === undefined) return false;
  if (!compoundMatches(el, rule, p.compound, faults)) return false;
  const next = sel.parts[part + 1];
  if (next === undefined) return true;
  if (next.combinator === '>') return selectorMatches(rule, sel, chain, index - 1, part + 1, faults);
  for (let i = index - 1; i >= 0; i--) if (selectorMatches(rule, sel, chain, i, part + 1, faults)) return true;
  return false;
}
