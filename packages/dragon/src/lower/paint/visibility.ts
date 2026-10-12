// visibility (notes/T150-visibility-spec.md R3, R5): a box whose used visibility is hidden or collapse paints none of its own
// decorations or text, and keeps its frame, stacking, opacity group and clip; its descendants paint by their own value. Dragon
// gates its own paint (the box view is never hidden, so visible descendants stay), turns the native background off, and hides the
// views with no CSS children: the shadow companion, the outline view and the box's text views. A visible box has no write. An
// anonymous box inherits its element's value; its text views follow the element's write (DragonTree.textNode). The background of
// html and body is the canvas's, which Chrome paints whatever their visibility (R4), so theirs stays on (canvas).
import { paintsOwn, visibilityOf } from '../../css/properties/visibility.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type VisibilityWrite = { readonly kind: 'visibility'; readonly value: 'hidden' | 'collapse'; readonly canvas: boolean };

/** The facts of a box that does not paint its own decorations (hit testing and focus read them, T150b). */
export type VisibilityFacts = { readonly visible: false; readonly value: 'hidden' | 'collapse' };

export const VISIBILITY_LOWERING: PaintLowering<VisibilityWrite> = {
  name: 'visibility',
  vocabulary: {
    uikit: { visibility: { key: 'visibility', technique: 'dragon-owned-paint', detail: "DragonBoxView.dragonVisible gates every Dragon paint stage and backgroundColor is nil; the shadow companion, outline view and the box's text views take isHidden. The box view is never hidden, so visible descendants paint" } },
    'android-views': { visibility: { key: 'visibility', technique: 'dragon-owned-paint', detail: "DragonBoxView.dragonVisible gates every Dragon paint stage and background is null; the shadow companion, outline view and the box's text views are View.INVISIBLE. The box view is never hidden, so visible descendants paint" } },
  },
  css: { visibility: ['visibility'] },
  lower: ({ el, facts }) => {
    if (el === null) return [];
    const v = el.props.get('visibility');
    if (v === undefined) throw new ProgramError(`${el.element.address}: visibility did not resolve`);
    const k = visibilityOf(v.value);
    if (paintsOwn(k)) return [];
    const value = k as 'hidden' | 'collapse';
    const visibility: VisibilityFacts = { visible: false, value };
    facts['visibility'] = visibility;
    return [{ kind: 'visibility', value, canvas: el.element.tag === 'html' || el.element.tag === 'body' }];
  },
};
