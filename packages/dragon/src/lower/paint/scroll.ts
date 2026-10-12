// OVFL-B (T078 R9): a box with overflow auto or scroll on an axis is a scroll container the user scrolls. Its clip view (clip.ts)
// becomes a native scroll view over the padding box; each axis whose used value is auto or scroll scrolls, a hidden axis is locked.
// The offset range comes from the translated engine on the device (overflow.ts scrollRanges), so nothing here reads a layout.
import type { PaintLowering } from './types.ts';

export type ScrollWrite = { readonly kind: 'scroll-container'; readonly x: boolean; readonly y: boolean };

const scrolls = (v: string): boolean => v === 'auto' || v === 'scroll';

export const SCROLL_LOWERING: PaintLowering<ScrollWrite> = {
  name: 'scroll',
  vocabulary: {
    uikit: { 'scroll-container': { key: 'dragonScroll.range', technique: 'native-property', detail: 'a DragonScrollView (UIScrollView) over the padding box hosts the children; contentInset and contentSize give the offset range [minX, maxX, minY, maxY] in whole device px, a locked axis [0, 0]' } },
    'android-views': { 'scroll-container': { key: 'dragonScroll.range', technique: 'native-property', detail: 'a DragonScrollView (a clip view scrolled with View.scrollTo, OverScroller flings) over the padding box hosts the children; its clamp range [minX, maxX, minY, maxY] in device px, a locked axis [0, 0]' } },
  },
  css: { 'scroll-container': ['overflow-x', 'overflow-y'] },
  lower: ({ box }) => {
    const x = scrolls(box.style.overflowX);
    const y = scrolls(box.style.overflowY);
    return box.kind === 'box' && (x || y) ? [{ kind: 'scroll-container', x, y }] : [];
  },
};
