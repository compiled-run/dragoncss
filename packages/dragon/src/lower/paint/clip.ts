// css-overflow-3 §3: a box whose axes are both not visible (hidden, auto, scroll or clip; at scroll offset 0 a scroll container draws
// like hidden) clips descendants to the padding box, through a Dragon clip view inset by the border widths.
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ClipWrite = { readonly kind: 'padding-box-clip' };

export const CLIP_LOWERING: PaintLowering<ClipWrite> = {
  name: 'clip',
  vocabulary: {
    uikit: { 'padding-box-clip': { key: 'dragonClip.frame', technique: 'native-property', detail: 'a DragonClipView over the padding box with clipsToBounds = true hosts the children; frame in points relative to the node' } },
    'android-views': { 'padding-box-clip': { key: 'dragonClip.clipBounds', technique: 'native-property', detail: 'a DragonClipView over the padding box with View.clipBounds = its own bounds hosts the children; [left, top, right, bottom] in device px relative to the node' } },
  },
  css: { 'padding-box-clip': ['overflow-x', 'overflow-y'] },
  lower: ({ box }) => (clipsChildren(box) ? [{ kind: 'padding-box-clip' }] : []),
};

/** Whether a box's children are hosted in a clip view over its padding box; one clipped axis alone has no native technique (OVFL-c). */
export function clipsChildren(box: { readonly id: string; readonly style: { readonly overflowX: string; readonly overflowY: string } }): boolean {
  const x = box.style.overflowX !== 'visible';
  if (x !== (box.style.overflowY !== 'visible')) throw new ProgramError(`${box.id}: overflow clips one axis only, which has no native technique (OVFL-c)`);
  return x;
}
