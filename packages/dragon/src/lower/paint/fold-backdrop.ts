// PNT1-opacity-b: where a folded fill's backdrop is provably its ancestors' background colours and nothing else, so native may draw
// it as Chrome's opaque bytes over that backdrop (emit/paint/background.ts). Proven without geometry: no box in the document but the
// folded box and its ancestors paints anything at all, so nothing else can lie under it wherever layout puts it, and each ancestor
// paints only a square, unclipped background colour. Anything else keeps the platform blend.
import { isReplacedTag, SVG_SHAPE_TAGS } from '../../analysis/elements/replaced.ts';
import { rounds } from '../../analysis/paint-values/outline.ts';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { SIDES } from '../../css/properties.ts';
import { opacityOf } from '../../css/properties/effects.ts';
import { usedColors } from './colors.ts';

/** Longhands an ancestor must leave at these values: its one paint is a square border-box colour, unlayered and unmoved. */
const ANCESTOR: readonly (readonly [string, readonly string[]])[] = [
  ['background-image', ['none']], ['border-image-source', ['none']], ['box-shadow', ['none']], ['outline-style', ['none']], ['mask-image', ['none']],
  ['clip-path', ['none']], ['clip', ['auto']], ['background-clip', ['border-box']], ['overflow-x', ['visible']], ['overflow-y', ['visible']],
  ['filter', ['none']], ['backdrop-filter', ['none']], ['mix-blend-mode', ['normal']], ['transform', ['none']], ['rotate', ['none']],
  ['scale', ['none']], ['translate', ['none']], ['perspective', ['none']], ['will-change', ['auto']], ['text-shadow', ['none']],
];
/** Longhands a box that paints nothing must leave at these values. */
const INERT: readonly (readonly [string, readonly string[]])[] = [
  ['background-image', ['none']], ['border-image-source', ['none']], ['box-shadow', ['none']], ['outline-style', ['none']],
];
/** Tags whose box paints something of its own whatever its style: a control or its parts. */
const SELF_PAINTING: ReadonlySet<string> = new Set(['input', 'button', 'select', 'option', 'optgroup', 'textarea', 'progress', 'meter', 'fieldset', 'legend', 'details', 'summary', 'hr']);

/** The addresses of the leaves whose folded fill has a provable backdrop (see the header). */
export function provableFoldBackdrops(root: ResolvedElement, moving: ReadonlySet<string>): ReadonlySet<string> {
  const out = new Set<string>();
  // A leaf qualifies when every box off its path is inert and every box on it paints only a colour: walk down while exactly one
  // child is not inert, and take that child when it is a leaf.
  let el = root;
  for (;;) {
    if (!ancestorPaint(el) || moving.has(el.element.address)) return out;
    const painting = el.children.filter((c): c is ResolvedElement => c.kind === 'element' && !inert(c));
    if (painting.length !== 1) return out;
    const k = painting[0] as ResolvedElement;
    if (k.children.length === 0) {
      if (!moving.has(k.element.address)) out.add(k.element.address);
      return out;
    }
    el = k;
  }
}

function kw(el: ResolvedElement, p: string): string | null {
  const v = el.props.get(p as never)?.value;
  return v === undefined ? null : v.kind === 'keyword' ? v.value : '';
}

function keeps(el: ResolvedElement, rules: readonly (readonly [string, readonly string[]])[]): boolean {
  return rules.every(([p, ok]) => { const k = kw(el, p); return k === null || ok.includes(k); });
}

function zero(el: ResolvedElement, p: string): boolean {
  const v = el.props.get(p as never)?.value;
  return v === undefined || ((v.kind === 'length' || v.kind === 'percentage') && v.value === 0);
}

function unpaintedBorder(el: ResolvedElement, side: string): boolean {
  const style = kw(el, `border-${side}-style`);
  return style === null || style === 'none' || style === 'hidden' || zero(el, `border-${side}-width`);
}

function selfPainting(el: ResolvedElement): boolean {
  return SELF_PAINTING.has(el.element.tag) || isReplacedTag(el.element.tag) || SVG_SHAPE_TAGS.includes(el.element.tag) || kw(el, 'display') === 'list-item';
}

/** A box on the path: unlayered, one square background colour, no painted border, outline or shadow, and no text of its own. */
function ancestorPaint(el: ResolvedElement): boolean {
  if (selfPainting(el) || !keeps(el, ANCESTOR) || !SIDES.every((s) => unpaintedBorder(el, s))) return false;
  const o = el.props.get('opacity')?.value;
  if (o !== undefined && opacityOf(o) !== 1) return false;
  if (el.children.some((c) => c.kind === 'text' && c.text.trim() !== '')) return false;
  return !rounds(el);
}

/** A box that paints nothing at all: no colour, image, border, outline, shadow, text or replaced content, and nothing inside that does. */
function inert(el: ResolvedElement): boolean {
  if (kw(el, 'display') === 'none') return true;
  if (selfPainting(el) || usedColors(el)['background-color'].alpha !== 0 || !keeps(el, INERT)) return false;
  if (!SIDES.every((s) => unpaintedBorder(el, s))) return false;
  return el.children.every((c) => (c.kind === 'text' ? c.text.trim() === '' : inert(c)));
}
