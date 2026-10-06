// Computed opacity (css-color-4 §14.1): a number, or a percentage computed to its number, clamped to [0, 1]. On the native targets
// only 0 and 1 are drawn: UIKit and Android composite a translucent view with exact /255 rounding, where Chrome's Skia blits use its
// own (a 256-scale product, measured one off in a channel on device), so no native alpha reproduces Chrome's pixels; a fractional
// opacity is refused there until the pre-composited package (PNT1-opacity-b) draws it. The parity lanes compile it on native anyway
// (project.ts, lane-only): such a case proves web rows only, and the device pixel lanes skip what a translucent group paints.
import { opacityOf } from '../../css/properties/effects.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { PaintValues } from './types.ts';

/** The fractional-opacity refusal above, on every element of a case that generates a box (display: none subtrees do not). */
export function checkTranslucent(root: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const walk = (el: ResolvedElement): void => {
    const d = (el.props.get('display') as ResolvedValue).value;
    if (d.kind === 'keyword' && d.value === 'none') return;
    checkOpacity(el, targets, diagnostics, reported);
    for (const c of el.children) if (c.kind === 'element') walk(c);
  };
  walk(root);
}

function checkOpacity(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const v = el.props.get('opacity') as ResolvedValue;
  const n = opacityOf(v.value);
  if (n === null) throw new Error(`${el.element.address}: opacity did not compute to a number`);
  if (n === 0 || n === 1) return;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|opacity|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${el.element.address} has opacity ${n}; ${t} composites a translucent view with its own rounding, one off Chrome's Skia blend in a channel, so Dragon draws opacity 0 and 1 only until package PNT1-opacity-b pre-composites the rest`,
      manual: 'Use opacity 0 or 1, or a translucent colour (rgba) on the box instead.',
      basis: 'computed-value',
    }));
  }
}

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
