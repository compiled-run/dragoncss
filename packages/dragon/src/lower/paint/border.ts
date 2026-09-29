// The four border sides: Dragon-owned paint. Widths come from the engine at the device scale; styles and colours are lowered here.
import type { Rgba8 } from '../../css/color.ts';
import type { ColorLonghand, Longhand } from '../../css/properties.ts';
import { SIDES } from '../../css/properties.ts';
import type { ResolvedValue } from '../../analysis/resolve.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type BorderStyleName = 'none' | 'hidden' | 'solid' | 'dotted' | 'dashed' | 'double';
export type Sides<T> = readonly [T, T, T, T];

export type BorderWrite =
  /** Border widths as the engine resolves them at the device scale (box.ts resolveBorder of the zoomed style). */
  | { readonly kind: 'border-widths' }
  | { readonly kind: 'border-styles'; readonly styles: Sides<BorderStyleName> }
  | { readonly kind: 'border-colors'; readonly colors: Sides<Rgba8> };

const BORDER_PAINT = 'Dragon draws each side as a band of its width: solid fills it; dashed draws dashes of 3 times the width with equal gaps; dotted draws square dots of the width with equal gaps; double draws two bands of a third of the width';

const BORDER_STYLES: readonly BorderStyleName[] = ['none', 'hidden', 'solid', 'dotted', 'dashed', 'double'];

export const BORDER_LOWERING: PaintLowering<BorderWrite> = {
  name: 'border',
  vocabulary: {
    uikit: {
      'border-widths': { key: 'dragonBorder.widths', technique: 'dragon-owned-paint', detail: `DragonBoxView side widths in points (device px / scale). ${BORDER_PAINT}` },
      'border-styles': { key: 'dragonBorder.styles', technique: 'dragon-owned-paint', detail: `DragonBoxView side styles. ${BORDER_PAINT}` },
      'border-colors': { key: 'dragonBorder.colors', technique: 'dragon-owned-paint', detail: `DragonBoxView side colours (sRGB RGBA8). ${BORDER_PAINT}` },
    },
    'android-views': {
      'border-widths': { key: 'dragonBorder.widthsPx', technique: 'dragon-owned-paint', detail: `DragonBoxView side widths in whole device px. ${BORDER_PAINT}` },
      'border-styles': { key: 'dragonBorder.styles', technique: 'dragon-owned-paint', detail: `DragonBoxView side styles. ${BORDER_PAINT}` },
      'border-colors': { key: 'dragonBorder.colors', technique: 'dragon-owned-paint', detail: `DragonBoxView side colours (sRGB RGBA8). ${BORDER_PAINT}` },
    },
  },
  css: {
    'border-widths': SIDES.map((s) => `border-${s}-width` as Longhand),
    'border-styles': SIDES.map((s) => `border-${s}-style` as Longhand),
    'border-colors': SIDES.map((s) => `border-${s}-color` as Longhand),
  },
  // An anonymous box has no border and currentcolor borders of its enclosing element's color (CSS2 §9.2.1.1).
  lower: ({ box, el, parentColor }) => {
    const colors = el === null ? null : usedColors(el);
    const style = (side: string): BorderStyleName => {
      if (el === null) return 'none';
      const v = (el.props.get(`border-${side}-style` as Longhand) as ResolvedValue).value;
      const k = v.kind === 'keyword' ? v.value : '';
      if (!(BORDER_STYLES as readonly string[]).includes(k)) throw new ProgramError(`${box.id}: border-${side}-style ${k} has no native paint technique`);
      return k as BorderStyleName;
    };
    const sideColor = (side: string): Rgba8 => (colors === null ? parentColor : colors[`border-${side}-color` as ColorLonghand]);
    return [
      { kind: 'border-widths' },
      { kind: 'border-styles', styles: SIDES.map(style) as unknown as Sides<BorderStyleName> },
      { kind: 'border-colors', colors: SIDES.map(sideColor) as unknown as Sides<Rgba8> },
    ];
  },
};
