// The clip module's computed values and refusals. clip (css-masking-1 §5.1): each rect() edge computes to px (em against the
// element's font size, rem against the root's), auto edges stay auto. Chrome clips only an absolutely or fixed positioned box, to
// the rect CSS2 §11.1.2 gives against its border box, and that clip node covers the box's own paint and every descendant
// (paint_property_tree_builder.cc UpdateCssClip). Natively Dragon draws one clip: a rect that is empty whatever the box's size
// hides the box view, and with it every view inside it (lower/paint/clip.ts). Refused on the native targets: any other rect on
// such a box, and an empty one whose subtree paints a view outside the box view: an outline (in the root view), the box's own
// box-shadow (a companion beside it) and a layer item with a z-index other than 0 (which may be hosted under a stacking context
// outside it); a box that is not visible as well, whose visibility readback reads the same hidden flag.
import type { Longhand } from '../../css/properties.ts';
import type { ClipEdges } from '../../css/properties/clip-rect.ts';
import { appliedClipEdges, clipEdgesOf, clipHidesBox, clipRectValue } from '../../css/properties/clip-rect.ts';
import { zIndexOf } from '../../css/properties/effects.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { CANONICAL_LENGTH_UNIT, lengthToPx } from '../../css/units.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import { valueToString } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { paintedOutlineStyle } from './outline.ts';
import type { PaintCheck, PaintValueContext, PaintValues } from './types.ts';

const keywordOf = (el: Pick<ResolvedElement, 'props'>, p: Longhand): string => {
  const v = el.props.get(p)?.value;
  return v !== undefined && v.kind === 'keyword' ? v.value : '';
};

function computeEdges(edges: ClipEdges, ctx: PaintValueContext): ClipEdges | null {
  const out = edges.map((e) => {
    if (e === null || e.unit === CANONICAL_LENGTH_UNIT) return e;
    if ((e.unit === 'em' && ctx.em === null) || (e.unit === 'rem' && ctx.rem === null)) return undefined;
    const px = lengthToPx(e.value, e.unit, { em: ctx.em ?? 0, rem: ctx.rem ?? 0 });
    return px === null ? undefined : { value: px, unit: CANONICAL_LENGTH_UNIT };
  });
  return out.some((e) => e === undefined) ? null : (out as unknown as ClipEdges);
}

/** Why the subtree of a box its clip hides paints a view outside the box view, or null: the first such element in preorder. */
export function viewOutsideClip(el: ResolvedElement): string | null {
  if (!paintsOwn(visibilityOf((el.props.get('visibility') as ResolvedValue).value))) return `it is ${valueToString((el.props.get('visibility') as ResolvedValue).value)} too, and the visibility readback reads the same hidden flag`;
  const shadow = el.props.get('box-shadow')?.value;
  if (shadow !== undefined && !(shadow.kind === 'keyword' && shadow.value === 'none')) return 'it has a box-shadow, drawn by a companion view beside the box view';
  const visit = (e: ResolvedElement, root: boolean, flexOrGrid: boolean): string | null => {
    if (keywordOf(e, 'display') === 'none') return null;
    if (paintedOutlineStyle(e) !== null) return `${root ? 'it has' : `${e.element.address} has`} an outline, drawn in the root view`;
    if (!root) {
      const z = zIndexOf((e.props.get('z-index') as ResolvedValue).value);
      if (z !== null && z !== 0 && (keywordOf(e, 'position') !== 'static' || flexOrGrid)) return `${e.element.address} has z-index ${z}, and its layer may be hosted under a stacking context outside the box view`;
    }
    const display = keywordOf(e, 'display');
    const container = display === 'flex' || display === 'inline-flex' || display === 'grid' || display === 'inline-grid';
    for (const c of e.children) {
      if (c.kind !== 'element') continue;
      const found = visit(c, false, container);
      if (found !== null) return found;
    }
    return null;
  };
  return visit(el, true, false);
}

const checkClip: PaintCheck = (el, targets, diagnostics, reported) => {
  const edges = appliedClipEdges(el);
  if (edges === null) return;
  const v = el.props.get('clip') as ResolvedValue;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  const hides = clipHidesBox(el);
  const why = hides === true ? viewOutsideClip(el) : null;
  if (hides === true && why === null) return;
  const at = `${el.element.address}`;
  const rect = valueToString(v.value);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|clip|${at}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: hides === true
        ? `${at} has clip: ${rect}, which hides it whole, but ${why}; ${t} hides the box view and the views inside it only`
        : `${at} has clip: ${rect}, which clips it to a rect that is not empty at every size; ${t} draws only a clip that hides the whole box (an empty rect, such as rect(0, 0, 0, 0))`,
      manual: hides === true ? `Move what ${at} must not hide out of it, or remove it from ${at}.` : 'Use an overflow clip on a wrapper sized to the rect, or an empty rect to hide the box.',
      basis: 'computed-value',
    }));
  }
};

export const CLIP_VALUES: PaintValues = {
  name: 'clip',
  compute: (props, ctx) => {
    const v = props.get('clip');
    if (v === undefined) return;
    const edges = clipEdgesOf(v.value);
    if (edges === null) return;
    const computed = computeEdges(edges, ctx);
    if (computed !== null) props.set('clip', { ...v, value: clipRectValue(computed) });
  },
  check: checkClip,
};
