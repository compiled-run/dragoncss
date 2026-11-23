// Computed box-shadow (css-backgrounds-3 §7.1, css-values-4 §6, css-color-4 §4.4): every shadow length computes to px (em against
// the element's font size, rem against the root's) and currentcolor to the element's computed color, as Chrome 145 serializes it.
import type { Rgba8 } from '../../css/color.ts';
import { TRANSPARENT } from '../../css/color.ts';
import type { CssValue } from '../../css/stylesheet.ts';
import type { Shadow, ShadowLength } from '../../css/properties/shadow.ts';
import { SHADOW_LIST, shadowsOf, shadowValue } from '../../css/properties/shadow.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import { containsDescendants } from '../containment.ts';
import { isReplacedTag } from '../elements/replaced.ts';
import type { ResolvedElement } from '../resolve.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import { stackingContextOf } from '../text-shadow.ts';
import { elementTransform, elementWillChange, hasPerspective } from './transform.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

function computeLength(l: ShadowLength, ctx: PaintValueContext): ShadowLength | null {
  if (l.unit === CANONICAL_LENGTH_UNIT) return l;
  const needs = l.unit === 'em' ? ctx.em : l.unit === 'rem' ? ctx.rem : 0;
  if (needs === null) return null;
  const px = lengthToPx(l.value, l.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  return px === null ? null : { value: px, unit: CANONICAL_LENGTH_UNIT };
}

const keyword = (el: ResolvedElement, p: 'display' | 'position'): string => {
  const v = (el.props.get(p) as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

/** The authored box-shadow declaration of an element with at least one shadow, or null. */
function shadowDeclaration(el: ResolvedElement): ResolvedValue | null {
  const v = el.props.get('box-shadow') as ResolvedValue | undefined;
  if (v === undefined || v.declaration === null) return null;
  const shadows = shadowsOf(v.value);
  return shadows !== null && shadows.length > 0 ? v : null;
}

/** What makes the box composited apart from a plain transform: a perspective (a layer item drawn as an identity transform), or will-change naming transform or opacity. */
function compositedOf(el: ResolvedElement): string | null {
  if (hasPerspective(el)) return 'a perspective';
  const w = elementWillChange(el).find((f) => f === 'transform' || f === 'opacity');
  return w === undefined ? null : `will-change: ${w}`;
}

/** A group whose descendants' shadows Chrome blits under its transform or into its own raster: a transform, or compositedOf. */
function groupOf(el: ResolvedElement): string | null {
  return elementTransform(el).length > 0 ? 'a transform' : compositedOf(el);
}

/** The first transform function that is not a translate or a scale by positive factors, which the mapped shadow layer cannot draw. */
function unmappedFunction(el: ResolvedElement): string | null {
  const f = elementTransform(el).find((x) => !(x.kind === 'translate' || (x.kind === 'scale' && x.sx > 0 && x.sy > 0)));
  return f === undefined ? null : f.text;
}

/** Why a shadowed element is refused on a native target, with its fix, or null: what PNT1 does not draw as Chrome does. */
function unshadowed(el: ResolvedElement, t: string): { readonly what: string; readonly message: string; readonly manual: string } | null {
  const tag = el.element.tag;
  const address = el.element.address;
  // css-backgrounds-3 §2.11.2: their background paints the canvas, which the shadow backdrop (dragonShadowBackdrop) does not model.
  if (tag === 'html' || tag === 'body') return { what: 'root', message: `<${tag}> ${address} has a box-shadow, but its background paints the canvas, which ${t}'s shadow backdrop does not model yet`, manual: 'Put the shadow on a wrapper element inside body.' };
  if (isReplacedTag(tag)) return { what: 'replaced', message: `<${tag}> ${address} has a box-shadow; ${t} does not draw shadows of replaced elements yet (no comparison proves them)`, manual: 'Put the shadow on a wrapper element around the image or frame.' };
  // The native runtime places inline box views unpainted (their decorations are INL1b), and Chrome paints one shadow per line fragment.
  if (keyword(el, 'display') === 'inline') return { what: 'inline', message: `<${tag}> ${address} is an inline box with a box-shadow; ${t} does not paint inline boxes until INL1b (inline box decorations), so the shadow would be dropped`, manual: `Move the shadow to a block, or remove it from ${address}, until INL1b.` };
  // A positioned box's shadow sorts with it (stacking.ts) but its backdrop over earlier positioned paint has no Chrome proof yet.
  const position = keyword(el, 'position');
  if (position !== 'static') return { what: 'positioned', message: `${address} has a box-shadow and position: ${position}; Chrome paints it after the in-flow content of its stacking context, and ${t}'s shadow backdrop for a positioned box is not proven against Chrome yet`, manual: `Put the shadow on an in-flow (position: static) element, or remove position from ${address}.` };
  // css-contain-2 §3.2, §3.4: a layout- or paint-contained box is a stacking context Chrome paints in its context's z-index 0 layer,
  // the same re-hosted layer item as a positioned box.
  if (containsDescendants(el)) return { what: 'contained', message: `${address} has a box-shadow and contain: layout or paint; Chrome paints it after the in-flow content of its stacking context, and ${t}'s shadow backdrop for a contained box is not proven against Chrome yet`, manual: `Put the shadow on a wrapper element around ${address}, or remove its layout and paint containment.` };
  const group = compositedOf(el);
  if (group !== null) return { what: 'group', message: `${address} has a box-shadow and ${group}; ${t} draws the outer shadows in a companion view that the box's compositing group does not cover`, manual: `Put the shadow on a wrapper element around ${address}.` };
  if (elementTransform(el).length === 0) return null;
  // Chrome draws the shadow under the box's transform; the companion view holds it rastered at the mapped scale and translate.
  const fn = unmappedFunction(el);
  if (fn !== null) return { what: 'transform', message: `${address} has a box-shadow and the transform function ${fn}; ${t} draws the outer shadows of a transformed box at its scale and translate only, so a rotation, a matrix or a scale that flips or collapses the box is refused`, manual: `Put the shadow on a wrapper element around ${address}, or transform it with translate and positive scale only.` };
  if ((shadowsOf((el.props.get('box-shadow') as ResolvedValue).value) ?? []).some((s) => s.inset)) return { what: 'transform-inset', message: `${address} has an inset box-shadow and a transform; ${t} draws inset shadows in the box view, which the platform resamples by the transform where Chrome draws them at the mapped geometry`, manual: `Put the inset shadow on a child element of ${address}, or remove its transform.` };
  return null;
}

/** The shadowed elements below el that generate boxes, in tree order. */
function shadowedBelow(el: ResolvedElement): ResolvedElement[] {
  const out: ResolvedElement[] = [];
  for (const c of el.children) {
    if (c.kind !== 'element' || keyword(c, 'display') === 'none') continue;
    if (shadowDeclaration(c) !== null) out.push(c);
    out.push(...shadowedBelow(c));
  }
  return out;
}

const keywordOf = (el: ResolvedElement, p: string): string | null => {
  const v = (el.props.get(p as never) as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : null;
};

/** Why an element painted before a layer item's shadow is not a fill its backdrop can hold: a transform, opacity, a clip; or null. */
function unheldPainter(el: ResolvedElement): string | null {
  const v = (el.props.get('opacity') as ResolvedValue | undefined)?.value;
  const o = v === undefined ? 1 : opacityOf(v);
  if (o !== null && o < 1) return `opacity ${o}`;
  const sc = stackingContextOf(el);
  if (sc !== null) return sc;
  // The backdrop leaves out what a clipping box holds, which matters only when a box inside it paints a background.
  const clip = ['overflow-x', 'overflow-y'].map((p) => keywordOf(el, p) ?? 'visible').find((k) => k !== 'visible');
  return clip === undefined || !paintsBackgroundBelow(el) ? null : `overflow ${clip}`;
}

function paintsBackgroundBelow(el: ResolvedElement): boolean {
  return el.children.some((c) => {
    if (c.kind !== 'element' || keyword(c, 'display') === 'none') return false;
    const bg = (c.props.get('background-color') as ResolvedValue | undefined)?.value;
    const clear = bg === undefined || (bg.kind === 'color' && bg.value.alpha === 0) || (bg.kind === 'keyword' && bg.value === 'transparent');
    const filled = !clear || (keywordOf(c, 'background-image') ?? 'none') !== 'none';
    return filled || paintsBackgroundBelow(c);
  });
}

/**
 * The transformed shadowed boxes whose stacking context holds a box painted before them that their shadow backdrop cannot hold
 * (unheldPainter), with that box: Chrome paints the transformed box after its context's flow content, over those boxes' paint.
 */
function transformedOverUnheld(root: ResolvedElement): [ResolvedElement, ResolvedElement, string][] {
  const out: [ResolvedElement, ResolvedElement, string][] = [];
  const scan = (el: ResolvedElement, skip: ReadonlySet<ResolvedElement>, box: ResolvedElement): [ResolvedElement, string] | null => {
    for (const c of el.children) {
      if (c.kind !== 'element' || keyword(c, 'display') === 'none' || c === box) continue;
      const why = skip.has(c) ? null : unheldPainter(c);
      if (why !== null) return [c, why];
      const inner = scan(c, skip, box);
      if (inner !== null) return inner;
    }
    return null;
  };
  const visit = (el: ResolvedElement, context: ResolvedElement, path: ResolvedElement[]): void => {
    for (const c of el.children) {
      if (c.kind !== 'element' || keyword(c, 'display') === 'none') continue;
      if (shadowDeclaration(c) !== null && elementTransform(c).length > 0) {
        const found = scan(context, new Set(path), c);
        if (found !== null) out.push([c, found[0], found[1]]);
      }
      const own = stackingContextOf(c) !== null;
      visit(c, own ? c : context, own ? [] : [...path, c]);
    }
  };
  visit(root, root, []);
  return out;
}

/**
 * A shadow the native targets cannot draw as Chrome does is refused there at its box-shadow declaration: on html and body, on a
 * replaced element, on an inline box, on a positioned or layout- or paint-contained box, on a box with a perspective or a compositing
 * will-change, on a box whose transform is not a translate and positive scale or that has an inset shadow, and inside a transformed or composited box (Chrome blits the shadow into the group's own raster, not onto the page backdrop paint-shadow.ts composites over). The web
 * target draws all of them itself.
 */
const checkShadowedElement: PaintCheck = (el, targets, diagnostics, reported) => {
  const refuse = (at: ResolvedElement, why: (t: string) => { readonly what: string; readonly message: string; readonly manual: string } | null): void => {
    const v = shadowDeclaration(at);
    if (v === null || v.declaration === null) return;
    const span = v.declaration.valueSpan;
    for (const t of targets) {
      if (t === 'web') continue;
      const w = why(t);
      if (w === null) continue;
      const id = `${t}|shadow-${w.what}|${span.source.uri}|${span.start}|${at.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), target: t, message: w.message, manual: w.manual, basis: 'computed-value' }));
    }
  };
  refuse(el, (t) => unshadowed(el, t));
  if (el.element.tag === 'html') {
    for (const [s, under, why] of transformedOverUnheld(el)) {
      refuse(s, (t) => (unshadowed(s, t) !== null ? null : { what: 'transform-backdrop', message: `${s.element.address} has a box-shadow and a transform, so Chrome paints it after ${under.element.address}, whose ${why} ${t}'s shadow backdrop does not model`, manual: `Remove the ${why} from ${under.element.address}, or put the shadow on an untransformed element.` }));
    }
  }
  const group = groupOf(el);
  if (group === null) return;
  for (const s of shadowedBelow(el)) {
    refuse(s, (t) => ({
      what: 'in-group',
      message: `${s.element.address} has a box-shadow inside ${el.element.address}, whose ${group} makes it a compositing group in Chrome; ${t} composites the shadow onto the page backdrop, which PNT1 does not match inside a group yet`,
      manual: `Move the shadow outside ${el.element.address}, or remove its ${group}.`,
    }));
  }
};

// css-color-4 §4.4: currentcolor computes to itself, so box-shadow: inherit resolves it against the inheriting element's color. The
// computed list keeps its currentcolor form here, keyed by the value object inherit copies, and each element resolves it again.
const CURRENT_COLOR_SOURCE = new WeakMap<CssValue, readonly Shadow[]>();

/** The channels currentcolor takes: color's computed value, transparent as rgba(0, 0, 0, 0); null when color is not computed yet. */
function ownColor(v: CssValue | undefined): Rgba8 | null {
  if (v === undefined) return null;
  if (v.kind === 'color') return v.value;
  if (v.kind === 'keyword' && v.value === 'transparent') return TRANSPARENT;
  // Every other color value (system colours, other colour spaces) is refused at its declaration, so it cannot reach here.
  throw new Error(`color computed to ${JSON.stringify(v)}, which a currentcolor shadow cannot take`);
}

export const SHADOW_VALUES: PaintValues = {
  name: 'shadow',
  check: checkShadowedElement,
  compute: (props, ctx) => {
    const v = props.get('box-shadow');
    if (v === undefined || v.value.kind !== 'other' || v.value.type !== SHADOW_LIST) return;
    const own = ownColor(props.get('color')?.value);
    const shadows = CURRENT_COLOR_SOURCE.get(v.value) ?? shadowsOf(v.value);
    if (shadows === null) return;
    const source: Shadow[] = [];
    const out: Shadow[] = [];
    for (const s of shadows) {
      const [x, y, blur, spread] = [s.x, s.y, s.blur, s.spread].map((l) => computeLength(l, ctx));
      // A pass without font sizes or without color leaves the value as written.
      if (x == null || y == null || blur == null || spread == null) return;
      if (s.color === 'currentcolor' && own === null) return;
      source.push({ color: s.color, x, y, blur, spread, inset: s.inset });
      out.push({ color: s.color === 'currentcolor' ? (own as Rgba8) : s.color, x, y, blur, spread, inset: s.inset });
    }
    const value = shadowValue(out);
    if (source.some((s) => s.color === 'currentcolor')) CURRENT_COLOR_SOURCE.set(value, source);
    props.set('box-shadow', { ...v, value });
  },
};
