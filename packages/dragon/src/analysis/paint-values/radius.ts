// Computed border radii (css-backgrounds-3 §5.1, css-values-4 §6): each component of a two-component corner computes to px (em
// against the element's font size, rem against the root's) or stays a percentage, and a corner whose two computed components are
// equal is one value, as Chrome 145 serializes it. One-component corners are lengths computeLengths has already made px.
import type { Longhand } from '../../css/properties.ts';
import type { RadiusComponent } from '../../css/properties/radius.ts';
import { cornerComponents, cornerValue, RADIUS_LONGHANDS, RADIUS_PAIR } from '../../css/properties/radius.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import type { ResolvedValue } from '../computed.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

function computeComponent(c: RadiusComponent, ctx: PaintValueContext): RadiusComponent | null {
  if (c.kind === 'percentage' || c.unit === CANONICAL_LENGTH_UNIT) return c;
  const needs = c.unit === 'em' ? ctx.em : c.unit === 'rem' ? ctx.rem : 0;
  if (needs === null) return null;
  const px = lengthToPx(c.value, c.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
  return px === null ? null : { kind: 'length', value: px, unit: CANONICAL_LENGTH_UNIT };
}

const BORDER_STYLE_LONGHANDS: readonly Longhand[] = ['border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style'];
const UNROUNDED_STYLES: ReadonlySet<string> = new Set(['dotted', 'dashed', 'double', 'groove', 'ridge', 'inset', 'outset']);

/**
 * A rounded box whose border has a dashed, dotted, double or 3D side is refused on the native targets: Blink strokes those along
 * the rounded centre line (box_border_painter.cc), which PNT1 does not draw; PNT1b adds them. The web target draws them itself.
 */
const checkRoundedBorderStyles: PaintCheck = (el, targets, diagnostics, reported) => {
  const lengths = RADIUS_LONGHANDS.map((p) => cornerComponents((el.props.get(p) as ResolvedValue).value));
  const rounded = lengths.some((c) => c !== null && c[0].value > 0 && c[1].value > 0);
  if (!rounded) return;
  const styled = BORDER_STYLE_LONGHANDS.map((p) => el.props.get(p) as ResolvedValue).find((v, i) => {
    const width = (el.props.get((BORDER_STYLE_LONGHANDS[i] as string).replace('-style', '-width') as Longhand) as ResolvedValue | undefined)?.value;
    return v.value.kind === 'keyword' && UNROUNDED_STYLES.has(v.value.value) && !(width !== undefined && width.kind === 'length' && width.value === 0);
  });
  if (styled === undefined || styled.value.kind !== 'keyword') return;
  const source = RADIUS_LONGHANDS.map((p) => el.props.get(p) as ResolvedValue).find((v) => v.declaration !== null);
  if (source === undefined || source.declaration === null) return;
  const span = source.declaration.valueSpan;
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|rounded-border-style|${span.source.uri}|${span.start}|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin: authored(span),
      target: t,
      message: `${el.element.address} rounds its corners and has a ${styled.value.value} border side; rounded ${styled.value.value} borders are PNT1b, which ${t} does not draw yet`,
      manual: 'Use solid borders on a rounded box, or square corners with this border style.',
      basis: 'computed-value',
    }));
  }
};

export const RADIUS_VALUES: PaintValues = {
  name: 'radius',
  check: checkRoundedBorderStyles,
  compute: (props, ctx) => {
    for (const p of RADIUS_LONGHANDS as readonly Longhand[]) {
      const v = props.get(p);
      if (v === undefined || v.value.kind !== 'other' || v.value.type !== RADIUS_PAIR) continue;
      const parts = cornerComponents(v.value);
      if (parts === null) continue;
      const h = computeComponent(parts[0], ctx);
      const w = computeComponent(parts[1], ctx);
      if (h === null || w === null) continue;
      const computed: ResolvedValue = { ...v, value: cornerValue(h, w) };
      props.set(p, computed);
    }
  },
};
