// OVFL-B (T078 R9): a box with overflow auto or scroll on an axis is a scroll container the user scrolls. Its clip view (clip.ts)
// becomes a native scroll view over the padding box; each axis whose used value is auto or scroll scrolls, a hidden axis is locked.
// The offset range comes from the translated engine on the device (overflow.ts scrollRanges), so nothing here reads a layout.
// OVFL-S0: scrollbar-width: none on a scroll container hides its native scroll indicators (a scroll-indicators-hidden write after the
// scroll-container one); thin and auto keep the platform's. So do ::-webkit-scrollbar rules that hide its scrollbars (NA-NATIVE,
// analysis/webkit-scrollbar.ts).
import type { ResolvedValue } from '../../analysis/resolve.ts';
import { webkitScrollbarHidden } from '../../analysis/webkit-scrollbar-state.ts';
import type { PaintLowering } from './types.ts';

export type ScrollWrite = { readonly kind: 'scroll-container'; readonly x: boolean; readonly y: boolean } | { readonly kind: 'scroll-indicators-hidden' };

const scrolls = (v: string): boolean => v === 'auto' || v === 'scroll';

export const SCROLL_LOWERING: PaintLowering<ScrollWrite> = {
  name: 'scroll',
  vocabulary: {
    uikit: {
      'scroll-container': { key: 'dragonScroll.range', technique: 'native-property', detail: 'a DragonScrollView (UIScrollView) over the padding box hosts the children; contentInset and contentSize give the offset range [minX, maxX, minY, maxY] in whole device px, a locked axis [0, 0]' },
      'scroll-indicators-hidden': { key: 'dragonScroll.indicators', technique: 'native-property', detail: 'showsHorizontalScrollIndicator and showsVerticalScrollIndicator false; read back false when no scrolling axis shows one' },
    },
    'android-views': {
      'scroll-container': { key: 'dragonScroll.range', technique: 'native-property', detail: 'a DragonScrollView (a clip view scrolled with View.scrollTo, OverScroller flings) over the padding box hosts the children; its clamp range [minX, maxX, minY, maxY] in device px, a locked axis [0, 0]' },
      'scroll-indicators-hidden': { key: 'dragonScroll.indicators', technique: 'native-property', detail: 'the DragonScrollView enables no overlay scrollbar at a touch (barsOnTouch false on every axis); read back false from the same predicate' },
    },
  },
  css: { 'scroll-container': ['overflow-x', 'overflow-y'], 'scroll-indicators-hidden': ['scrollbar-width'] },
  lower: ({ box, el }) => {
    const x = scrolls(box.style.overflowX);
    const y = scrolls(box.style.overflowY);
    if (box.kind !== 'box' || !(x || y)) return [];
    const width = el === null ? null : (el.props.get('scrollbar-width') as ResolvedValue).value;
    const hidden = (width !== null && width.kind === 'keyword' && width.value === 'none') || (el !== null && webkitScrollbarHidden(el));
    return hidden ? [{ kind: 'scroll-container', x, y }, { kind: 'scroll-indicators-hidden' }] : [{ kind: 'scroll-container', x, y }];
  },
};
