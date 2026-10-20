// PNT1: an outline, box-shadow, background colour or gradient raster in currentcolor takes color's value, and Chrome repaints it each
// frame an animation or transition changes color. The native lowerings (lower/paint/outline.ts, lower/paint/shadow.ts,
// lower/paint/colors.ts, lower/paint/gradient.ts) resolve currentcolor to the resting color once, and the animator's per-frame colour
// closure (lower/anim-program.ts R9) reaches color and currentcolor border sides only, so mid-flight the native paint keeps the
// resting colour. Refused on the native targets until the animator repaints them.
import type { CssValue } from '../../css/stylesheet.ts';
import { SIDES } from '../../css/properties.ts';
import type { Longhand } from '../../css/properties.ts';
import { shadowsOf } from '../../css/properties/shadow.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { AnimationAnalysis } from '../animations.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { paintsGradient, resolvedLayers } from './gradient.ts';
import { paintedOutlineStyle } from './outline.ts';

type Node = { readonly el: ResolvedElement; readonly parent: string | null };

/**
 * A currentcolor paint the animator does not repaint. own: refused for the element's own color too (a gradient box's own color is
 * BG2c's refuseAnimatedGradients). alpha: wrong only where the color's opacity changes mid-flight (a gradient raster bakes whether an
 * opaque border hides the background under it, obscuresOf).
 */
type Paint = { readonly what: string; readonly repaint: string; readonly own: boolean; readonly alpha: boolean };

const isKeyword = (v: CssValue | null | undefined, k: string): boolean => v != null && v.kind === 'keyword' && v.value === k;

const valueOf = (el: ResolvedElement, p: Longhand): CssValue => {
  const v = el.props.get(p) as ResolvedValue | undefined;
  if (v === undefined) throw new Error(`${el.element.address}: ${p} did not resolve`);
  return v.value;
};

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
function currentColorPaints(address: string, tree: ReadonlyMap<string, Node>): Paint[] {
  const el = (tree.get(address) as Node).el;
  if (!paintsOwn(visibilityOf(valueOf(el, 'visibility')))) return [];
  const out: Paint[] = [];
  const style = paintedOutlineStyle(el);
  if (style !== null && isKeyword(valueOf(el, 'outline-color'), 'currentcolor')) out.push({ what: `a ${style} outline`, repaint: 'outlines or box shadows', own: true, alpha: false });
  if (isKeyword(valueOf(el, 'display'), 'contents')) return out;
  if (shadowInCurrentColor(address, tree)) out.push({ what: 'a box-shadow', repaint: 'outlines or box shadows', own: true, alpha: false });
  const background = isKeyword(valueOf(el, 'background-color'), 'currentcolor');
  if (!paintsGradient(el)) {
    if (background) out.push({ what: 'a background-color', repaint: 'background colours', own: true, alpha: false });
    return out;
  }
  const stops = resolvedLayers(el).some((l) => l.image.kind === 'gradient' && l.image.gradient.stops.some((s) => s.color.kind === 'currentcolor'));
  if (stops || background) out.push({ what: 'a gradient background', repaint: 'a gradient raster', own: false, alpha: false });
  // dotted, dashed and hidden sides never hide the background (obscuresOf); none has no width.
  else if (SIDES.some((s) => isKeyword(valueOf(el, `border-${s}-color` as Longhand), 'currentcolor') && !['none', 'hidden', 'dotted', 'dashed'].some((k) => isKeyword(valueOf(el, `border-${s}-style` as Longhand), k)))) {
    out.push({ what: 'a gradient background under a currentcolor border', repaint: 'a gradient raster', own: false, alpha: true });
  }
  return out;
}

/** Whether a colour is opaque, or null when it is not known at build time. */
const opaque = (v: CssValue | null | undefined): boolean | null => (v?.kind === 'color' ? v.value.alpha === 255 : isKeyword(v, 'transparent') ? false : null);

/**
 * Refuses, on the native targets, an animation or transition of color on an element, or on an ancestor it inherits color from, that
 * paints in currentcolor in some reachable state what the animator does not repaint (an outline, a box-shadow, a background colour,
 * or a descendant's gradient raster): any color keyframe, or a transition where a reachable state changes the color, at its
 * animation-name or transition-property. roots are the resolved roots of the analysed cases, in the analysis's order; the caller
 * runs it per @media band, with one reported set.
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
  // The addresses whose color reaches a currentcolor paint: the painting element and each ancestor it inherits color from, apart
  // for paints wrong only where the color's opacity changes.
  type Reach = { readonly text: string; readonly repaint: string };
  const reaches = new Map<string, { always?: Reach; alpha?: Reach }>();
  for (const t of trees) {
    for (const address of t.keys()) {
      const paints = currentColorPaints(address, t);
      if (paints.length === 0) continue;
      let at: string | null = address;
      while (at !== null) {
        const node = t.get(at);
        if (node === undefined) break;
        const here = paints.filter((p) => p.own || at !== address);
        const entry = reaches.get(at) ?? {};
        for (const key of ['always', 'alpha'] as const) {
          const ps = here.filter((p) => p.alpha === (key === 'alpha'));
          if (entry[key] === undefined && ps.length > 0) entry[key] = { text: `${ps.map((p) => p.what).join(' and ')} on ${address}`, repaint: (ps[0] as Paint).repaint };
        }
        reaches.set(at, entry);
        if ((node.el.props.get('color') as ResolvedValue | undefined)?.origin !== 'inherited') break;
        at = node.parent;
      }
    }
  }
  if (reaches.size === 0) return;
  const resting = (address: string): (CssValue | null)[] => trees.map((t) => t.get(address)?.el.props.get('color')?.value ?? null);
  // A transition starts only where a reachable state changes the color.
  const changes = (address: string): boolean => new Set(resting(address).map((v) => JSON.stringify(v))).size > 1;
  // Whether a frame may change the color's opacity: its end values are not all opaque or all translucent, or one is unknown.
  const alphaMoves = (values: readonly (CssValue | null)[]): boolean => {
    const flags = new Set(values.map(opaque));
    return flags.has(null) || flags.size > 1;
  };
  analysis.cases.forEach((c, i) => {
    const byAddress = trees[i] as Map<string, Node>;
    for (const ea of c.elements.values()) {
      const entry = reaches.get(ea.address);
      const node = byAddress.get(ea.address);
      if (entry === undefined || node === undefined) continue;
      const keyframes = ea.animations.filter((a) => a.name !== 'none' && a.hasKeyframes).flatMap((a) => (analysis.keyframes.get(a.name)?.blocks ?? []).flatMap((b) => b.values.filter((v) => v.property === 'color').map((v) => v.value)));
      const animated = keyframes.length > 0;
      const l = ea.listings.get('color');
      const transitioned = l !== undefined && l.mode === 'listed' && l.delay + l.duration > 0 && changes(ea.address);
      for (const [what, longhand] of [...(animated ? [['an animation', 'animation-name'] as const] : []), ...(transitioned ? [['a transition', 'transition-property'] as const] : [])]) {
        // A state where the element is not rendered paints nothing, so its missing color is no end value.
        const shown = resting(ea.address).filter((v) => v !== null);
        const ends = longhand === 'animation-name' ? [...shown, ...keyframes] : shown;
        const paint = entry.always ?? (entry.alpha !== undefined && alphaMoves(ends) ? entry.alpha : undefined);
        if (paint === undefined) continue;
        const d = ea.declarations.find((x) => x.animation?.longhands.has(longhand) === true) ?? ea.declarations[0];
        const origin = d === undefined ? node.el.element.node.origin : authored(d.valueSpan);
        for (const t of nativeTargets) {
          const id = `${t}|${ea.address}|currentcolor-paint|${longhand}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin,
            target: t,
            message: `${what} of color on ${ea.address}: ${paint.text} paints in currentcolor, which ${t} resolves to the resting color once, and the native animator does not repaint ${paint.repaint} per frame, so mid-animation ${t} would keep the resting colour where Chrome follows color (PNT1)`,
            manual: 'Give the paint its own colour, or remove the animation or transition of color.',
          }));
        }
      }
    }
  });
}
