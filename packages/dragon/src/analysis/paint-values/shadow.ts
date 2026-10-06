// Computed box-shadow (css-backgrounds-3 §7.1, css-values-4 §6, css-color-4 §4.4): every shadow length computes to px (em against
// the element's font size, rem against the root's) and currentcolor to the element's computed color, as Chrome 145 serializes it.
import type { Rgba8 } from '../../css/color.ts';
import type { Shadow, ShadowLength } from '../../css/properties/shadow.ts';
import { SHADOW_LIST, shadowsOf, shadowValue } from '../../css/properties/shadow.ts';
import { TRANSFORM_LIST_TYPE } from '../../css/properties/transform.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import { isReplacedTag } from '../elements/replaced.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { Longhand } from '../../css/properties.ts';
import type { Diagnostic } from '../../types.ts';
import { transformsDescendants } from './transform.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

function computeLength(l: ShadowLength, ctx: PaintValueContext): ShadowLength | null {
  if (l.unit === CANONICAL_LENGTH_UNIT) return l;
  const needs = l.unit === 'em' ? ctx.em : l.unit === 'rem' ? ctx.rem : 0;
  if (needs === null) return null;
  const px = lengthToPx(l.value, l.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  return px === null ? null : { value: px, unit: CANONICAL_LENGTH_UNIT };
}

/** Why a shadowed element is refused on a native target, with its fix, or null: what the companion-view shadow does not draw as Chrome does. */
function unshadowed(el: ResolvedElement, t: string): { readonly message: string; readonly manual: string } | null {
  const tag = el.element.tag;
  // The shadow composites onto its ancestors' backgrounds; html and body have none above them, and their backgrounds paint the canvas.
  if (tag === 'html' || tag === 'body') return { message: `<${tag}> ${el.element.address} has a box-shadow, which ${t} does not draw on the root or body`, manual: 'Put the shadow on a wrapper element inside body.' };
  // Blink paints an inset shadow beneath replaced content, which Dragon's image and web-view stages do not interleave with.
  if (isReplacedTag(tag)) return { message: `<${tag}> ${el.element.address} has a box-shadow, which ${t} does not draw on replaced content yet`, manual: 'Put the shadow on a wrapper element around the image or frame.' };
  // The outer shadows are a companion view beside the box, which the box's own transform does not move.
  const tr = (el.props.get('transform') as ResolvedValue | undefined)?.value;
  if (tr !== undefined && tr.kind === 'other' && tr.type === TRANSFORM_LIST_TYPE) return { message: `${el.element.address} has a box-shadow and a transform, which ${t} does not draw together yet (the shadow would not move with the box)`, manual: 'Put the transform on a wrapper element around the shadowed box.' };
  return null;
}

/** A shadowed element the native targets cannot draw as Chrome does is refused there at its box-shadow declaration; web draws it. */
const checkShadowedElement: PaintCheck = (el, targets, diagnostics, reported) => {
  const v = el.props.get('box-shadow') as ResolvedValue | undefined;
  if (v === undefined || v.declaration === null) return;
  const shadows = shadowsOf(v.value);
  if (shadows === null || shadows.length === 0) return;
  const span = v.declaration.valueSpan;
  for (const t of targets) {
    if (t === 'web') continue;
    const why = unshadowed(el, t);
    if (why === null) return;
    const id = `${t}|shadowed-element|${span.source.uri}|${span.start}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin: authored(span), target: t, message: why.message, manual: why.manual, basis: 'computed-value' }));
  }
};

export const SHADOW_VALUES: PaintValues = {
  name: 'shadow',
  check: checkShadowedElement,
  compute: (props, ctx) => {
    const v = props.get('box-shadow');
    if (v === undefined || v.value.kind !== 'other' || v.value.type !== SHADOW_LIST) return;
    const colorValue = props.get('color')?.value;
    const own: Rgba8 | null = colorValue !== undefined && colorValue.kind === 'color' ? colorValue.value : null;
    const shadows = shadowsOf(v.value);
    if (shadows === null) return;
    const out: Shadow[] = [];
    for (const s of shadows) {
      const [x, y, blur, spread] = [s.x, s.y, s.blur, s.spread].map((l) => computeLength(l, ctx));
      // The font-size pre-pass has no font sizes and no color yet: it leaves the value as written.
      if (x == null || y == null || blur == null || spread == null) return;
      if (s.color === 'currentcolor' && own === null) return;
      out.push({ color: s.color === 'currentcolor' ? (own as Rgba8) : s.color, x, y, blur, spread, inset: s.inset });
    }
    props.set('box-shadow', { ...v, value: shadowValue(out) });
  },
};

// ---------------------------------------------------------------- the backdrop a shadow is baked against (PNT1, PM ruling option 2)

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

/** A computed keyword of an element ('' for a property it does not hold or a value that is not a keyword). */
function keyword(el: ResolvedElement, p: string): string {
  const v = (el.props.get(p as Longhand) as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
}

/** Whether an element has a non-empty computed box-shadow list. */
function hasShadow(el: ResolvedElement): boolean {
  const v = (el.props.get('box-shadow') as ResolvedValue | undefined)?.value;
  const list = v === undefined ? null : shadowsOf(v);
  return list !== null && list.length > 0;
}

/** Whether an element paints a border: a side whose style draws and whose computed width is not 0. */
function hasBorder(el: ResolvedElement): boolean {
  return SIDES.some((side) => {
    const style = keyword(el, `border-${side}-style`);
    const w = (el.props.get(`border-${side}-width` as Longhand) as ResolvedValue | undefined)?.value;
    return style !== '' && style !== 'none' && style !== 'hidden' && !(w !== undefined && w.kind === 'length' && w.value === 0);
  });
}

/**
 * What an earlier-painted element paints beneath a later shadow that the device's baked backdrop (each earlier box's background
 * colour over its rounded border box, in paint order) does not model, or null when it paints nothing else. Text is not here: an
 * in-flow block box's background and shadow paint before every line of text in its stacking context (CSS2 Appendix E steps 4
 * and 7), except inside an atomically painted flex item, which shadowedAtomically covers.
 */
function unmodelledPaint(el: ResolvedElement, ancestor: boolean): string | null {
  if (hasBorder(el)) return 'a border';
  if (hasShadow(el)) return 'a box-shadow';
  const image = keyword(el, 'background-image');
  if (el.props.has('background-image' as Longhand) && image !== 'none') return 'a background image';
  const opacity = (el.props.get('opacity' as Longhand) as ResolvedValue | undefined)?.value;
  if (opacity !== undefined && !(opacity.kind === 'number' && opacity.value === 1)) return 'opacity';
  if (keyword(el, 'position') !== 'static') return `position: ${keyword(el, 'position')}`;
  if (transformsDescendants(el)) return 'a transform';
  if (isReplacedTag(el.element.tag)) return 'replaced content';
  // A non-ancestor that clips its overflow clips the backgrounds beneath it, which the baked backdrop leaves unclipped.
  if (!ancestor && ['hidden', 'clip', 'auto', 'scroll'].includes(keyword(el, 'overflow-x'))) return 'an overflow clip';
  return null;
}

/** A computed length in px, or null for anything else (a percentage, auto, a keyword). */
function pxOf(el: ResolvedElement, p: string): number | null {
  const v = (el.props.get(p as Longhand) as ResolvedValue | undefined)?.value;
  if (v === undefined) return null;
  if (v.kind === 'length' && v.unit === CANONICAL_LENGTH_UNIT) return v.value;
  if (v.kind === 'keyword' && v.value === 'normal' && (p === 'row-gap' || p === 'column-gap')) return 0;
  return null;
}

/**
 * How far past its border box an element's outer shadows can paint, in css px: the offset, the spread and the blur mask's margin
 * (Skia's Gaussian reaches 3 sigma, sigma being half the blur; paint-blur.ts boxBlurMargin), plus 2 px for the mask's rounding out.
 */
function shadowReach(el: ResolvedElement): number {
  const v = (el.props.get('box-shadow') as ResolvedValue | undefined)?.value;
  const list = v === undefined ? null : shadowsOf(v);
  if (list === null) return 0;
  let reach = 0;
  for (const s of list) {
    if (s.inset) continue;
    const [x, y, blur, spread] = [s.x, s.y, s.blur, s.spread].map((l) => (l.unit === CANONICAL_LENGTH_UNIT ? l.value : Infinity)) as [number, number, number, number];
    reach = Math.max(reach, Math.max(Math.abs(x), Math.abs(y)) + Math.max(spread, 0) + 1.5 * blur + 2);
  }
  return reach;
}

/**
 * Whether two sibling flex items are further apart than a's shadows and b's paint (reachB past its box) reach: items of one flex container with px gaps never
 * overlap and sit at least a gap apart (the column gap along a line, the row gap across lines) when no item reorders (order) or
 * has a margin that is not a px length of at least 0.
 */
function clearFlexSiblings(parent: ResolvedElement, a: ResolvedElement, b: ResolvedElement, reachB: number): boolean {
  if (keyword(parent, 'display') !== 'flex') return false;
  const items = parent.children.filter((c): c is ResolvedElement => c.kind === 'element' && keyword(c, 'display') !== 'none');
  if (!items.includes(a) || !items.includes(b)) return false;
  for (const it of items) {
    const o = (it.props.get('order') as ResolvedValue | undefined)?.value;
    if (o !== undefined && !(o.kind === 'number' && o.value === 0)) return false;
    if (SIDES.some((side) => { const m = pxOf(it, `margin-${side}`); return m === null || m < 0; })) return false;
  }
  const column = pxOf(parent, 'column-gap');
  const row = pxOf(parent, 'row-gap');
  if (column === null || row === null) return false;
  const direction = keyword(parent, 'flex-direction');
  const wraps = keyword(parent, 'flex-wrap') !== 'nowrap';
  const along = direction.startsWith('row') ? column : row;
  const gap = wraps ? Math.min(column, row) : along;
  return shadowReach(a) + reachB < gap;
}

/** Whether an ancestor clips its overflow on both axes at its padding box and has no inset shadow, which paints inside that box. */
function clipsAway(a: ResolvedElement): boolean {
  const clips = (k: string): boolean => k === 'hidden' || k === 'clip';
  const v = (a.props.get('box-shadow') as ResolvedValue | undefined)?.value;
  const list = v === undefined ? null : shadowsOf(v);
  return clips(keyword(a, 'overflow-x')) && clips(keyword(a, 'overflow-y')) && !(list ?? []).some((s) => s.inset);
}

/** Whether an element's text (its own text children) exists. */
const hasText = (el: ResolvedElement): boolean => el.children.some((c) => c.kind === 'text');

/** Every element of a subtree, the element first (display: none subtrees left out: they paint nothing). */
function subtree(el: ResolvedElement): ResolvedElement[] {
  if (keyword(el, 'display') === 'none') return [];
  return [el, ...el.children.flatMap((c) => (c.kind === 'element' ? subtree(c) : []))];
}

/**
 * The refusals of a shadow whose backdrop could hold what the device does not bake (PM ruling on shadows, option 2), on ios and
 * android: the device bakes each shadow against the backgrounds of every box painted before it in document order (its
 * ancestors and every earlier subtree), so the shadowed box must be an in-flow block or flex box that is not positioned or
 * transformed (nor any ancestor), no earlier-painted element may paint a border, a shadow, an image, a clip, opacity, a
 * transform or replaced content or be positioned, and inside a flex container, whose items paint atomically, no earlier item
 * of the shadowed box or of its ancestors may hold text or reorder (order). Conservative: no geometry is known at compile time.
 */
export function checkShadowBackdrops(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const earlier: ResolvedElement[] = [];
  const refuse = (el: ResolvedElement, message: string, manual: string): void => {
    const v = el.props.get('box-shadow') as ResolvedValue;
    const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
    for (const t of targets) {
      if (t === 'web') continue;
      const id = `${t}|shadow-backdrop|${JSON.stringify(origin)}|${el.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', { origin, target: t, message: `${el.element.address} has a box-shadow that may paint over ${message}, which ${t} does not bake into the shadow's backdrop yet`, manual, basis: 'computed-value' }));
    }
  };
  const check = (el: ResolvedElement, chain: readonly ResolvedElement[]): void => {
    const address = el.element.address;
    // checkShadowedElement already refuses these on their own (the root and body, replaced content, a transformed box).
    if (el.element.tag === 'html' || el.element.tag === 'body' || isReplacedTag(el.element.tag) || transformsDescendants(el)) return;
    const display = keyword(el, 'display');
    if (display !== 'block' && display !== 'flex') return refuse(el, `its own display: ${display} (inline-level boxes paint among text)`, `Give ${address} display: block or flex.`);
    for (const a of [...chain, el]) {
      const pos = keyword(a, 'position');
      if (pos !== 'static') return refuse(el, `the content beneath ${a.element.address}'s position: ${pos} layer`, 'Keep the shadowed box and its ancestors in flow (position: static).');
      if (transformsDescendants(a) && a !== el) return refuse(el, `the content beneath ${a.element.address}'s transformed layer`, 'Keep the shadowed box out of transformed elements.');
    }
    const ancestors = new Set(chain);
    const parent = chain[chain.length - 1];
    for (const e of earlier) {
      const what = unmodelledPaint(e, ancestors.has(e));
      if (what === null) continue;
      // An earlier flex sibling's border or shadow is clear of el when the gap between the two items exceeds both shadow extents.
      if ((what === 'a border' || what === 'a box-shadow') && parent !== undefined && clearFlexSiblings(parent, e, el, shadowReach(el))) continue;
      // Inside an ancestor that clips at its padding box, el's shadow stays in that box: an earlier flex sibling of the clipping
      // ancestor is clear when the gap exceeds its own reach alone.
      if ((what === 'a border' || what === 'a box-shadow') && chain.some((c, k) => k > 0 && clipsAway(c) && clearFlexSiblings(chain[k - 1] as ResolvedElement, e, c, 0))) continue;
      // An ancestor that clips its overflow at its padding box keeps el's shadow off its own border and outer shadows.
      if ((what === 'a border' || what === 'a box-shadow') && ancestors.has(e) && clipsAway(e)) continue;
      return refuse(el, `${e.element.address} (${what})`, `Remove the shadow from ${address}, or ${what} from ${e.element.address}, or keep the two flex items further apart than both shadows reach.`);
    }
    // A flex item paints atomically (css-flexbox-1 §4.3): every earlier item of the shadowed box's flex ancestry is wholly beneath.
    for (const [k, a] of [...chain, el].entries()) {
      const parent = k === 0 ? null : ([...chain, el][k - 1] as ResolvedElement);
      if (parent === null || keyword(parent, 'display') !== 'flex') continue;
      const items = parent.children.filter((c): c is ResolvedElement => c.kind === 'element');
      if (items.some((c) => { const o = (c.props.get('order') as ResolvedValue | undefined)?.value; return o !== undefined && !(o.kind === 'number' && o.value === 0); })) return refuse(el, `the items of ${parent.element.address}, which order reorders`, 'Remove order from the flex items, or the shadow.');
      if (hasText(parent)) return refuse(el, `the text of the flex container ${parent.element.address}`, 'Wrap the text in an element after the shadowed item, or remove the shadow.');
      for (const item of items.slice(0, items.indexOf(a))) {
        const text = subtree(item).find(hasText);
        if (text !== undefined) return refuse(el, `the text of ${text.element.address}, an earlier flex item painted wholly beneath`, `Move ${a.element.address} before ${item.element.address}, or remove the shadow.`);
      }
    }
  };
  const walk = (el: ResolvedElement, chain: readonly ResolvedElement[]): void => {
    if (keyword(el, 'display') === 'none') return;
    if (hasShadow(el)) check(el, chain);
    earlier.push(el);
    for (const c of el.children) if (c.kind === 'element') walk(c, [...chain, el]);
  };
  walk(root, []);
}
