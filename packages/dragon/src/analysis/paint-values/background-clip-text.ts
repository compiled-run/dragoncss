// background-clip: text over a background colour (css-backgrounds-4 §2.1). Chrome 145 paints the colour through the coverage of the
// box's glyphs (BoxPainterBase::PaintFillLayers with a text clip mask, then the text over it). Dragon draws the two cases that are
// exact with one glyph draw: a transparent colour (nothing to paint, the text draws as before) and transparent text over a colour
// (each glyph draws in the background colour, the coverage Chrome masks the colour with). The lowering suppresses the box's own
// colour and repaints its texts; everything else that clips to text is refused where it applies (gradient.ts checkTextClip).
import type { Rgba8 } from '../../css/color.ts';
import { cornerComponents, RADIUS_LONGHANDS } from '../../css/properties/radius.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import type { ElementLayer } from './gradient.ts';

/** Whether the bottom layer, whose clip clips the background colour, clips to text. */
export function colourClipsToText(layers: readonly ElementLayer[]): boolean {
  return layers[layers.length - 1]?.clipsToText === true;
}

/** The colour a box's glyphs draw in when it clips a painted (not fully transparent) background colour to its text; null otherwise. */
export function textClipFill(el: ResolvedElement, layers: readonly ElementLayer[]): Rgba8 | null {
  if (!colourClipsToText(layers)) return null;
  const bg = usedColors(el)['background-color'];
  return bg.alpha === 0 ? null : bg;
}

const keywordOf = (el: ResolvedElement, p: string): string => {
  const v = (el.props.get(p as never) as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

const pxOf = (el: ResolvedElement, p: string): number | null => {
  const v = (el.props.get(p as never) as ResolvedValue | undefined)?.value;
  return v !== undefined && v.kind === 'length' && v.unit === 'px' ? v.value : null;
};

/** Why a text clip is refused on every target, or null: a clipped image, or the root and body, whose background paints the canvas. */
export function textClipRefusal(el: ResolvedElement, layers: readonly ElementLayer[]): string | null {
  if (!layers.some((l) => l.clipsToText)) return null;
  if (layers.some((l) => l.image.kind !== 'none')) return 'a background image clipped to text is not drawn by Dragon yet; only a background colour is';
  if (el.element.tag === 'html' || el.element.tag === 'body') return `the background of <${el.element.tag}> paints the canvas (css-backgrounds-3 §2.11.2), which Dragon does not clip to text`;
  return null;
}

/**
 * Why the native targets refuse a box's text clip, or null. A painted colour clipped to text draws natively only as the glyphs of
 * the box's own text runs in that colour, with nothing the colour would show under: so the text itself must be transparent, the
 * box a block holding text only, with no border, radius, shadow, overflow clip, text shadow or decoration, and its color its own.
 * Transparent text over a transparent colour would hide the text (the accessibility rule), so it is refused too.
 */
export function nativeTextClipRefusal(el: ResolvedElement, layers: readonly ElementLayer[]): string | null {
  if (!colourClipsToText(layers)) return null;
  const colors = usedColors(el);
  const bg = colors['background-color'];
  const fg = colors.color;
  if (bg.alpha === 0) return fg.alpha === 0 ? 'the text is transparent and so is the background colour clipped to it, so the text would not show; Dragon refuses text that cannot be seen' : null;
  if (fg.alpha !== 0) return 'the text is not transparent: Chrome draws it over the background colour seen through the same glyph coverage, which one native glyph draw matches only for transparent text';
  const display = keywordOf(el, 'display');
  if (!['block', 'flow-root', 'flex', 'grid'].includes(display)) return `the box is display: ${display || 'other'}, and Dragon draws the clip on block, flow-root, flex and grid boxes only`;
  if (el.children.some((c) => c.kind === 'element')) return 'the box has child elements, whose own paint and text Chrome draws under and through the clipped colour';
  if ((el.props.get('color') as ResolvedValue).origin === 'inherited') return 'the box inherits its transparent color, which an ancestor\'s animation or state could change under the native glyphs';
  const sides = ['top', 'right', 'bottom', 'left'];
  if (sides.some((s) => !['none', 'hidden'].includes(keywordOf(el, `border-${s}-style`)) && pxOf(el, `border-${s}-width`) !== 0)) return 'the box has a border';
  if (RADIUS_LONGHANDS.some((p) => {
    const c = cornerComponents((el.props.get(p) as ResolvedValue).value);
    return c === null || c[0].value !== 0 || c[1].value !== 0;
  })) return 'the box has a border radius';
  if (keywordOf(el, 'box-shadow') !== 'none') return 'the box has a box shadow';
  if (keywordOf(el, 'text-shadow') !== 'none') return 'the text has a text shadow';
  if (keywordOf(el, 'text-decoration-line') !== 'none') return 'the text is decorated';
  if (keywordOf(el, 'overflow-x') !== 'visible' || keywordOf(el, 'overflow-y') !== 'visible') return 'the box clips its overflow';
  return null;
}
