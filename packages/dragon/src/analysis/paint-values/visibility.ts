// Computed visibility (css-display-3 §4): the keyword as specified, inherited, so there is nothing to compute. The refusals, on the
// native targets only:
// - an inline box whose used visibility differs from its block container's: Dragon draws every run of a block container in flat
//   text views that follow the container's visibility;
// - a body that is not visible with a background of its own (html has one too, so body's does not propagate): Dragon takes the
//   background of html and body for the canvas's, which Chrome paints whatever their visibility;
// - a box that is not visible and has native views of its own beyond its paint stages, which the paint gate does not reach: an
//   iframe's web view and a scroll container's scroll view. Its box-shadow and outline need no refusal: the lowering gives a box
//   that is not visible no shadow or outline write (lower/paint/shadow.ts, outline.ts), as Chrome paints neither for it.
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
import { isSvgShapeTag } from '../elements/svg.ts';
import { usedColors } from '../../lower/paint/colors.ts';
import type { PaintCheck, PaintValues } from './types.ts';

/** Whether an element's box is an inline box: its computed display (after blockification) is inline. */
function isInlineBox(el: ResolvedElement): boolean {
  const v = (el.props.get('display') as ResolvedValue).value;
  if (v.kind === 'keyword') return v.value === 'inline';
  return v.kind === 'other' && v.type === 'list' && v.text.trim().split(/\s+/).sort().join(' ') === 'flow inline';
}

/** The used visibility of an element: whether it paints its own decorations and text. */
export function elementPaintsOwn(el: { readonly props: ReadonlyMap<string, ResolvedValue> }): boolean {
  const v = el.props.get('visibility' as never);
  if (v === undefined) throw new Error('visibility did not resolve');
  return paintsOwn(visibilityOf(v.value));
}

const checkInlineVisibility: PaintCheck = (el, targets, diagnostics, reported) => {
  if (isInlineBox(el)) return;
  const own = elementPaintsOwn(el);
  const walk = (parent: ResolvedElement): void => {
    for (const c of parent.children) {
      // An SVG shape is the content of its <svg>, never a box (elements/svg.ts), so its visibility is no text run's.
      if (c.kind !== 'element' || isSvgShapeTag(c.element.tag) || !isInlineBox(c)) continue;
      if (elementPaintsOwn(c) !== own) {
        const v = c.props.get('visibility') as ResolvedValue;
        const origin = v.declaration === null ? c.element.node.origin : authored(v.declaration.valueSpan);
        for (const t of targets) {
          if (t === 'web') continue;
          const id = `${t}|visibility-inline|${c.element.address}`;
          if (reported.has(id)) continue;
          reported.add(id);
          diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
            origin,
            target: t,
            message: `the inline box ${c.element.address} has visibility ${visibilityOf(v.value)} and its block container ${el.element.address} does not paint alike; ${t} draws a block container's runs in one text view, which hides all of them or none (T150-i lifts this)`,
            manual: `Give ${c.element.address} the visibility of ${el.element.address}, or make it a block.`,
            basis: 'computed-value',
          }));
        }
      }
      walk(c);
    }
  };
  walk(el);
};

const checkBodyBackground: PaintCheck = (el, targets, diagnostics, reported) => {
  if (el.element.tag !== 'html' || usedColors(el)['background-color'].alpha === 0) return;
  for (const body of el.children) {
    if (body.kind !== 'element' || body.element.tag !== 'body' || elementPaintsOwn(body) || usedColors(body)['background-color'].alpha === 0) continue;
    const v = body.props.get('visibility') as ResolvedValue;
    const origin = v.declaration === null ? body.element.node.origin : authored(v.declaration.valueSpan);
    for (const t of targets) {
      if (t === 'web') continue;
      const id = `${t}|visibility-body-background|${body.element.address}`;
      if (reported.has(id)) continue;
      reported.add(id);
      diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
        origin,
        target: t,
        message: `${body.element.address} has visibility ${visibilityOf(v.value)} and a background of its own (html has one too), which Chrome does not paint; ${t} paints the backgrounds of html and body as the canvas's`,
        manual: 'Remove the background of body or of html, or keep body visible.',
        basis: 'computed-value',
      }));
    }
  }
};

/** Whether a computed value is the keyword k. */
const isKeyword = (v: ResolvedValue | undefined, ...k: readonly string[]): boolean => v !== undefined && v.value.kind === 'keyword' && k.includes(v.value.value);

/**
 * The native views of a box beyond its paint stages, which dragonVisible does not gate: each by what makes it. The shadow companion
 * and the outline view are not here, as a box that is not visible gets no shadow or outline write.
 */
export function ownViews(el: Pick<ResolvedElement, 'element' | 'props'>): string[] {
  const out: string[] = [];
  if (el.element.tag === 'iframe') out.push('the web view of an iframe');
  if (isKeyword(el.props.get('overflow-x'), 'auto', 'scroll') || isKeyword(el.props.get('overflow-y'), 'auto', 'scroll')) out.push('the scroll view of a scroll container');
  return out;
}

const checkOwnViews: PaintCheck = (el, targets, diagnostics, reported) => {
  if (elementPaintsOwn(el)) return;
  const views = ownViews(el);
  if (views.length === 0) return;
  const v = el.props.get('visibility') as ResolvedValue;
  const origin = v.declaration === null ? el.element.node.origin : authored(v.declaration.valueSpan);
  for (const t of targets) {
    if (t === 'web') continue;
    const id = `${t}|visibility-views|${el.element.address}`;
    if (reported.has(id)) continue;
    reported.add(id);
    diagnostics.push(diagnostic('DRAGON_UNSUPPORTED_VALUE', {
      origin,
      target: t,
      message: `${el.element.address} has visibility ${visibilityOf(v.value)} and ${views.join(' and ')}; ${t} hides a box's own paint stages and text views only, so that view would still show (T150a)`,
      manual: `Keep ${el.element.address} visible, or move what it must hide into a child that is not visible.`,
      basis: 'computed-value',
    }));
  }
};

export const VISIBILITY_VALUES: PaintValues = {
  name: 'visibility',
  check: (el, targets, diagnostics, reported, propagated) => {
    checkInlineVisibility(el, targets, diagnostics, reported, propagated);
    checkBodyBackground(el, targets, diagnostics, reported, propagated);
    checkOwnViews(el, targets, diagnostics, reported, propagated);
  },
  compute: () => {},
};
