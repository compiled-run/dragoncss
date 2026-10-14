// PNT1: the animated half of the translucent paint refusals (outline.ts checkTranslucentOutlines, radius.ts
// checkTranslucentRoundedDoubles). A dotted, dashed or 3D outline or a rounded double border in currentcolor takes color's value, so
// an animation or transition of color that passes through a translucent value paints it translucent mid-flight, which the platforms
// blend unlike Chrome's Skia (device run 38470185768). The static checks see each reachable state's resting colour only.
import type { CssValue } from '../../css/stylesheet.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { AnimationAnalysis } from '../animations.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { outlineInCurrentColor, sidePainterOutline } from './outline.ts';
import { borderInCurrentColor, roundedDouble } from './radius.ts';

/** Whether a colour value may paint translucent: anything but an opaque colour (transparent, currentcolor, a keyword, var()). */
const mayBeTranslucent = (v: CssValue): boolean => !(v.kind === 'color' && v.value.alpha === 255);

/** What an element paints in currentcolor that native refuses translucent, or null. */
function currentColorPaint(el: ResolvedElement): string | null {
  const style = sidePainterOutline(el);
  if (style !== null && outlineInCurrentColor(el)) return `a ${style} outline`;
  if (roundedDouble(el) && borderInCurrentColor(el)) return 'a rounded double border';
  return null;
}

/**
 * Refuses, on the native targets, an animation or transition of color on an element, or on an ancestor it inherits color from,
 * that paints a dotted, dashed or 3D outline or a rounded double border in currentcolor in some reachable state, when the color can
 * pass through a translucent value: a keyframe color that is not an opaque colour, or a transition between states one of which is
 * not opaque (a transition from opaque to transparent passes through translucent colours). A transition between opaque colours stays
 * opaque. roots are the resolved roots of the analysed cases, in the analysis's order; the caller runs it per @media band, with one
 * reported set.
 */
export function refuseAnimatedTranslucentPaint(analysis: AnimationAnalysis, roots: readonly ResolvedElement[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string> = new Set()): void {
  if (nativeTargets.length === 0) return;
  const trees = analysis.cases.map((_, i) => {
    const byAddress = new Map<string, { readonly el: ResolvedElement; readonly parent: string | null }>();
    const walk = (el: ResolvedElement, parent: string | null): void => {
      byAddress.set(el.element.address, { el, parent });
      for (const k of el.children) if (k.kind === 'element') walk(k, el.element.address);
    };
    const root = roots[i];
    if (root !== undefined) walk(root, null);
    return byAddress;
  });
  // The addresses whose color reaches a currentcolor paint: the painting element and each ancestor it inherits color from, in any
  // reachable state, with what it paints.
  const reaches = new Map<string, string>();
  for (const t of trees) {
    for (const [address, { el }] of t) {
      const what = currentColorPaint(el);
      if (what === null) continue;
      let at: string | null = address;
      while (at !== null) {
        const node = t.get(at);
        if (node === undefined) break;
        if (!reaches.has(at)) reaches.set(at, `${what} on ${address}`);
        const color = node.el.props.get('color') as ResolvedValue | undefined;
        if (color === undefined || color.origin !== 'inherited') break;
        at = node.parent;
      }
    }
  }
  if (reaches.size === 0) return;
  const colorsAt = (address: string): CssValue[] => trees.flatMap((t) => {
    const v = (t.get(address)?.el.props.get('color') as ResolvedValue | undefined)?.value;
    return v === undefined ? [] : [v];
  });
  analysis.cases.forEach((c, i) => {
    const byAddress = trees[i] as Map<string, { readonly el: ResolvedElement; readonly parent: string | null }>;
    for (const ea of c.elements.values()) {
      const paint = reaches.get(ea.address);
      const node = byAddress.get(ea.address);
      if (paint === undefined || node === undefined) continue;
      const animated = ea.animations.some((a) => a.name !== 'none' && a.hasKeyframes && (analysis.keyframes.get(a.name)?.blocks ?? []).some((b) => b.values.some((v) => v.property === 'color' && mayBeTranslucent(v.value))));
      const l = ea.listings.get('color');
      const colors = colorsAt(ea.address);
      const transitioned = l !== undefined && l.mode === 'listed' && l.delay + l.duration > 0 && new Set(colors.map((v) => JSON.stringify(v))).size > 1 && colors.some(mayBeTranslucent);
      for (const [what, longhand] of [...(animated ? [['an animation', 'animation-name'] as const] : []), ...(transitioned ? [['a transition', 'transition-property'] as const] : [])]) {
        const d = ea.declarations.find((x) => x.animation?.longhands.has(longhand) === true) ?? ea.declarations[0];
        const origin = d === undefined ? node.el.element.node.origin : authored(d.valueSpan);
        for (const t of nativeTargets) {
          const id = `${t}|${ea.address}|color-translucent|${longhand}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message: `${what} of color on ${ea.address}: ${paint} paints in currentcolor, and the color passes through translucent values, which ${t} blends with its own rounding, unlike Chrome's Skia; ${t} draws dotted, dashed and 3D outlines and rounded double borders in opaque colours only (PNT1)`, manual: `Animate color between opaque colours only, or give the outline or border its own opaque colour.` }));
        }
      }
    }
  });
}
