// Computed outlines (css-ui-4 §3): outline-width computes to px (thin 1, medium 3, thick 5), and to 0 when outline-style is none, as
// Chrome 145 serializes it; the webref initial auto of outline-color is Chrome's currentcolor. Lengths are already px here.
import { OUTLINE_WIDTH_KEYWORDS } from '../../css/properties/outline.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { Diagnostic } from '../../types.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import type { PaintValues } from './types.ts';

/**
 * The native targets draw solid and double outlines (lower/paint/outline.ts). An outline in another style is refused there: dotted
 * and dashed take P6a's fitted side painter, groove, ridge, inset and outset its 3D colours, and auto is Chrome's focus ring. A solid
 * or double outline with a negative offset on an overflow: hidden box is refused too: when the box paints its own outline, the view
 * sits above the clip and would cover the box's positioned children, which Blink paints above it. outline: none and a zero width paint
 * nothing, so they compile. The web target paints every outline itself.
 */
/** The refusal above on one element (computed-checks.ts runs it on every laid-out element). */
export function checkOutline(el: ResolvedElement, targets: readonly string[], diagnostics: Diagnostic[], reported: Set<string>): void {
  const style = el.props.get('outline-style') as ResolvedValue;
  const width = (el.props.get('outline-width') as ResolvedValue).value;
  if (style.value.kind !== 'keyword' || style.value.value === 'none') return;
  // auto is the focus ring, whose width is Chrome's own, so it paints at any outline-width.
  if (style.value.value !== 'auto' && width.kind === 'length' && width.value === 0) return;
  const drawn = style.value.value === 'solid' || style.value.value === 'double';
  const offset = (el.props.get('outline-offset') as ResolvedValue).value;
  const clips = keywordOf(el, 'overflow-x') === 'hidden';
  if (drawn && !(clips && offset.kind === 'length' && offset.value < 0)) return;
  const origin = style.declaration === null ? el.element.node.origin : authored(style.declaration.valueSpan);
  const why = drawn ? `has a ${style.value.value} outline with a negative offset and clips its overflow, so its native outline view could cover positioned children Blink paints above it` : `has a ${style.value.value} outline, which needs P6a's border side painter`;
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|outline|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: style.value.value === 'auto'
        ? `${el.element.address} has outline-style auto, Chrome's focus ring; ${t} does not draw it: whether the platform's own focus indication stands in for it (not applicable on native) is pending the owner's NA-NATIVE-2 review`
        : `${el.element.address} ${why}; ${t} draws solid and double outlines only (PNT1)`,
      manual: style.value.value === 'auto' ? 'Set outline: none or a solid outline on the focused element (for :focus-visible, outline: none overrides the focus ring).' : 'Use a solid or double outline, or outline: none.',
      basis: 'computed-value',
    }));
  }
}

const keywordOf = (el: { readonly props: ReadonlyMap<string, ResolvedValue> }, p: string): string => {
  const v = el.props.get(p as never)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

export const OUTLINE_VALUES: PaintValues = {
  name: 'outline',
  compute: (props) => {
    const color = props.get('outline-color');
    if (color !== undefined && color.value.kind === 'keyword' && color.value.value === 'auto') props.set('outline-color', { ...color, value: { kind: 'keyword', value: 'currentcolor' } });
    const style = props.get('outline-style');
    const width = props.get('outline-width');
    if (style === undefined || width === undefined) return;
    const none = style.value.kind === 'keyword' && style.value.value === 'none';
    const keyword = width.value.kind === 'keyword' ? OUTLINE_WIDTH_KEYWORDS[width.value.value] : undefined;
    if (none) props.set('outline-width', { ...width, value: { kind: 'length', value: 0, unit: 'px' } });
    else if (keyword !== undefined) props.set('outline-width', { ...width, value: { kind: 'length', value: keyword, unit: 'px' } });
  },
};
