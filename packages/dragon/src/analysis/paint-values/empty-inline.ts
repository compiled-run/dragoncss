// An inline box with no content and no inline-axis margin, border or padding: its one fragment is 0 wide and its line box, if it
// is alone, 0 tall (CSS2 §10.8), so Chrome 145 paints and hits nothing of it, whatever its background, radius or visibility
// (inline-box-empty-paint). @markless/ui's radio group draws its dot as such a span.
import type { Longhand } from '../../css/properties.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';

const valueOf = (el: ResolvedElement, p: Longhand): ResolvedValue['value'] => {
  const v = el.props.get(p);
  if (v === undefined) throw new Error(`${el.element.address}: ${p} did not resolve`);
  return v.value;
};

const zero = (el: ResolvedElement, p: Longhand): boolean => {
  const v = valueOf(el, p);
  return (v.kind === 'length' || v.kind === 'percentage') && v.value === 0;
};

/** A side with border-style none or hidden has a used width of 0 (css-backgrounds-3 §3.3). */
const noBorder = (el: ResolvedElement, side: 'left' | 'right'): boolean => {
  const style = valueOf(el, `border-${side}-style`);
  return (style.kind === 'keyword' && (style.value === 'none' || style.value === 'hidden')) || zero(el, `border-${side}-width`);
};

const INLINE_AXIS: readonly Longhand[] = ['margin-left', 'margin-right', 'padding-left', 'padding-right'];

/** Whether an element is an inline box that paints and hits nothing: no children, and every inline-axis margin, border width and padding 0. */
export function emptyInlineBox(el: ResolvedElement): boolean {
  const display = valueOf(el, 'display');
  return display.kind === 'keyword' && display.value === 'inline' && el.children.length === 0 && INLINE_AXIS.every((p) => zero(el, p)) && noBorder(el, 'left') && noBorder(el, 'right');
}
