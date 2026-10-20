// visibility (notes/T150-visibility-spec.md R3, R5): a box whose used visibility is hidden or collapse paints none of its own
// decorations or text, and keeps its frame, stacking, opacity group and clip; its descendants paint by their own value. Dragon
// gates its own paint (the box view is never hidden, so visible descendants stay), turns the native background off, and hides the
// box's text views. Its box-shadow and outline get no write at all (lower/paint/shadow.ts, outline.ts). A visible box has no write. An
// anonymous box inherits its element's value; its text views follow the element's write (DragonTree.textNode). The background of
// html and body is the canvas's, which Chrome paints whatever their visibility (R4), so theirs stays on (canvas).
import type { ResolvedElement } from '../../analysis/resolve.ts';
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type VisibilityWrite = { readonly kind: 'visibility'; readonly value: 'hidden' | 'collapse'; readonly canvas: boolean };

/** The facts of a box that does not paint its own decorations (hit testing and focus read them, T150b). */
export type VisibilityFacts = { readonly visible: false; readonly value: 'hidden' | 'collapse' };

/** The visibility write of a box an element paints, none when it is visible; canvas is the html and body background rule. */
export function visibilityWrites(el: ResolvedElement, canvas = false): VisibilityWrite[] {
  const v = el.props.get('visibility');
  if (v === undefined) throw new ProgramError(`${el.element.address}: visibility did not resolve`);
  const k = visibilityOf(v.value);
  if (paintsOwn(k)) return [];
  return [{ kind: 'visibility', value: k as 'hidden' | 'collapse', canvas }];
}

export const VISIBILITY_LOWERING: PaintLowering<VisibilityWrite> = {
  name: 'visibility',
  vocabulary: {
    uikit: { visibility: { key: 'visibility', technique: 'dragon-owned-paint', detail: "DragonBoxView.dragonVisible gates every Dragon paint stage and backgroundColor is nil; the box's text views take isHidden, and the box gets no box-shadow or outline write. The box view is never hidden, so visible descendants paint" } },
    'android-views': { visibility: { key: 'visibility', technique: 'dragon-owned-paint', detail: "DragonBoxView.dragonVisible gates every Dragon paint stage and background is null; the box's text views are View.INVISIBLE, and the box gets no box-shadow or outline write. The box view is never hidden, so visible descendants paint" } },
  },
  css: { visibility: ['visibility'] },
  lower: ({ el, facts }) => {
    if (el === null) return [];
    const writes = visibilityWrites(el, el.element.tag === 'html' || el.element.tag === 'body');
    for (const w of writes) facts['visibility'] = { visible: false, value: w.value } satisfies VisibilityFacts;
    return writes;
  },
};
