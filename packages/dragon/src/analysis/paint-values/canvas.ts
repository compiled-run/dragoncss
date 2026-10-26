// The canvas background (css-backgrounds-3 §2.11.2). The root element's background paints the whole canvas; when html's is none
// (a transparent colour and no image), body's is used instead and body paints none. Chrome 145 paints it in
// third_party/blink/renderer/core/paint/view_painter.cc ViewPainter::PaintRootElementGroup: the colour over the whole background
// rect, then every layer with background-clip ignored (box_background_paint_context.h EffectiveClip), positioned in the root
// element's box (box_background_paint_context.cc, the LayoutView constructor: positioning_box_ is RootBox and the positioning
// area its size, NormalPositioningArea). The native targets draw the layers in html's box view, where the ordinary background plan
// equals Chrome's whenever html starts at the canvas origin with no margin, border or padding and every layer is one no-repeat tile
// at the start of that box no larger than it: the plan's dest and positioning area are then html's border box, as Chrome's are.
// A repeating layer tiles across the canvas (the viewport and the document's overflow), so whether Chrome draws it as one tile, and
// through which shader, depends on the layout; the native targets refuse it. The canvas colour is painted by the root view.
import type { Rgba8 } from '../../css/color.ts';
import type { Longhand } from '../../css/properties.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import type { ElementLayer } from './gradient.ts';
import { BG2C, BG2_TILING, readableLayers, resolvedLayers } from './gradient.ts';

/** Chrome's base background, under the canvas (LocalFrameView::BaseBackgroundColor on the capture host). */
export const CANVAS_BASE: Rgba8 = { r: 255, g: 255, b: 255, alpha: 255 };

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** Each body child of an html element, by whether its background is the canvas's (decided at its html, canvasSourceOf). */
const BODIES = new WeakMap<ResolvedElement, { readonly html: ResolvedElement; readonly propagates: boolean }>();

/** Whether an element's background is none: a transparent colour and no image in any layer. */
function backgroundNone(el: ResolvedElement): boolean {
  if (usedColors(el)['background-color'].alpha !== 0) return false;
  const image = el.props.get('background-image' as Longhand)?.value;
  if (image === undefined || (image.kind === 'keyword' && image.value === 'none')) return true;
  // Layers whose lengths compute left unfolded are refused elsewhere; their images still count as an image here.
  return readableLayers(el) && resolvedLayers(el).every((l) => l.image.kind === 'none');
}

/**
 * The element whose background is the canvas's: html's own, or its first body child's when html's is none (css-backgrounds-3
 * §2.11.2). Records each body child of html for bodyPropagates; every walk reaches html before its body.
 */
export function canvasSourceOf(html: ResolvedElement): ResolvedElement {
  if (html.element.tag !== 'html') throw new Error(`${html.element.address}: the canvas source is decided at <html>, not <${html.element.tag}>`);
  const bodies = html.children.filter((c): c is ResolvedElement => c.kind === 'element' && c.element.tag === 'body');
  const first = bodies[0];
  const propagates = first !== undefined && backgroundNone(html);
  for (const b of bodies) BODIES.set(b, { html, propagates: propagates && b === first });
  return propagates && first !== undefined ? first : html;
}

/** Whether a body element's background is the canvas's (so its own box paints none); false for any other element. */
export function bodyPropagates(el: ResolvedElement): boolean {
  return el.element.tag === 'body' && BODIES.get(el)?.propagates === true;
}

/** Whether an element's background paints the canvas: html when its own is not none, or the body whose background propagates. */
export function isCanvasSource(el: ResolvedElement): boolean {
  if (el.element.tag === 'html') return canvasSourceOf(el) === el;
  return bodyPropagates(el);
}

/** Whether an element is html or the body whose background propagates, neither of which paints an ordinary box background. */
export function canvasElement(el: ResolvedElement): boolean {
  if (el.element.tag !== 'html') return bodyPropagates(el);
  canvasSourceOf(el);
  return true;
}

/** The html element of a canvas source. */
export function canvasRootOf(el: ResolvedElement): ResolvedElement {
  if (el.element.tag === 'html') return el;
  const b = BODIES.get(el);
  if (b === undefined) throw new Error(`${el.element.address}: no <html> decided whether this body's background propagates`);
  return b.html;
}

/**
 * The colour under the canvas layers in html's raster: the source's opaque colour, or Chrome's base white under a transparent one.
 * A translucent canvas colour is refused on the native targets (checkCanvasColor), since Chrome blends it with the base in floats.
 */
export function canvasRasterColor(source: ResolvedElement): Rgba8 {
  const c = usedColors(source)['background-color'];
  return c.alpha === 255 ? c : CANVAS_BASE;
}

const keyword = (el: ResolvedElement, p: string): string | null => {
  const v = el.props.get(p as Longhand)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : null;
};
/** Whether a length longhand computes to zero (0px or 0%). */
const zero = (el: ResolvedElement, p: string): boolean => {
  const v = el.props.get(p as Longhand)?.value;
  return v !== undefined && ((v.kind === 'length' && v.value === 0) || (v.kind === 'percentage' && v.value === 0));
};
const borderZero = (el: ResolvedElement, side: string): boolean => ['none', 'hidden'].includes(keyword(el, `border-${side}-style`) ?? '') || zero(el, `border-${side}-width`);

function refuse(el: ResolvedElement, at: ResolvedValue, native: readonly string[], key: string, message: string, manual: string, diagnostics: Diagnostic[], reported: Set<string>): void {
  const origin = at.declaration === null ? el.element.node.origin : authored(at.declaration.valueSpan);
  for (const t of native) {
    const id = `${t}|${key}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message, manual, basis: 'computed-value' }));
  }
}

/**
 * On the native targets: a canvas colour under an effect on html (checkCanvasEffect), or a translucent one, which Chrome blends with
 * its base white in floats (Color::Blend).
 */
export function checkCanvasColor(source: ResolvedElement, native: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const c = usedColors(source)['background-color'];
  if (c.alpha === 0) return;
  const at = source.props.get('background-color' as Longhand) as ResolvedValue;
  if (checkCanvasEffect(source, at, false, native, diagnostics, reported) || c.alpha === 255) return;
  refuse(source, at, native, 'canvas-color-translucent', `background-color on ${source.element.address}: a translucent colour on <${source.element.tag}> is the canvas background, which Chrome blends with its white base background in floating point, which the native targets do not model (${BG2C})`, `Give <${source.element.tag}> an opaque background-color, or put the translucent colour on a box inside it.`, diagnostics, reported);
}

/**
 * On the native targets: html translucent or filtered under a canvas background, or hidden under canvas layers. Chrome paints the
 * canvas in html's effect (view_painter.cc PaintRootElementGroup), while the native root view paints the canvas colour outside
 * html's box without it; and Chrome paints the canvas whatever html's visibility (ViewPainter::PaintBoxDecorationBackground reads
 * the view's own), while the native targets draw the layers in html's box view, which a hidden html would hide (a colour alone is
 * drawn by the root view and html's box regardless, visibility.ts). Whether anything was refused.
 */
function checkCanvasEffect(source: ResolvedElement, at: ResolvedValue, layers: boolean, native: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): boolean {
  if (native.length === 0) return false;
  const html = canvasRootOf(source);
  const visibility = keyword(html, 'visibility');
  const opacity = opacityOf((html.props.get('opacity' as Longhand) as ResolvedValue).value);
  const filter = keyword(html, 'filter');
  const hidden = layers && visibility !== 'visible';
  if (!hidden && opacity === 1 && filter === 'none') return false;
  const message = hidden
    ? `the canvas background of ${source.element.address}: <html> has visibility: ${visibility}, and Chrome paints the canvas whatever html's visibility, while the native targets draw the canvas layers in html's box view, which that hides (${BG2C})`
    : `the canvas background of ${source.element.address}: <html> has ${opacity !== 1 ? `opacity ${opacity}` : 'a filter'}, which Chrome applies to the whole canvas, while the native root view paints the canvas colour outside html's box without it (${BG2C})`;
  refuse(source, at, native, 'canvas-root-effect', message, 'Keep <html> visible, opaque and unfiltered, and set visibility, opacity or filter on a box inside body.', diagnostics, reported);
  return true;
}

/** Why a layer is not one no-repeat tile at the start of html's box, no larger than it, or null. */
function layerRefusal(l: ElementLayer): { readonly at: string; readonly reason: string } | null {
  const g = l.geometry;
  for (const [axis, r] of [['x', g.repeatX], ['y', g.repeatY]] as const) {
    if (r !== 'no-repeat') return { at: 'background-repeat', reason: `a ${r} layer on the canvas tiles from the root element's box across the whole canvas (the viewport and the document's overflow), so whether Chrome draws it as one tile, and through which shader, depends on the layout, which the native background plan does not model on the ${axis} axis (${BG2_TILING})` };
  }
  for (const [axis, p] of [['x', g.positionX], ['y', g.positionY]] as const) {
    if (!((p.unit === 'px' || p.unit === 'percent') && p.value === 0)) return { at: `background-position-${axis}`, reason: `a canvas layer away from the ${axis === 'x' ? 'left' : 'top'} edge of the root element's box may reach outside that box, where Chrome still paints it over the canvas, which the native background plan does not model (${BG2_TILING})` };
  }
  if (g.sizeKind === 'length') {
    for (const s of [g.sizeX, g.sizeY]) {
      if (s.unit === 'px' || (s.unit === 'percent' && (s.value < 0 || s.value > 100))) return { at: 'background-size', reason: `a canvas layer sized ${s.unit === 'px' ? 'in px' : `at ${s.value}%`} may be larger than the root element's box, and Chrome paints the part outside it over the canvas, which the native background plan does not model (${BG2_TILING})` };
    }
  }
  return null;
}

/**
 * The native refusals of a canvas source with a gradient layer: html must start at the canvas origin with no margin, border or
 * padding and be visible, opaque and unfiltered (checkCanvasEffect), and every layer must be one no-repeat tile at the start of html's box (layerRefusal).
 * Whether anything was refused; the ordinary layer checks then still run on the layers (gradient.ts checkBackgroundLayers).
 */
export function checkCanvasLayers(source: ResolvedElement, image: ResolvedValue, native: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): boolean {
  if (native.length === 0) return false;
  const html = canvasRootOf(source);
  const a = source.element.address;
  const box = [...SIDES.map((s) => `margin-${s}`), ...SIDES.map((s) => `padding-${s}`)].find((p) => !zero(html, p)) ?? (SIDES.find((s) => !borderZero(html, s)) === undefined ? null : 'border');
  if (box !== null) {
    refuse(source, image, native, 'canvas-root-box', `background-image on ${a}: the canvas layers are positioned in the root element's box, and <html> has a ${box === 'border' ? 'border' : box}, which the native targets do not model under a canvas gradient (${BG2C})`, 'Give <html> no margin, border or padding, and put them on body instead.', diagnostics, reported);
    return true;
  }
  if (checkCanvasEffect(source, image, true, native, diagnostics, reported)) return true;
  const layers = resolvedLayers(source);
  for (const l of layers) {
    if (l.image.kind !== 'gradient') continue;
    const why = layerRefusal(l);
    if (why === null) continue;
    const at = (source.props.get(why.at as Longhand) as ResolvedValue | undefined) ?? image;
    refuse(source, at, native, `canvas-layer-${why.at}`, `${why.at} on ${a}: ${why.reason}`, 'Draw the canvas gradient as one tile over the root element\'s box: background-repeat: no-repeat at position 0 0, size auto; with html or body at min-height: 100vh the tile still covers the screen.', diagnostics, reported);
    return true;
  }
  return false;
}
