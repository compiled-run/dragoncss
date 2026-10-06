// CASC 3: each layered declaration takes its layer's cascade rank (css/at-rules/layer.ts layerRanks), which beats() compares.
// revert-layer in a layered rule rolls back to the layers below it, which Dragon does not resolve yet, so it is refused there.
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { layerRanks } from '../css/at-rules/layer.ts';
import type { Declaration, Rule } from '../css/stylesheet.ts';
import type { CompilerFaults } from '../faults.ts';
import type { Diagnostic } from '../types.ts';

const isRevertLayer = (d: Declaration): boolean =>
  d.custom?.wide === 'revert-layer' || d.longhands.some((lh) => lh.value.kind === 'keyword' && lh.value.value === 'revert-layer') || (d.animation !== undefined && [...d.animation.longhands.values()].some((l) => l.kind === 'wide' && l.keyword === 'revert-layer'));

/** The rules with each layered declaration ranked; with no layer declared, the rules as given. */
export function rankLayers(rules: readonly Rule[], declared: readonly string[], faults: CompilerFaults, diagnostics: Diagnostic[] | null): Rule[] {
  if (declared.length === 0) return [...rules];
  const ranks = layerRanks(declared);
  // layerImportantNotReversed: an !important declaration takes the rank a cascade without the reversal would compare.
  const flip = (rank: number, important: boolean): number => (faults.layerImportantNotReversed && important ? ranks.size - 1 - rank : rank);
  return rules.map((r) => {
    if (r.layer === undefined || faults.layersIgnored) return r;
    const rank = ranks.get(r.layer);
    if (rank === undefined) throw new Error(`rule in undeclared layer ${r.layer}`);
    for (const d of r.declarations) {
      if (diagnostics !== null && isRevertLayer(d)) {
        diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
          origin: authored(d.valueSpan),
          message: `${d.alias ?? d.property}: revert-layer inside a cascade layer is unsupported: rolling back to the layers below is not built yet`,
        }));
      }
    }
    return { ...r, declarations: r.declarations.map((d) => ({ ...d, layer: flip(rank, d.important === true) })) };
  });
}
