// PNT1: an outline or box-shadow in currentcolor takes color's value, and Chrome repaints it each frame an animation or transition
// changes color. The native lowerings (lower/paint/outline.ts, lower/paint/shadow.ts) resolve currentcolor to the resting color once,
// and the animator's per-frame colour closure (lower/anim-program.ts R9) reaches color and currentcolor border sides only, so
// mid-flight the native outline or shadow keeps the resting colour. Refused on the native targets until the animator repaints them.
import type { CssValue } from '../../css/stylesheet.ts';
import { shadowsOf } from '../../css/properties/shadow.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { AnimationAnalysis } from '../animations.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { paintedOutlineStyle } from './outline.ts';

type Node = { readonly el: ResolvedElement; readonly parent: string | null };

const isKeyword = (v: CssValue | null | undefined, k: string): boolean => v != null && v.kind === 'keyword' && v.value === k;

/** Whether an element's box-shadow list holds a currentcolor shadow, following an inherit keyword to the parent's declaration. */
function shadowInCurrentColor(address: string, tree: ReadonlyMap<string, Node>): boolean {
  let at: string | null = address;
  while (at !== null) {
    const node = tree.get(at);
    if (node === undefined) return false;
    const v = node.el.props.get('box-shadow') as ResolvedValue | undefined;
    if (v === undefined) throw new Error(`${at}: box-shadow did not resolve`);
    if (isKeyword(v.declared, 'inherit')) {
      at = node.parent;
      continue;
    }
    const shadows = v.declared === null ? null : shadowsOf(v.declared);
    return shadows !== null && shadows.some((s) => s.color === 'currentcolor');
  }
  return false;
}

/** What an element paints in currentcolor that the native animator does not repaint, in one reachable state. */
function currentColorPaints(address: string, tree: ReadonlyMap<string, Node>): string[] {
  const el = (tree.get(address) as Node).el;
  const visibility = el.props.get('visibility') as ResolvedValue | undefined;
  if (visibility === undefined) throw new Error(`${address}: visibility did not resolve`);
  if (!paintsOwn(visibilityOf(visibility.value))) return [];
  const out: string[] = [];
  const style = paintedOutlineStyle(el);
  if (style !== null && isKeyword((el.props.get('outline-color') as ResolvedValue | undefined)?.value, 'currentcolor')) out.push(`a ${style} outline`);
  const display = (el.props.get('display') as ResolvedValue | undefined)?.value;
  if (!isKeyword(display, 'contents') && shadowInCurrentColor(address, tree)) out.push('a box-shadow');
  return out;
}

/**
 * Refuses, on the native targets, an animation or transition of color on an element, or on an ancestor it inherits color from, that
 * paints an outline or box-shadow in currentcolor in some reachable state: any color keyframe, or a transition where a reachable
 * state changes the color, at its animation-name or transition-property. roots are the resolved roots of the analysed cases, in the
 * analysis's order; the caller runs it per @media band, with one reported set.
 */
export function refuseAnimatedCurrentColorPaint(analysis: AnimationAnalysis, roots: readonly ResolvedElement[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string> = new Set()): void {
  if (nativeTargets.length === 0) return;
  // Each case's rendered elements (display: none hides its subtree) with their parents.
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
  // The addresses whose color reaches a currentcolor paint: the painting element and each ancestor it inherits color from.
  const reaches = new Map<string, string>();
  for (const t of trees) {
    for (const address of t.keys()) {
      const what = currentColorPaints(address, t);
      if (what.length === 0) continue;
      let at: string | null = address;
      while (at !== null) {
        const node = t.get(at);
        if (node === undefined) break;
        if (!reaches.has(at)) reaches.set(at, `${what.join(' and ')} on ${address}`);
        if ((node.el.props.get('color') as ResolvedValue | undefined)?.origin !== 'inherited') break;
        at = node.parent;
      }
    }
  }
  if (reaches.size === 0) return;
  // A transition starts only where a reachable state changes the color.
  const changes = (address: string): boolean => new Set(trees.map((t) => JSON.stringify(t.get(address)?.el.props.get('color')?.value ?? null))).size > 1;
  analysis.cases.forEach((c, i) => {
    const byAddress = trees[i] as Map<string, Node>;
    for (const ea of c.elements.values()) {
      const paint = reaches.get(ea.address);
      const node = byAddress.get(ea.address);
      if (paint === undefined || node === undefined) continue;
      const animated = ea.animations.some((a) => a.name !== 'none' && a.hasKeyframes && (analysis.keyframes.get(a.name)?.blocks ?? []).some((b) => b.values.some((v) => v.property === 'color')));
      const l = ea.listings.get('color');
      const transitioned = l !== undefined && l.mode === 'listed' && l.delay + l.duration > 0 && changes(ea.address);
      for (const [what, longhand] of [...(animated ? [['an animation', 'animation-name'] as const] : []), ...(transitioned ? [['a transition', 'transition-property'] as const] : [])]) {
        const d = ea.declarations.find((x) => x.animation?.longhands.has(longhand) === true) ?? ea.declarations[0];
        const origin = d === undefined ? node.el.element.node.origin : authored(d.valueSpan);
        for (const t of nativeTargets) {
          const id = `${t}|${ea.address}|currentcolor-paint|${longhand}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin,
            target: t,
            message: `${what} of color on ${ea.address}: ${paint} paints in currentcolor, which ${t} resolves to the resting color once, and the native animator does not repaint outlines or box shadows per frame, so mid-animation ${t} would keep the resting colour where Chrome follows color (PNT1)`,
            manual: 'Give the outline or box-shadow its own colour, or remove the animation or transition of color.',
          }));
        }
      }
    }
  });
}
