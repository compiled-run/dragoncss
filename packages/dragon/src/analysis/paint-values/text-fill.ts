// TXT-FX (compat §5): text whose -webkit-text-fill-color is not currentcolor is filled in that colour, and Chrome leaves it there while
// an animation or transition changes color. The native animator sets each text view's colour from its parent's animated color
// (emit/runtime/state.ts dragonSetText), so mid-flight it would fill such text in color. Refused on the native targets.
import type { CssValue } from '../../css/stylesheet.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { AnimationAnalysis } from '../animations.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';

type Node = { readonly el: ResolvedElement; readonly parent: string | null };

const isKeyword = (v: CssValue | null | undefined, k: string): boolean => v != null && v.kind === 'keyword' && v.value === k;

/** Whether an element holds text filled in a -webkit-text-fill-color other than currentcolor. */
export function fillsOwnText(el: ResolvedElement): boolean {
  const fill = el.props.get('-webkit-text-fill-color') as ResolvedValue | undefined;
  if (fill === undefined) throw new Error(`${el.element.address}: -webkit-text-fill-color did not resolve`);
  return !isKeyword(fill.value, 'currentcolor') && el.children.some((c) => c.kind === 'text');
}

/**
 * Refuses, on the native targets, an animation with a color keyframe or a transition of color where a reachable state changes it, on
 * an element whose text has its own fill or on an ancestor such an element inherits color from. roots are the resolved roots of the
 * analysed cases, in the analysis's order; the caller runs it per @media band, with one reported set.
 */
export function refuseAnimatedTextFill(analysis: AnimationAnalysis, roots: readonly ResolvedElement[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string> = new Set()): void {
  if (nativeTargets.length === 0) return;
  const trees = analysis.cases.map((_, i) => {
    const byAddress = new Map<string, Node>();
    const walk = (el: ResolvedElement, parent: string | null): void => {
      if (isKeyword((el.props.get('display') as ResolvedValue | undefined)?.value, 'none')) return;
      byAddress.set(el.element.address, { el, parent });
      for (const k of el.children) if (k.kind === 'element') walk(k, el.element.address);
    };
    const root = roots[i];
    if (root !== undefined) walk(root, null);
    return byAddress;
  });
  // The addresses whose color reaches text with its own fill: the text's element and each ancestor it inherits color from.
  const reaches = new Map<string, string>();
  for (const t of trees) {
    for (const [address, { el }] of t) {
      if (!fillsOwnText(el)) continue;
      let at: string | null = address;
      while (at !== null) {
        const node = t.get(at);
        if (node === undefined) break;
        if (!reaches.has(at)) reaches.set(at, address);
        if ((node.el.props.get('color') as ResolvedValue | undefined)?.origin !== 'inherited') break;
        at = node.parent;
      }
    }
  }
  if (reaches.size === 0) return;
  const changes = (address: string): boolean => new Set(trees.map((t) => JSON.stringify(t.get(address)?.el.props.get('color')?.value ?? null))).size > 1;
  analysis.cases.forEach((c, i) => {
    const byAddress = trees[i] as Map<string, Node>;
    for (const ea of c.elements.values()) {
      const filled = reaches.get(ea.address);
      const node = byAddress.get(ea.address);
      if (filled === undefined || node === undefined) continue;
      const animated = ea.animations.some((a) => a.name !== 'none' && a.hasKeyframes && (analysis.keyframes.get(a.name)?.blocks ?? []).some((b) => b.values.some((v) => v.property === 'color')));
      const l = ea.listings.get('color');
      const transitioned = l !== undefined && l.mode === 'listed' && l.delay + l.duration > 0 && changes(ea.address);
      for (const [what, longhand] of [...(animated ? [['an animation', 'animation-name'] as const] : []), ...(transitioned ? [['a transition', 'transition-property'] as const] : [])]) {
        const d = ea.declarations.find((x) => x.animation?.longhands.has(longhand) === true) ?? ea.declarations[0];
        const origin = d === undefined ? node.el.element.node.origin : authored(d.valueSpan);
        for (const t of nativeTargets) {
          const id = `${t}|${ea.address}|text-fill|${longhand}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin,
            target: t,
            message: `${what} of color on ${ea.address}: the text of ${filled} is filled in its -webkit-text-fill-color, which Chrome keeps while color changes, and the ${t} animator fills text in the animated color (TXT-FX)`,
            manual: `Remove the animation or transition of color, or give the text of ${filled} -webkit-text-fill-color: currentcolor.`,
          }));
        }
      }
    }
  });
}
