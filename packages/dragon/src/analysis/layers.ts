// CASC 3: each layered declaration takes its layer's cascade rank (css/at-rules/layer.ts layerRanks), which beats() compares.
// revert-layer in a document with layers rolls back to the layers below it (rollBackLayers); the forms Dragon does not roll back
// (!important, through var(), on a custom property, direction, transitions and animations, escaped) are refused.
import { generate } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { layerRanks } from '../css/at-rules/layer.ts';
import { asciiLower } from '../css/escapes.ts';
import type { AtRuleContext } from '../css/at-rules.ts';
import type { Longhand } from '../css/properties.ts';
import type { Declaration, Rule } from '../css/stylesheet.ts';
import type { Candidate } from './cascade.ts';
import { tokenize } from '../media/tokens.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Diagnostic } from '../types.ts';

// Any revert-layer identifier in the value, escaped or not: a var() fallback or a custom property can carry it into a substitution.
const hasRevertLayer = (text: string): boolean => tokenize(text).some((t) => t.type === 'ident' && asciiLower(t.value) === 'revert-layer');
const isRevertLayer = (d: Declaration): boolean => hasRevertLayer(d.text);

/**
 * A declaration whose whole value is the revert-layer keyword, written plainly, that rollBackLayers rolls back: a normal one on
 * longhands the main cascade decides. direction has its own cascade (logical.ts) and transitions and animations theirs.
 */
export const rollsBack = (d: Declaration): boolean =>
  d.important !== true && d.custom === undefined && d.pending === undefined && d.animation === undefined && d.longhands.length > 0 &&
  asciiLower(d.text.trim()) === 'revert-layer' && d.longhands.every((l) => l.property !== 'direction' && l.value.kind === 'keyword' && l.value.value === 'revert-layer');

/**
 * The other value sources a substitution can reach: an @property initial-value (var() of a registered property) and an
 * @keyframes block. In a document with layers, a revert-layer identifier anywhere in one is refused as in a style rule.
 */
export function revertLayerInAtRules(contexts: readonly AtRuleContext[], declared: readonly string[], diagnostics: Diagnostic[]): void {
  if (declared.length === 0) return;
  for (const at of contexts) {
    if (!hasRevertLayer(at.source ?? generate(at.node))) continue;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(at.span),
      message: `@${at.name} ${(at.prelude ?? '').trim()}: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet`,
    }));
  }
}

/** The rules with each layered declaration ranked; with no layer declared, the rules as given. */
export function rankLayers(rules: readonly Rule[], declared: readonly string[], faults: CompilerFaults, diagnostics: Diagnostic[] | null): Rule[] {
  if (declared.length === 0) return [...rules];
  const ranks = layerRanks(declared);
  // layerImportantNotReversed: an !important declaration takes the rank a cascade without the reversal would compare.
  const flip = (rank: number, important: boolean): number => (faults.layerImportantNotReversed && important ? ranks.size - 1 - rank : rank);
  return rules.map((r) => {
    for (const d of r.declarations) {
      // css-cascade-5 §7.4: unlayered rules are the author origin's last layer, so revert-layer there rolls back to the layers too.
      if (diagnostics !== null && isRevertLayer(d) && !rollsBack(d)) {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: authored(d.valueSpan),
          message: `${d.alias ?? d.property}: revert-layer in a document with cascade layers is unsupported here: Dragon rolls back only a plain revert-layer that is not !important, not reached through var(), and not on a custom property, all, direction, a transition or an animation`,
        }));
      }
    }
    if (r.layer === undefined || faults.layersIgnored) return r;
    const rank = ranks.get(r.layer);
    if (rank === undefined) throw new Error(`rule in undeclared layer ${r.layer}`);
    return { ...r, declarations: r.declarations.map((d) => ({ ...d, layer: flip(rank, d.important === true) })) };
  });
}

/** The layer a normal declaration competes in, as beats() orders them: unlayered above every layer. */
const layerOf = (d: Declaration): number => d.layer ?? Number.POSITIVE_INFINITY;

/**
 * css-cascade-5 §7.4: a longhand whose winner is a revert-layer that rollsBack takes the winner of the declarations in the layers
 * below the winner's, again while that is one; with none left the revert-layer stays, and resolve.ts rolls it back as revert. A
 * winner of a normal declaration means no !important one matched, so only normal declarations compete. better: the cascade order.
 */
export function rollBackLayers(winners: Map<Longhand, Candidate>, candidates: readonly (readonly [Longhand, Candidate])[], better: (a: Candidate, b: Candidate) => boolean, faults: CompilerFaults): void {
  if (faults.revertLayerAsRevert) return;
  for (const [p, first] of winners) {
    let w = first;
    while (rollsBack(w.declaration)) {
      let next: Candidate | undefined;
      for (const [q, c] of candidates) if (q === p && layerOf(c.declaration) < layerOf(w.declaration) && (next === undefined || better(c, next))) next = c;
      if (next === undefined) break;
      w = next;
    }
    if (w !== first) winners.set(p, w);
  }
}
