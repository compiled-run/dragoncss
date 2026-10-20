// ZOOM (css-viewport-1 §5): an element's effective zoom is its own computed zoom times its parent's. Chrome 145 multiplies every
// absolute length of the element by it at computed-value time (CSSToLengthConversionData's zoom), viewport units and the em and
// rem lengths included, and reports it divided back out in getComputedStyle; percentages and numbers stay as they are. A border
// width is zoomed and then snapped as any border width (thin, medium and thick too), but the initial medium width is not zoomed.
// The web output keeps zoom as authored, so web compiles any zoom. Native lays a zoomed subtree out by multiplying the lengths
// the layout lowering reads (ZOOM_SCALED, lower/ios-layout.ts zoomedGet), so on iOS and Android an element whose effective zoom is
// not 1 is refused when it holds a length the lowering does not scale (a paint length such as border-radius, a shadow, a grid
// track, a transform, or one inherited, which Chrome zooms again at the inheriting element), a calculation, an animation or
// transition, a scroll container or replaced content. Chrome does not zoom an explicitly inherited value again for some longhands
// (padding, margin, border-radius, box-shadow) where it does for others, so on every target an element whose effective zoom differs
// from its parent's is refused when a length it holds comes from inherit (or unset or revert on an inherited longhand).
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { zoomOf } from '../css/properties/zoom.ts';
import type { Longhand } from '../css/properties.ts';
import type { CssValue } from '../css/values.ts';
import type { Diagnostic } from '../types.ts';
import type { AnimationAnalysis } from './animations.ts';
import type { ResolvedElement, ResolvedValue } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** The longhands whose px and viewport lengths the native layout lowering multiplies by the effective zoom. */
export const ZOOM_SCALED: ReadonlySet<Longhand> = new Set<Longhand>([
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'top', 'right', 'bottom', 'left', 'flex-basis', 'row-gap', 'column-gap', 'text-indent', 'vertical-align',
  'font-size', 'line-height', 'letter-spacing', 'word-spacing',
]);

/** The effective zoom of an element whose parent's is parentZoom: its own computed zoom times it (1 for a value zoomOf rejects). */
export function effectiveZoom(el: ResolvedElement, parentZoom: number): number {
  const v = el.props.get('zoom') as ResolvedValue | undefined;
  const own = v === undefined ? 1 : zoomOf(v.value);
  return parentZoom * (own === null ? 1 : own);
}

// An absolute or font-relative length that is not zero, inside any value's text.
const NONZERO_LENGTH = /(?:^|[^\w.-])[+-]?(?:\d*\.)?\d*[1-9]\d*(?:\.\d*)?(?:e[+-]?\d+)?(?:px|em|rem|ex|rex|ch|rch|cap|rcap|ic|ric|lh|rlh|vw|vh|vi|vb|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|cm|mm|q|in|pt|pc)\b/i;

/** Whether a computed value holds a length other than zero (a math function of percentages and numbers alone holds none). */
export function holdsLength(v: CssValue): boolean {
  if (v.kind === 'length') return v.value !== 0;
  if (v.kind === 'position') return (v.x.unit === 'px' && v.x.value !== 0) || (v.y.unit === 'px' && v.y.value !== 0);
  return v.kind === 'other' && NONZERO_LENGTH.test(` ${v.text}`);
}

/** Why native cannot lay out el at effective zoom z (not 1), or null. */
function nativeZoomProblem(el: ResolvedElement, replaced: boolean): string | null {
  if (replaced) return `<${el.element.tag}> is replaced content, whose natural size native does not zoom yet`;
  for (const [p, rv] of el.props) {
    const v = rv.value;
    if ((p === 'overflow-x' || p === 'overflow-y') && v.kind === 'keyword' && (v.value === 'auto' || v.value === 'scroll')) return `${p}: ${v.value} makes it a scroll container, which native does not zoom yet`;
    if (ZOOM_SCALED.has(p)) {
      if (v.kind === 'other' && holdsLength(v)) return `${p}: ${valueToString(v)} is a calculation, which native does not zoom yet`;
      continue;
    }
    // An initial value is the same at every zoom, and so is one inherited from no author declaration (the root's initial
    // stroke-width). An authored one inherited is zoomed again at this element in Chrome (a text-shadow inherited from an
    // unzoomed ancestor draws its offset times z), which native paint does not do.
    if (p === 'zoom' || p.startsWith('--') || rv.origin === 'initial' || (rv.origin === 'inherited' && rv.span === null)) continue;
    if (holdsLength(v) || (v.kind === 'keyword' && (v.value === 'thin' || v.value === 'medium' || v.value === 'thick'))) return `${p}: ${valueToString(v)} is a length native does not zoom yet`;
  }
  return null;
}

/** The first longhand of el whose length comes from an explicit inherit (a declaration that took its parent's value), or null. */
function explicitlyInheritedLength(el: ResolvedElement): string | null {
  for (const [p, rv] of el.props) {
    if (p === 'zoom' || p.startsWith('--') || rv.origin !== 'inherited' || rv.declaration === null) continue;
    const v = rv.value;
    if (holdsLength(v) || (v.kind === 'keyword' && (v.value === 'thin' || v.value === 'medium' || v.value === 'thick'))) return `${p}: ${valueToString(v)}`;
  }
  return null;
}

/**
 * Refuses, on iOS and Android, an element whose effective zoom z is not 1 and that holds what native does not scale, and on every
 * target one whose effective zoom differs from its parent's (parentZoom) and that inherits a length explicitly; once per element.
 */
export function checkZoom(el: ResolvedElement, z: number, parentZoom: number, replaced: boolean, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const id = `zoom|${el.element.address}`;
  if (reported.has(id)) return;
  const inherited = z === parentZoom ? null : explicitlyInheritedLength(el);
  const problem = inherited !== null
    ? `${inherited} is inherited explicitly from a parent at zoom ${parentZoom}, which Chrome zooms again for some longhands and not others`
    : z === 1 ? null : nativeZoomProblem(el, replaced);
  if (problem === null) return;
  reported.add(id);
  const v = el.props.get('zoom') as ResolvedValue | undefined;
  const origin = v !== undefined && v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of targets) {
    if (inherited === null && t !== 'ios' && t !== 'android') continue;
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `<${el.element.tag}> ${el.element.address} is laid out at zoom ${z} and ${problem} (ZOOM)`,
      manual: inherited === null ? `Remove zoom from ${el.element.address} and its ancestors, or size it with its own lengths.` : `Write the length on ${el.element.address} instead of inherit, or remove its zoom.`,
      basis: 'computed-value',
    }));
  }
}

/**
 * Refuses, on iOS and Android, a transition or animation of an element whose effective zoom is not 1: the animation program carries
 * keyframe and transition endpoint lengths unzoomed (lower/anim-program.ts). One check per element over every case of a band.
 */
export function refuseZoomedAnimations(analysis: AnimationAnalysis, cases: readonly { readonly key: string; readonly resolved: ResolvedElement | null }[], targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const byKey = new Map(analysis.cases.map((c) => [c.key, c] as const));
  for (const c of cases) {
    const animated = c.resolved === null ? undefined : byKey.get(c.key);
    if (c.resolved === null || animated === undefined) continue;
    const walk = (el: ResolvedElement, parentZoom: number): void => {
      const z = effectiveZoom(el, parentZoom);
      const ea = animated.elements.get(el.element.address);
      const id = `zoom-anim|${el.element.address}`;
      const moves = ea !== undefined && (ea.animations.some((a) => a.hasKeyframes) || [...ea.listings.values()].some((l) => l.mode === 'listed' && l.duration > 0));
      if (z !== 1 && moves && ea !== undefined && ea.declarations.length > 0 && !reported.has(id)) {
        reported.add(id);
        for (const t of targets) {
          if (t !== 'ios' && t !== 'android') continue;
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin: authored((ea.declarations[0] as (typeof ea.declarations)[number]).valueSpan),
            target: t,
            message: `<${el.element.tag}> ${el.element.address} is laid out at zoom ${z} and transitions or animates, and native does not zoom animated lengths yet (ZOOM)`,
            manual: `Remove zoom from ${el.element.address} and its ancestors, or remove its transition and animation.`,
            basis: 'computed-value',
          }));
        }
      }
      for (const k of el.children) if (k.kind === 'element') walk(k, z);
    };
    walk(c.resolved, 1);
  }
}
