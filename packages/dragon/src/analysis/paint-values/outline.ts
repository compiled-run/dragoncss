// Computed outlines (css-ui-4 §3): outline-width computes to px (thin 1, medium 3, thick 5), and to 0 when outline-style is none, as
// Chrome 145 serializes it; the webref initial auto of outline-color is Chrome's currentcolor. Lengths are already px here.
import { OUTLINE_WIDTH_KEYWORDS } from '../../css/properties/outline.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import type { PaintCheck, PaintValues } from './types.ts';

/**
 * An outline that paints (auto, or a style other than none with a width above 0) is refused on the native targets until the outline painter
 * lands (T115 part B); outline: none and a zero width paint nothing, so they compile. The web target paints outlines itself.
 */
const checkOutline: PaintCheck = (el, targets, diagnostics, reported) => {
  const style = el.props.get('outline-style') as ResolvedValue;
  const width = (el.props.get('outline-width') as ResolvedValue).value;
  if (style.value.kind !== 'keyword' || style.value.value === 'none') return;
  // auto is the focus ring, whose width is Chrome's own, so it paints at any outline-width.
  if (style.value.value !== 'auto' && width.kind === 'length' && width.value === 0) return;
  const origin = style.declaration === null ? el.element.node.origin : authored(style.declaration.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|outline|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${el.element.address} has an outline (outline-style ${style.value.value}); ${t} does not draw outlines yet (PNT1's outline painter, T115 part B)`,
      manual: 'Use outline: none, or a border or box-shadow ring, until the native outline lands.',
      basis: 'computed-value',
    }));
  }
};

export const OUTLINE_VALUES: PaintValues = {
  name: 'outline',
  check: checkOutline,
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
