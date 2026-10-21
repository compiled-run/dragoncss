// MISC-PAINT part 1: the reading of a computed border image that every target draws (analysis/border-image.ts refuses the rest, the
// border lowering writes it, paint-values/border.ts refuses its native contexts). Kept apart from the check so that the lowering
// imports no analysis entry point (computed.ts). A refusal is native when only the native raster lacks it: the web output keeps
// the value as written and Chrome draws it.
import type { CssNode } from 'css-tree';
import type { BorderImageLonghand, BorderImageParts } from '../../css/properties/border-image.ts';
import { borderImageParts } from '../../css/properties/border-image.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import type { GradientSpec } from './gradient.ts';
import { clipItem, gradient, linearSlope, roundedBox, valueItems } from './gradient.ts';
import { stopsResolveApart } from './stop-offsets.ts';

/** native: the refusal is for ios and android only (the web output draws it as written); otherwise every target refuses it. */
export type Refusal = { readonly at: BorderImageLonghand; readonly reason: string; readonly manual: string; readonly native: boolean };

const MANUAL = 'Draw the border image as border-image: linear-gradient(<side or angle>, <opaque colours at percentages>) <slices> [/ <widths>] [<repeat>] with no outset, or remove it.';

/** The element's border image parts when its source is not none; null for none (nothing is drawn) and for a value Dragon does not read. */
export function borderImageOf(el: ResolvedElement): BorderImageParts | null {
  const r = borderImageParts((p) => (el.props.get(p) as ResolvedValue).value);
  return r.ok && r.parts.source !== null ? r.parts : null;
}

/** The gradient of a border image source Dragon draws, or null (borderImageRefusal names why). */
export function borderImageGradient(source: CssNode): GradientSpec | null {
  if (source.type !== 'Function' || String(source['name']).toLowerCase() !== 'linear-gradient') return null;
  const g = gradient(source);
  return g.ok ? g.value : null;
}

/**
 * Why a border image is not drawn, at the longhand to name, or null when every target draws it (or paints nothing for it). A
 * value part 1 draws on no target is refused everywhere; what only the native raster cannot draw exactly is refused natively.
 */
export function borderImageRefusal(el: ResolvedElement): Refusal | null {
  const all = (at: BorderImageLonghand, reason: string, manual: string = MANUAL): Refusal => ({ at, reason, manual, native: false });
  const native = (at: BorderImageLonghand, reason: string, manual: string = MANUAL): Refusal => ({ at, reason, manual, native: true });
  const read = borderImageParts((p) => (el.props.get(p) as ResolvedValue).value);
  if (!read.ok) return all(read.property, 'Dragon reads no border image value outside its grammar (a CSS-wide keyword or var() that left the value as written)');
  const parts = read.parts;
  if (parts.source === null) return null;
  const source = parts.source;
  if (source.type === 'Url') return all('border-image-source', 'a url() border image is not drawn yet; part 1 draws a linear-gradient() source');
  const name = String(source['name']).toLowerCase();
  if (name !== 'linear-gradient') return all('border-image-source', `a ${name}() border image is not drawn yet; part 1 draws a linear-gradient() source`);
  const g = gradient(source);
  if (!g.ok) return all('border-image-source', `the gradient: ${g.refusal.reason}`);
  for (const w of parts.widths) {
    if (w.unit === 'percent') return all('border-image-width', 'a percentage border image width is not drawn yet', 'Write the widths as numbers, px or auto.');
    if (w.unit === 'length' && w.lengthUnit !== 'px') return all('border-image-width', `a border image width in ${w.lengthUnit} is not drawn yet`, 'Write the widths as numbers, px or auto.');
  }
  if (parts.outsets.some((o) => o.value !== 0)) return all('border-image-outset', 'a border image outset is not drawn yet: the native targets draw a box\'s paint inside its border box', 'Remove the outset.');
  // What only the native raster cannot draw exactly.
  const spec = g.value;
  if (spec.direction === 'side' && spec.sideX !== 'none' && spec.sideY !== 'none') return native('border-image-source', 'a gradient to a corner takes its angle from atan2 and tan of the image size at paint time, libm results the native targets do not have', 'Write the gradient with an angle in degrees, on the 0.01deg grid.');
  const slope = spec.direction === 'angle' ? linearSlope(spec.angleDeg) : 0;
  if (slope === null) return native('border-image-source', `the angle ${spec.angleDeg}deg is off the 0.01deg grid whose tan the capture host measured`, 'Round the angle to 0.01deg.');
  const current = usedColors(el).color;
  const stops: { color: { r: number; g: number; b: number; alpha: number }; unit: 'auto' | 'percent' | 'px'; value: number }[] = [];
  for (const s of spec.stops) {
    if (s.color.kind === 'currentcolor') return native('border-image-source', 'a currentcolor stop is not drawn yet: the native raster bakes its colour in once per layout');
    const alpha = s.color.kind === 'rgba' ? s.color.value.alpha : current.alpha;
    if (alpha !== 255) return native('border-image-source', 'a translucent stop is not drawn yet: Chrome composites the image over the background and the native raster holds the image alone');
    if (s.unit === 'px') return native('border-image-source', 'a stop position in px is not drawn yet: on a short image Chrome draws its stops as one colour, which the port does not model', 'Write the stop positions as percentages.');
    stops.push({ color: { r: s.color.value.r, g: s.color.value.g, b: s.color.value.b, alpha: s.color.value.alpha }, unit: s.unit, value: s.value });
  }
  // The stops as the native raster resolves them (AddStops in f32): offsets that meet at one point once resolved would leave the
  // device's plan unmodelled.
  if (!stopsResolveApart(stops)) return native('border-image-source', 'the stops resolve to one offset (or a gradient the port does not draw), which Chrome draws as a solid colour and the port does not model', 'Spread the stop positions.');
  const display = (el.props.get('display') as ResolvedValue).value;
  const d = display.kind === 'keyword' ? display.value : '';
  if (d === 'inline' || d.includes('table') || d === 'contents' || d === 'list-item') return native('border-image-source', `a border image on a box of display ${d || 'other'} is not drawn yet; part 1 draws it on a block-level, flex, grid or inline-block box`, 'Put the border image on a block box.');
  if (roundedBox(el)) return native('border-image-source', 'a border image on a rounded box is not drawn yet: Chrome clips the background to the rounded box and draws the image square', 'Remove the border radius.');
  const bgImage = el.props.get('background-image') as ResolvedValue | undefined;
  if (bgImage !== undefined && !(bgImage.value.kind === 'keyword' && bgImage.value.value === 'none')) return native('border-image-source', 'a border image over a background image is not drawn yet', 'Remove the background image from the box, or the border image.');
  // Chrome draws no border style under a border image, so no border obscures the background (BorderObscuresBackground is false):
  // a colour clipped to the padding or content box leaves the border band open, where the native view's background colour fills
  // the whole border box.
  const clip = el.props.get('background-clip') as ResolvedValue | undefined;
  if (clip !== undefined && usedColors(el)['background-color'].alpha !== 0) {
    const items = valueItems(clip.value);
    const bottom = items.length === 0 ? null : clipItem(items[0] as CssNode[]);
    if (bottom === null || !bottom.ok || bottom.value !== 'border-box') return native('border-image-source', 'a background colour clipped to the padding or content box under a border image is not drawn yet: Chrome leaves the border band open, and the native view fills its background colour to the border box', 'Clip the background to the border box, or remove the background colour.');
  }
  return null;
}
