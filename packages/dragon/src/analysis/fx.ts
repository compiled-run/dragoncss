// FX-0: backdrop-filter and mix-blend-mode on native where Chrome 145 draws exactly what it draws without them. Native draws
// neither, so a box with one is drawn there only when Chrome's composite is the identity, measured byte-identical with and without
// the declaration in Chrome 145 at DPR 1 and 2:
// - the box's layer holds only fully opaque or fully transparent pixels: square opaque fills and solid opaque borders of one colour,
//   and no text (glyph edges are anti-aliased into partial alpha wherever a line leaves an opaque fill, which Chrome's layer composite
//   rounds one off a direct draw);
// - nothing animates or transitions anywhere (refuseAnimatedFx), since each case is checked with its static values;
// - the backdrop is one opaque colour everywhere: the page paints nothing outside the box but backgrounds of the canvas colour (Chrome
//   crops a backdrop filter's input to the enclosing pixel rect of the border box, PaintLayer::BackdropFilterBounds, so it reads and
//   repaints the device pixels it shares with a neighbour at a fractional edge, and nothing else may paint there).
// Then backdrop-filter: a list of blur() is the backdrop itself (a blur of one colour is that colour, cropped with a mirror edge mode,
// paint_layer.cc UpdateCompositorFilterOperationsForBackdropFilter), and mix-blend-mode multiply or darken over opaque white is
// source-over (multiply: s(1 - da) + d(1 - sa) + sd = s + 255 - sa, darken: s + d - max(s da, d sa) = s + 255 - sa, at d = da = 255).
// Every other value, and every other case, is refused on native; web emits both as computed.
import type { AnimationAnalysis } from './animations.ts';
import type { Rgba8 } from '../css/color.ts';
import { SIDES } from '../css/properties.ts';
import { opacityOf } from '../css/properties/effects.ts';
import { blendModeOf, filterFunctionNames, hasBackdropFilter } from '../css/properties/fx.ts';
import { cornerComponents } from '../css/properties/radius.ts';
import { authored, diagnostic } from '../diagnostics/catalogue.ts';
import { usedColors } from '../lower/paint/colors.ts';
import { transformedForStacking } from '../lower/paint/stacking.ts';
import type { Diagnostic } from '../types.ts';
import type { ResolvedValue } from './computed.ts';
import { paintedOutlineStyle } from './paint-values/outline.ts';
import type { ResolvedElement } from './resolve.ts';
import { valueToString } from './resolve.ts';

/** The tags whose box paints only its own background, borders and text: no control, replaced content, marker or legend. */
const PLAIN_TAGS: ReadonlySet<string> = new Set(['html', 'body', 'div', 'section', 'article', 'main', 'header', 'footer', 'nav', 'aside', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span']);
/** The blend modes that are source-over on an opaque white backdrop. */
export const WHITE_IDENTITY_BLENDS: readonly string[] = ['multiply', 'darken'];

const WHITE: Rgba8 = { r: 255, g: 255, b: 255, alpha: 255 };
const sameColour = (a: Rgba8, b: Rgba8): boolean => a.r === b.r && a.g === b.g && a.b === b.b && a.alpha === b.alpha;
const keyword = (el: ResolvedElement, p: string): string => {
  const v = el.props.get(p as never)?.value;
  return v === undefined ? '' : v.kind === 'keyword' ? v.value : valueToString(v);
};
const displayOf = (el: ResolvedElement): string => keyword(el, 'display');
const zeroLength = (el: ResolvedElement, p: string): boolean => {
  const v = el.props.get(p as never)?.value;
  return v !== undefined && v.kind === 'length' && v.value === 0;
};

/** The canvas colour Chrome paints (css-backgrounds-3 §2.11.2): the root's background, else body's, else white; null if translucent. */
function canvasColour(root: ResolvedElement): Rgba8 | null {
  const body = root.children.find((c): c is ResolvedElement => c.kind === 'element' && c.element.tag === 'body');
  for (const el of [root, body]) {
    if (el === undefined) continue;
    const bg = usedColors(el)['background-color'];
    if (bg.alpha === 255) return bg;
    if (bg.alpha !== 0) return null;
  }
  return WHITE;
}

/** Why el's border sides are not one solid opaque colour or none (null when they are). */
function borderProblem(el: ResolvedElement): string | null {
  const colors = usedColors(el);
  const painted: Rgba8[] = [];
  for (const side of SIDES) {
    const style = keyword(el, `border-${side}-style`);
    if (style === 'none' || style === 'hidden' || zeroLength(el, `border-${side}-width`)) continue;
    if (style !== 'solid') return `a ${style} border`;
    const c = colors[`border-${side}-color` as 'border-top-color'];
    if (c.alpha !== 255) return 'a translucent border';
    painted.push(c);
  }
  return painted.some((c) => !sameColour(c, painted[0] as Rgba8)) ? 'border sides in more than one colour, which meet on an anti-aliased diagonal' : null;
}

const rounded = (el: ResolvedElement): boolean =>
  ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'].some((p) => {
    const v = el.props.get(p as never)?.value;
    const parts = v === undefined ? null : cornerComponents(v);
    return parts === null || (parts[0].value !== 0 && parts[1].value !== 0);
  });

/** Why a box outside the FX box paints something (null when it paints at most a background of the canvas colour). */
function outsideProblem(el: ResolvedElement, canvas: Rgba8): string | null {
  const a = `<${el.element.tag}> ${el.element.address}`;
  if (!PLAIN_TAGS.has(el.element.tag)) return `${a} is a <${el.element.tag}>, which paints content of its own`;
  if (displayOf(el) === 'list-item') return `${a} is a list item, which paints a marker`;
  const bg = usedColors(el)['background-color'];
  if (bg.alpha !== 0 && !sameColour(bg, canvas)) return `${a} paints a background other than the canvas colour`;
  if (keyword(el, 'background-image') !== 'none') return `${a} paints a background image`;
  if (SIDES.some((s) => !['none', 'hidden'].includes(keyword(el, `border-${s}-style`)) && !zeroLength(el, `border-${s}-width`))) return `${a} paints a border`;
  if (paintedOutlineStyle(el) !== null) return `${a} paints an outline`;
  if (keyword(el, 'box-shadow') !== 'none') return `${a} paints a box-shadow`;
  if (el.children.some((c) => c.kind === 'text')) return `${a} paints text`;
  return null;
}

/** Why an ancestor of the FX box changes how it composites (null when it does not): a group, layer, clip or decoration. */
function ancestorProblem(el: ResolvedElement, propagated: ResolvedElement | null): string | null {
  const a = `<${el.element.tag}> ${el.element.address}`;
  const opacity = opacityOf((el.props.get('opacity') as ResolvedValue).value);
  if (opacity !== 1) return `it is inside ${a}, which has opacity ${opacity}`;
  if (transformedForStacking(el)) return `it is inside ${a}, a stacking context`;
  if (keyword(el, 'position') !== 'static') return `it is inside ${a}, which is positioned`;
  if (el !== propagated && ['overflow-x', 'overflow-y'].some((p) => keyword(el, p) !== 'visible')) return `it is inside ${a}, which clips or scrolls`;
  if (keyword(el, 'text-decoration-line') !== 'none') return `it is inside ${a}, whose text decoration reaches its text`;
  return null;
}

/** Longhands that must hold these values on the FX box and every box in it: anything else paints translucently, composites or moves. */
const MEMBER_KEYWORDS: readonly (readonly [string, readonly string[]])[] = [
  ['box-shadow', ['none']], ['background-image', ['none']], ['filter', ['none']], ['clip-path', ['none']], ['clip', ['auto']],
  ['transform', ['none']], ['translate', ['none']], ['rotate', ['none']], ['scale', ['none']], ['perspective', ['none']],
  ['will-change', ['auto']], ['isolation', ['auto']], ['float', ['none']], ['overflow-x', ['visible']], ['overflow-y', ['visible']], ['visibility', ['visible']], ['text-shadow', ['none']],
  ['text-decoration-line', ['none']], ['-webkit-text-fill-color', ['currentcolor']],
];

/** Why a box of the FX box's subtree (itself included) draws a pixel that is not fully opaque or fully transparent (null when not). */
function memberProblem(m: ResolvedElement, box: ResolvedElement): string | null {
  const a = `<${m.element.tag}> ${m.element.address}`;
  if (!PLAIN_TAGS.has(m.element.tag) || m.element.tag === 'html' || m.element.tag === 'body' || m.element.tag === 'span') return `${a} is a <${m.element.tag}>, not a plain block box`;
  if (!['block', 'flex'].includes(displayOf(m))) return `${a} has display ${displayOf(m)}, not block or flex`;
  const position = keyword(m, 'position');
  if (!(position === 'static' || (m === box && position === 'relative'))) return `${a} has position ${position}`;
  for (const [p, ok] of MEMBER_KEYWORDS) if (!ok.includes(keyword(m, p))) return `${a} has ${p}: ${keyword(m, p)}`;
  if (m !== box && (hasBackdropFilter(m.props.get('backdrop-filter')?.value) || blendModeOf(m.props.get('mix-blend-mode')?.value) !== 'normal')) return `${a} inside it has a backdrop-filter or mix-blend-mode of its own`;
  const opacity = opacityOf((m.props.get('opacity') as ResolvedValue).value);
  if (opacity !== 1) return `${a} has opacity ${opacity}`;
  if (!zeroLength(m, '-webkit-text-stroke-width')) return `${a} has a text stroke`;
  const colors = usedColors(m);
  if (colors['background-color'].alpha !== 0 && colors['background-color'].alpha !== 255) return `${a} has a translucent background`;
  if (rounded(m)) return `${a} has a border radius, whose curve is anti-aliased`;
  const border = borderProblem(m);
  if (border !== null) return `${a} has ${border}`;
  if (paintedOutlineStyle(m) !== null) return `${a} has an outline`;
  // Text is anti-aliased into partial alpha wherever it is not over an opaque fill, and a line can overflow its fill (sideways or
  // below) where the layout puts it, which this pass does not see, so no text is admitted inside the box.
  if (m.children.some((c) => c.kind === 'text' && c.text.trim() !== '')) return `${a} holds text, whose glyph edges Chrome's layer composite can round off a direct draw`;
  return null;
}

/** Why Chrome would change a pixel by el's FX declaration of property p (null when it changes none). */
function fxProblem(el: ResolvedElement, p: FxProperty, ancestors: readonly ResolvedElement[], root: ResolvedElement, propagated: ResolvedElement | null): string | null {
  const bf = el.props.get('backdrop-filter')?.value;
  const mode = blendModeOf(el.props.get('mix-blend-mode')?.value);
  if (hasBackdropFilter(bf) && mode !== 'normal') return 'it has both a backdrop-filter and a mix-blend-mode';
  if (p === 'backdrop-filter') {
    const names = bf !== undefined && bf.kind === 'other' ? filterFunctionNames(bf.text) : [];
    const other = names.find((n) => n !== 'blur');
    if (names.length === 0 || other !== undefined) return `the list holds ${other ?? 'no function'}, and only blur() leaves a backdrop of one colour as it is`;
  } else if (!WHITE_IDENTITY_BLENDS.includes(mode)) return `${mode} changes the colour of what it blends over opaque white; only multiply and darken leave it as it is`;
  const canvas = canvasColour(root);
  if (canvas === null) return 'the canvas colour is translucent';
  if (p === 'mix-blend-mode' && !sameColour(canvas, WHITE)) return 'the backdrop is not opaque white';
  for (const a of ancestors) {
    const bad = ancestorProblem(a, propagated);
    if (bad !== null) return bad;
  }
  // Inside the box: every member's pixels fully opaque or fully transparent.
  const inside = (m: ResolvedElement): string | null => {
    if (displayOf(m) === 'none') return null;
    const bad = memberProblem(m, el);
    if (bad !== null) return bad;
    for (const c of m.children) if (c.kind === 'element') {
      const deeper = inside(c);
      if (deeper !== null) return deeper;
    }
    return null;
  };
  const own = inside(el);
  if (own !== null) return own;
  // Outside the box: nothing paints but backgrounds of the canvas colour, so the backdrop is that colour at every device pixel.
  const outside = (o: ResolvedElement): string | null => {
    if (o === el || displayOf(o) === 'none') return null;
    const bad = outsideProblem(o, canvas);
    if (bad !== null) return `${bad} outside it, so the backdrop is not one colour`;
    for (const c of o.children) if (c.kind === 'element') {
      const deeper = outside(c);
      if (deeper !== null) return deeper;
    }
    return null;
  };
  return outside(root);
}

/**
 * The FX-0 refusals on the native targets: a backdrop-filter other than none or a mix-blend-mode other than normal where Chrome's
 * pixels would differ from what native draws (the element as if neither were set), once per element and property.
 */
export function checkFx(root: ResolvedElement, propagated: ResolvedElement | null, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const native = targets.filter((t) => t !== 'web');
  if (native.length === 0) return;
  eachFx(root, (el, p, v, ancestors) => {
    const why = fxProblem(el, p, ancestors, root, propagated);
    if (why !== null) refuseFx(el, p, v, why, native, diagnostics, reported);
  });
}

/**
 * The FX-0 refusals of motion on the native targets: checkFx judges each case by its static values, but a keyframe animation or a
 * transition (of any duration) anywhere on the page can repaint the box or its backdrop while it runs, so every FX declaration of a
 * page that animates is refused.
 */
export function refuseAnimatedFx(analysis: AnimationAnalysis, roots: readonly ResolvedElement[], nativeTargets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  if (nativeTargets.length === 0) return;
  let moving: string | null = null;
  for (const c of analysis.cases) {
    for (const [address, e] of c.elements) {
      if (moving === null && (e.animations.some((a) => a.hasKeyframes) || [...e.listings.values()].some((l) => l.mode === 'listed' && l.duration > 0))) moving = address;
    }
  }
  if (moving === null) return;
  const why = `${moving} has an animation or transition, which can repaint the box or its backdrop while it runs`;
  for (const root of roots) eachFx(root, (el, p, v) => refuseFx(el, p, v, why, nativeTargets, diagnostics, reported));
}

/** Each displayed element with a backdrop-filter other than none or a mix-blend-mode other than normal, per property. */
function eachFx(root: ResolvedElement, visit: (el: ResolvedElement, p: FxProperty, v: ResolvedValue, ancestors: readonly ResolvedElement[]) => void): void {
  const walk = (el: ResolvedElement, ancestors: readonly ResolvedElement[]): void => {
    if (displayOf(el) === 'none') return;
    for (const p of ['backdrop-filter', 'mix-blend-mode'] as const) {
      const v = el.props.get(p);
      if (v === undefined || (p === 'backdrop-filter' ? !hasBackdropFilter(v.value) : blendModeOf(v.value) === 'normal')) continue;
      visit(el, p, v, ancestors);
    }
    for (const c of el.children) if (c.kind === 'element') walk(c, [el, ...ancestors]);
  };
  walk(root, []);
}

type FxProperty = 'backdrop-filter' | 'mix-blend-mode';

/** Refuses el's FX declaration of p on the native targets, once per target, element and property. */
function refuseFx(el: ResolvedElement, p: FxProperty, v: ResolvedValue, why: string, native: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const origin = v.declaration !== null ? authored(v.declaration.valueSpan) : el.element.node.origin;
  for (const t of native) {
    const id = `${t}|fx|${p}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: p === 'backdrop-filter'
        ? `backdrop-filter: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is not drawn on ${t} yet (package FX): Dragon draws one only where Chrome changes no pixel, a list of blur() over a page that paints one opaque colour outside the box and does not animate, with only opaque fills and solid borders and no text inside it; here ${why}`
        : `mix-blend-mode: ${valueToString(v.value)} on <${el.element.tag}> ${el.element.address} is not drawn on ${t} yet (package FX): Dragon draws one only where Chrome changes no pixel, multiply or darken over a page that paints only opaque white outside the box and does not animate, with only opaque fills and solid borders and no text inside it; here ${why}`,
      manual: `Remove the ${p} from ${el.element.address}, or keep its page and content to what Chrome draws unchanged.`,
      basis: 'computed-value',
    }));
  }
}
