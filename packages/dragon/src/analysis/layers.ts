// CASC 3: each layered declaration takes its layer's cascade rank (css/at-rules/layer.ts layerRanks), which beats() compares.
// revert-layer in a document with layers rolls back to the layers below it, which Dragon does not resolve yet, so it is refused.
import { generate } from 'css-tree';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { layerRanks } from '../css/at-rules/layer.ts';
import { asciiLower } from '../css/escapes.ts';
import type { AtRuleContext } from '../css/at-rules.ts';
import type { Declaration, Rule } from '../css/stylesheet.ts';
import { tokenize } from '../media/tokens.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Diagnostic } from '../types.ts';

// Any revert-layer identifier in the value, escaped or not: a var() fallback or a custom property can carry it into a substitution.
const hasRevertLayer = (text: string): boolean => tokenize(text).some((t) => t.type === 'ident' && asciiLower(t.value) === 'revert-layer');
const isRevertLayer = (d: Declaration): boolean => hasRevertLayer(d.text);

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
      if (diagnostics !== null && isRevertLayer(d)) {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: authored(d.valueSpan),
          message: `${d.alias ?? d.property}: revert-layer in a document with cascade layers is unsupported: rolling back to the layers below is not built yet`,
        }));
      }
    }
    if (r.layer === undefined || faults.layersIgnored) return r;
    const rank = ranks.get(r.layer);
    if (rank === undefined) throw new Error(`rule in undeclared layer ${r.layer}`);
    return { ...r, declarations: r.declarations.map((d) => ({ ...d, layer: flip(rank, d.important === true) })) };
  });
}
