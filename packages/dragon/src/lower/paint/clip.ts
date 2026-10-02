// css-overflow-3 §3: overflow hidden clips descendants to the padding box, through a Dragon clip view inset by the border widths.
import type { PaintLowering } from './types.ts';

export type ClipWrite = { readonly kind: 'padding-box-clip' };

export const CLIP_LOWERING: PaintLowering<ClipWrite> = {
  name: 'clip',
  vocabulary: {
    uikit: { 'padding-box-clip': { key: 'dragonClip.frame', technique: 'native-property', detail: 'a DragonClipView over the padding box with clipsToBounds = true hosts the children; frame in points relative to the node' } },
    'android-views': { 'padding-box-clip': { key: 'dragonClip.clipBounds', technique: 'native-property', detail: 'a DragonClipView over the padding box with View.clipBounds = its own bounds hosts the children; [left, top, right, bottom] in device px relative to the node' } },
  },
  css: { 'padding-box-clip': ['overflow-x', 'overflow-y'] },
  lower: ({ box }) => (box.style.overflowX === 'hidden' ? [{ kind: 'padding-box-clip' }] : []),
};

/** Whether a box's children are hosted in a clip view over its padding box. */
export const clipsChildren = (box: { readonly style: { readonly overflowX: string } }): boolean => box.style.overflowX === 'hidden';
