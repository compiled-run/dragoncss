// MISC-PAINT part 1: the reading of a computed border image that every target draws (analysis/border-image.ts refuses the rest, the
// border lowering writes it, paint-values/border.ts refuses its native contexts). Kept apart from the check so that the lowering
// imports no analysis entry point (computed.ts).
import type { CssNode } from 'css-tree';
import type { BorderImageLonghand, BorderImageParts } from '../../css/properties/border-image.ts';
import { borderImageParts } from '../../css/properties/border-image.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import type { ResolvedElement, ResolvedValue } from '../resolve.ts';
import type { GradientSpec } from './gradient.ts';
import { gradient, linearSlope, roundedBox } from './gradient.ts';

export type Refusal = { readonly at: BorderImageLonghand; readonly reason: string; readonly manual: string };

const MANUAL = 'Draw the border image as border-image: linear-gradient(<side or angle>, <opaque colours at percentages>) <slices> [/ <widths>] with no outset and stretch, or remove it.';

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

/** Why a border image is drawn by no target, at the longhand to name, or null when every target draws it (or paints nothing for it). */
export function borderImageRefusal(el: ResolvedElement): Refusal | null {
  const read = borderImageParts((p) => (el.props.get(p) as ResolvedValue).value);
  if (!read.ok) return { at: read.property, reason: `Dragon reads no border image value outside its grammar (a CSS-wide keyword or var() that left the value as written)`, manual: MANUAL };
  const parts = read.parts;
  if (parts.source === null) return null;
  const source = parts.source;
  if (source.type === 'Url') return { at: 'border-image-source', reason: 'a url() border image is not drawn yet; part 1 draws a linear-gradient() source', manual: MANUAL };
  const name = String(source['name']).toLowerCase();
  if (name !== 'linear-gradient') return { at: 'border-image-source', reason: `a ${name}() border image is not drawn yet; part 1 draws a linear-gradient() source`, manual: MANUAL };
  const g = gradient(source);
  if (!g.ok) return { at: 'border-image-source', reason: `the gradient: ${g.refusal.reason}`, manual: MANUAL };
  const spec = g.value;
  if (spec.direction === 'side' && spec.sideX !== 'none' && spec.sideY !== 'none') return { at: 'border-image-source', reason: 'a gradient to a corner takes its angle from atan2 and tan of the image size at paint time, libm results the native targets do not have', manual: 'Write the gradient with an angle in degrees, on the 0.01deg grid.' };
  if (spec.direction === 'angle' && linearSlope(spec.angleDeg) === null) return { at: 'border-image-source', reason: `the angle ${spec.angleDeg}deg is off the 0.01deg grid whose tan the capture host measured`, manual: 'Round the angle to 0.01deg.' };
  const current = usedColors(el).color;
  for (const s of spec.stops) {
    const alpha = s.color.kind === 'rgba' ? s.color.value.alpha : current.alpha;
    if (s.color.kind === 'currentcolor') return { at: 'border-image-source', reason: 'a currentcolor stop is not drawn yet: the native raster bakes its colour in once per layout', manual: MANUAL };
    if (alpha !== 255) return { at: 'border-image-source', reason: 'a translucent stop is not drawn yet: Chrome composites the image over the background and the native raster holds the image alone', manual: MANUAL };
    if (s.unit === 'px') return { at: 'border-image-source', reason: 'a stop position in px is not drawn yet: on a short image Chrome draws its stops as one colour, which the port does not model', manual: 'Write the stop positions as percentages.' };
  }
  // Blink's AddStops: the first stop at 0 when unset, the last at 100, and each other at least the one before (the native port
  // models no gradient whose stops all meet at one offset).
  const offsets = spec.stops.map((s, k) => (s.unit === 'auto' ? (k === 0 ? 0 : k === spec.stops.length - 1 ? 100 : null) : s.value));
  const first = offsets[0] ?? 0;
  const last = Math.max(...offsets.map((o) => o ?? first));
  if (!(last > first)) return { at: 'border-image-source', reason: 'a gradient whose stops all sit at one offset is drawn as a solid colour, which the port does not model', manual: 'Spread the stop positions.' };
  for (const w of parts.widths) {
    if (w.unit === 'percent') return { at: 'border-image-width', reason: 'a percentage border image width is not drawn yet', manual: 'Write the widths as numbers, px or auto.' };
    if (w.unit === 'length' && w.lengthUnit !== 'px') return { at: 'border-image-width', reason: `a border image width in ${w.lengthUnit} is not drawn yet`, manual: 'Write the widths as numbers, px or auto.' };
  }
  if (parts.outsets.some((o) => o.value !== 0)) return { at: 'border-image-outset', reason: 'a border image outset is not drawn yet: the native targets draw a box\'s paint inside its border box', manual: 'Remove the outset.' };
  if (parts.repeat.some((r) => r !== 'stretch')) return { at: 'border-image-repeat', reason: `border-image-repeat ${parts.repeat[0] === parts.repeat[1] ? parts.repeat[0] : parts.repeat.join(' ')} is not drawn yet; part 1 stretches every piece`, manual: 'Use border-image-repeat: stretch.' };
  const display = (el.props.get('display') as ResolvedValue).value;
  const d = display.kind === 'keyword' ? display.value : '';
  if (d === 'inline' || d.includes('table') || d === 'contents' || d === 'list-item') return { at: 'border-image-source', reason: `a border image on a box of display ${d || 'other'} is not drawn yet; part 1 draws it on a block-level, flex, grid or inline-block box`, manual: 'Put the border image on a block box.' };
  if (roundedBox(el)) return { at: 'border-image-source', reason: 'a border image on a rounded box is not drawn yet: Chrome clips the background to the rounded box and draws the image square', manual: 'Remove the border radius.' };
  const image = el.props.get('background-image') as ResolvedValue | undefined;
  if (image !== undefined && !(image.value.kind === 'keyword' && image.value.value === 'none')) return { at: 'border-image-source', reason: 'a border image over a background image is not drawn yet', manual: 'Remove the background image from the box, or the border image.' };
  return null;
}
