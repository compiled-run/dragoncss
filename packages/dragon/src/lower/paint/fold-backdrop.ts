// PNT1-opacity-b: where a folded fill's backdrop is its ancestors' background colours and nothing else, so native may draw it as
// Chrome's opaque bytes over that backdrop (emit/paint/background.ts). The fill is a leaf whose ancestors each paint only a
// square, unclipped background colour. Every other box that paints anything is a rival: the device folds the fill only while no
// rival's border box meets the fill's (emit/paint/background.ts dragonFoldClear, after every layout), so the proof needs each
// rival's paint to stay inside its border box and to move only with a layout: no shadow, outline, text, replaced content or
// control, no transform, filter or moving transform, and no scroll container, fixed or sticky box, transform or filter at or above
// it (a static transform on a wrapper that paints nothing still moves the rival's paint off its layout box). A box with no native
// node (display: contents) paints nothing. A leaf with no rival needs no geometry (the earlier, geometry-free proof). Anything else
// keeps the platform blend.
import { isReplacedTag, SVG_SHAPE_TAGS } from '../../analysis/elements/replaced.ts';
import { rounds } from '../../analysis/paint-values/outline.ts';
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { SIDES } from '../../css/properties.ts';
import { opacityOf, zIndexOf } from '../../css/properties/effects.ts';
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

/** The most rivals one folded fill checks at run time; a fill with more keeps the platform blend. */
export const FOLD_MAX_RIVALS = 64;

/** Longhands a rival must leave at these values: it paints inside its border box, and only a layout moves it. */
const RIVAL: readonly (readonly [string, readonly string[]])[] = [
  ['box-shadow', ['none']], ['outline-style', ['none']], ['text-shadow', ['none']], ['filter', ['none']], ['backdrop-filter', ['none']],
  ['transform', ['none']], ['rotate', ['none']], ['scale', ['none']], ['translate', ['none']], ['border-image-source', ['none']],
];

/** Longhands every box at or above a rival must leave at these values: they move or spread paint off its layout box. */
const PLACED: readonly (readonly [string, readonly string[]])[] = [
  ['transform', ['none']], ['rotate', ['none']], ['scale', ['none']], ['translate', ['none']], ['filter', ['none']], ['backdrop-filter', ['none']],
];

/**
 * The leaves whose folded fill may have a provable backdrop (see the header), by address, each with its rivals' addresses (empty
 * where none paints, so no geometry is needed).
 */
export function provableFoldBackdrops(root: ResolvedElement, moving: ReadonlySet<string>): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  // Every box that paints anything of its own, with whether its paint stays in its border box and moves only with a layout.
  const painters: { readonly el: ResolvedElement; readonly bound: boolean }[] = [];
  const walk = (el: ResolvedElement, path: readonly ResolvedElement[], pathPaint: boolean, unscrolled: boolean): void => {
    if (kw(el, 'display') === 'none') return;
    const here = [...path, el];
    const position = kw(el, 'position');
    const still = unscrolled && position !== 'fixed' && position !== 'sticky' && !moving.has(el.element.address) && keeps(el, PLACED);
    if (!paintsNothing(el)) painters.push({ el, bound: still && rivalPaint(el) });
    // A negative z-index on the leaf or any ancestor paints the leaf beneath some ancestor's background (see beneath).
    const ok = pathPaint && ancestorPaint(el) && !moving.has(el.element.address) && !beneath(el);
    const scrolls = ['overflow-x', 'overflow-y'].some((p) => ['auto', 'scroll'].includes(kw(el, p) ?? 'visible'));
    for (const c of el.children) {
      if (c.kind !== 'element') continue;
      if (c.children.length === 0 && ok && !moving.has(c.element.address) && kw(c, 'display') !== 'none' && !beneath(c)) leaves.push({ el: c, path: here });
      walk(c, here, ok, still && !scrolls);
    }
  };
  const leaves: { readonly el: ResolvedElement; readonly path: readonly ResolvedElement[] }[] = [];
  walk(root, [], true, true);
  for (let i = 0; i < leaves.length; i++) {
    const { el, path } = leaves[i] as { readonly el: ResolvedElement; readonly path: readonly ResolvedElement[] };
    const onPath = new Set([...path, el]);
    const rivals = painters.filter((p) => !onPath.has(p.el));
    if (rivals.length > FOLD_MAX_RIVALS || rivals.some((p) => !p.bound)) continue;
    out.set(el.element.address, rivals.map((p) => p.el.element.address));
  }
  return out;
}

/**
 * A negative z-index on the fill or an ancestor: that box paints beneath the backgrounds of the boxes above it inside its stacking
 * context, so the fill's backdrop is not every ancestor's (emit/paint/background.ts dragonFoldBackdrop). Read whether or not it
 * applies (a static non-item ignores it), and on every box of the path, past the stacking context: both only refuse more.
 */
function beneath(el: ResolvedElement): boolean {
  const v = el.props.get('z-index')?.value;
  const z = v === undefined ? null : zIndexOf(v);
  return z !== null && z < 0;
}

/** A rival's own paint: inside its border box (no shadow, outline, text, replaced content or control) and unmoved but by layout. */
function rivalPaint(el: ResolvedElement): boolean {
  // An inline box paints line fragments, not one border box the device can check.
  if (selfPainting(el) || !keeps(el, RIVAL) || kw(el, 'display') === 'inline') return false;
  return !el.children.some((c) => c.kind === 'text' && c.text.trim() !== '');
}

/**
 * A box that paints nothing of its own (its children aside): no colour, image, border, outline, shadow, text or replaced content,
 * or no box and no text (display: contents: no native node to check, and its colours paint nowhere; its text still paints, so it
 * stays a rival, and one that refuses).
 */
function paintsNothing(el: ResolvedElement): boolean {
  const text = el.children.some((c) => c.kind === 'text' && c.text.trim() !== '');
  if (kw(el, 'display') === 'contents') return !text;
  if (selfPainting(el) || usedColors(el)['background-color'].alpha !== 0 || !keeps(el, INERT)) return false;
  if (!SIDES.every((s) => unpaintedBorder(el, s))) return false;
  return !text;
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

