// Computed box-shadow (css-backgrounds-3 §7.1, css-values-4 §6, css-color-4 §4.4): every shadow length computes to px (em against
// the element's font size, rem against the root's) and currentcolor to the element's computed color, as Chrome 145 serializes it.
import type { Rgba8 } from '../../css/color.ts';
import type { Shadow, ShadowLength } from '../../css/properties/shadow.ts';
import { SHADOW_LIST, shadowsOf, shadowValue } from '../../css/properties/shadow.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import type { PaintValueContext, PaintValues } from './types.ts';

function computeLength(l: ShadowLength, ctx: PaintValueContext): ShadowLength | null {
  if (l.unit === CANONICAL_LENGTH_UNIT) return l;
  const needs = l.unit === 'em' ? ctx.em : l.unit === 'rem' ? ctx.rem : 0;
  if (needs === null) return null;
  const px = lengthToPx(l.value, l.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  return px === null ? null : { value: px, unit: CANONICAL_LENGTH_UNIT };
}

export const SHADOW_VALUES: PaintValues = {
  name: 'shadow',
  check: null,
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
