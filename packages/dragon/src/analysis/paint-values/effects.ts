// Computed opacity (css-color-4 §14.1): a number, or a percentage computed to its number, clamped to [0, 1].
import { opacityOf } from '../../css/properties/effects.ts';
import type { PaintValues } from './types.ts';

export const EFFECTS_VALUES: PaintValues = {
  name: 'effects',
  compute: (props) => {
    const v = props.get('opacity');
    if (v === undefined || (v.value.kind !== 'number' && v.value.kind !== 'percentage')) return;
    const n = opacityOf(v.value);
    if (n === null) return;
    props.set('opacity', { ...v, value: { kind: 'number', value: n } });
  },
};
