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
