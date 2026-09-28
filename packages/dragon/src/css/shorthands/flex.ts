// css-flexbox-1 §7.1 (flex), §5.3 (flex-flow); css-align-3 §8.3 (gap).
import type { CssValue } from '../values.ts';
import { kw } from '../values.ts';
import type { ShorthandHandler } from './shared.ts';
import { explicit, implicit, twoAxes } from './shared.ts';

const flex: ShorthandHandler = {
  longhands: ['flex-grow', 'flex-shrink', 'flex-basis'],
  expand: (values) => {
    const only = values[0] as CssValue;
    if (values.length === 1 && only.kind === 'keyword' && only.value === 'none') {
      return [explicit('flex-grow', { kind: 'number', value: 0 }), explicit('flex-shrink', { kind: 'number', value: 0 }), explicit('flex-basis', kw('auto'))];
    }
    if (values.length === 1 && only.kind === 'keyword' && only.value === 'auto') {
      return [explicit('flex-grow', { kind: 'number', value: 1 }), explicit('flex-shrink', { kind: 'number', value: 1 }), explicit('flex-basis', kw('auto'))];
    }
    const numbers = values.filter((v) => v.kind === 'number');
    // A third unitless number can only be a zero flex-basis (css-flexbox-1 §7.2).
    const basis = numbers.length === 3 ? ({ kind: 'length', value: 0, unit: 'px' } as const) : values.find((v) => v.kind !== 'number');
    return [
      explicit('flex-grow', numbers[0] === undefined ? { kind: 'number', value: 1 } : numbers[0]),
      explicit('flex-shrink', numbers[1] === undefined ? { kind: 'number', value: 1 } : numbers[1]),
      explicit('flex-basis', basis === undefined ? { kind: 'percentage', value: 0 } : basis),
    ];
  },
};

const flexFlow: ShorthandHandler = {
  longhands: ['flex-direction', 'flex-wrap'],
  expand: (values) => {
    const direction = values.find((v) => v.kind === 'keyword' && v.value.includes('row') || v.kind === 'keyword' && v.value.includes('column'));
    const wrap = values.find((v) => v.kind === 'keyword' && v.value.includes('wrap'));
    return [
      direction === undefined ? implicit('flex-direction', kw('row')) : explicit('flex-direction', direction),
      wrap === undefined ? implicit('flex-wrap', kw('nowrap')) : explicit('flex-wrap', wrap),
    ];
  },
};

export const FLEX_SHORTHANDS = {
  flex,
  'flex-flow': flexFlow,
  gap: twoAxes(['row-gap', 'column-gap']),
} as const satisfies { readonly [s: string]: ShorthandHandler };
