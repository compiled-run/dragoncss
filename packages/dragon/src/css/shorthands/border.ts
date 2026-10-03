// css-backgrounds-3 §3: border-width, border-style and border-color over the four sides; border and border-<side> set width,
// style and colour, filling each omitted one with its initial value.
import type { Longhand } from '../properties.ts';
import { SIDES } from '../properties.ts';
import type { LonghandValue } from '../stylesheet.ts';
import type { CssValue } from '../values.ts';
import { isMathValue, kw, LINE_STYLES, LINE_WIDTH_KEYWORDS } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, fourSides, implicit } from './shared.ts';

/** width, style and colour of each side, in SIDES order. */
function borderLonghands(sides: readonly (typeof SIDES)[number][]): Longhand[] {
  const out: Longhand[] = [];
  for (const side of sides) out.push(`border-${side}-width` as Longhand, `border-${side}-style` as Longhand, `border-${side}-color` as Longhand);
  return out;
}

function border(sides: readonly (typeof SIDES)[number][]): ShorthandHandler {
  const names = borderLonghands(sides);
  return {
    longhands: names,
    expand: (values) => {
      let width: CssValue | null = null;
      let style: CssValue | null = null;
      let color: CssValue | null = null;
      for (const v of values) {
        if (v.kind === 'length' || isMathValue(v) || (v.kind === 'keyword' && LINE_WIDTH_KEYWORDS.has(v.value))) width = v;
        else if (v.kind === 'keyword' && LINE_STYLES.has(v.value)) style = v;
        else color = v;
      }
      const out: LonghandValue[] = [];
      for (let i = 0; i < names.length; i += 3) {
        out.push(width === null ? implicit(names[i] as Longhand, kw('medium')) : explicit(names[i] as Longhand, width));
        out.push(style === null ? implicit(names[i + 1] as Longhand, kw('none')) : explicit(names[i + 1] as Longhand, style));
        out.push(color === null ? implicit(names[i + 2] as Longhand, kw('currentcolor')) : explicit(names[i + 2] as Longhand, color));
      }
      return out;
    },
  };
}

export const BORDER_SHORTHANDS = {
  border: border(SIDES),
  'border-top': border(['top']),
  'border-right': border(['right']),
  'border-bottom': border(['bottom']),
  'border-left': border(['left']),
  'border-width': fourSides(['border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width']),
  'border-style': fourSides(['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style']),
  'border-color': fourSides(['border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']),
} as const satisfies { readonly [s: string]: ShorthandHandler };
