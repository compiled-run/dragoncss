// -webkit-text-stroke (compat §5.4): <line-width> || <color>, setting -webkit-text-stroke-width and -webkit-text-stroke-color; an
// omitted one takes its initial value (0, currentcolor), as Chrome 145 expands it.
import type { CssValue } from '../values.ts';
import { kw } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit } from './shared.ts';

const WIDTH_KEYWORDS: ReadonlySet<string> = new Set(['thin', 'medium', 'thick']);
const isWidth = (v: CssValue): boolean => v.kind === 'length' || (v.kind === 'number' && v.value === 0) || (v.kind === 'keyword' && WIDTH_KEYWORDS.has(v.value)) || (v.kind === 'other' && v.type.endsWith('()') && v.type !== 'color');

export const TEXT_FILL_STROKE_SHORTHANDS = {
  '-webkit-text-stroke': {
    longhands: ['-webkit-text-stroke-width', '-webkit-text-stroke-color'],
    expand: (values) => {
      const width = values.find(isWidth);
      const color = values.find((v) => v !== width);
      return [
        width === undefined ? implicit('-webkit-text-stroke-width', { kind: 'length', value: 0, unit: 'px' }) : explicit('-webkit-text-stroke-width', width),
        color === undefined ? implicit('-webkit-text-stroke-color', kw('currentcolor')) : explicit('-webkit-text-stroke-color', color),
      ];
    },
  },
} as const satisfies { readonly [s: string]: ShorthandHandler };
