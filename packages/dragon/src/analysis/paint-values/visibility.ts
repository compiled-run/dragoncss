// Computed visibility (css-display-3 §4): the keyword as specified, inherited, so there is nothing to compute. One refusal, on the
// native targets: an inline box whose used visibility differs from its block container's. Dragon draws every run of a block
// container in one text view, which can hide all its runs or none (notes/T150-visibility-spec.md §1; T150-i lifts it). Dragon takes
// the background of html and body for the canvas's, which Chrome paints whatever their visibility (R4); a body that is not visible
// with a background of its own (html has one too, so body's does not propagate) is refused natively, as that would paint it.
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import { authored, diagnostic } from '../../diagnostics/catalogue.ts';
import type { ResolvedValue } from '../computed.ts';
import type { ResolvedElement } from '../resolve.ts';
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
      if (c.kind !== 'element' || !isInlineBox(c)) continue;
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

export const VISIBILITY_VALUES: PaintValues = {
  name: 'visibility',
  check: (el, targets, diagnostics, reported) => {
    checkInlineVisibility(el, targets, diagnostics, reported);
    checkBodyBackground(el, targets, diagnostics, reported);
  },
  compute: () => {},
};
