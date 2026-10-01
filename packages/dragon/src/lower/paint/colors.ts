// css-color-4 §4.4 and §6.3: the used colours of an element, shared by the paint modules.
import type { ResolvedElement } from '../../analysis/resolve.ts';
import type { Rgba8 } from '../../css/color.ts';
import { TRANSPARENT } from '../../css/color.ts';
import type { ColorLonghand } from '../../css/properties.ts';
import { COLOR_LONGHANDS } from '../../css/properties.ts';
import type { CssValue } from '../../css/stylesheet.ts';

export type ElementColors = { readonly [P in ColorLonghand]: Rgba8 };

/** The channels of a resolved colour value: a colour, or transparent (rgba(0, 0, 0, 0)); currentcolor on color resolves as inherit. */
export function colorChannels(v: CssValue, address: string): Rgba8 {
  if (v.kind === 'color') return v.value;
  if (v.kind === 'keyword' && v.value === 'transparent') return TRANSPARENT;
  throw new Error(`${address}: color did not resolve to channels`);
}

// Used colours per element; transparent is rgba(0, 0, 0, 0) and currentcolor is the element's color.
export function usedColors(el: ResolvedElement): ElementColors {
  const color = el.props.get('color');
  if (color === undefined) throw new Error(`${el.element.address}: color did not resolve`);
  const own = colorChannels(color.value, el.element.address);
  const out = {} as { [P in ColorLonghand]: Rgba8 };
  for (const p of COLOR_LONGHANDS) {
    const v = (el.props.get(p) as NonNullable<typeof color>).value;
    if (v.kind === 'color') out[p] = v.value;
    else if (v.kind === 'keyword' && v.value === 'transparent') out[p] = TRANSPARENT;
    else if (v.kind === 'keyword' && v.value === 'currentcolor') out[p] = own;
    else throw new Error(`${el.element.address}: ${p} did not resolve to a colour`);
  }
  return out;
}
