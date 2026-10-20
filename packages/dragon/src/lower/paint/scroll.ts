// OVFL-B (T078 R9): a box with overflow auto or scroll on an axis is a scroll container the user scrolls. Its clip view (clip.ts)
// becomes a native scroll view over the padding box; each axis whose used value is auto or scroll scrolls, a hidden axis is locked.
// The offset range comes from the translated engine on the device (overflow.ts scrollRanges), so nothing here reads a layout.
// OVFL-S0: scrollbar-width: none on a scroll container hides its native scroll indicators (a scroll-indicators-hidden write after the
// scroll-container one); thin and auto keep the platform's.
// css-overscroll-1: a native scroll view never hands a drag to an outer one, as contain asks; overscroll-behavior: none on a scrolling
// axis also stops that axis's bounce (a scroll-bounce write, bounceX and bounceY false where none), which only iOS draws.
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { Longhand } from '../../css/properties.ts';
import type { PaintLowering } from './types.ts';

export type ScrollWrite =
  | { readonly kind: 'scroll-container'; readonly x: boolean; readonly y: boolean }
  | { readonly kind: 'scroll-indicators-hidden' }
  | { readonly kind: 'scroll-bounce'; readonly bounceX: boolean; readonly bounceY: boolean };

const scrolls = (v: string): boolean => v === 'auto' || v === 'scroll';

export const SCROLL_LOWERING: PaintLowering<ScrollWrite> = {
  name: 'scroll',
  vocabulary: {
    uikit: {
      'scroll-container': { key: 'dragonScroll.range', technique: 'native-property', detail: 'a DragonScrollView (UIScrollView) over the padding box hosts the children; contentInset and contentSize give the offset range [minX, maxX, minY, maxY] in whole device px, a locked axis [0, 0]' },
      'scroll-indicators-hidden': { key: 'dragonScroll.indicators', technique: 'native-property', detail: 'showsHorizontalScrollIndicator and showsVerticalScrollIndicator false; read back false when no scrolling axis shows one' },
      'scroll-bounce': { key: 'dragonScroll.bounce', technique: 'native-property', detail: 'bouncesHorizontally and bouncesVertically (iOS 17.4; before it bounces, off when either axis asks); read back [x, y]' },
    },
    'android-views': {
      'scroll-container': { key: 'dragonScroll.range', technique: 'native-property', detail: 'a DragonScrollView (a clip view scrolled with View.scrollTo, OverScroller flings) over the padding box hosts the children; its clamp range [minX, maxX, minY, maxY] in device px, a locked axis [0, 0]' },
      'scroll-indicators-hidden': { key: 'dragonScroll.indicators', technique: 'native-property', detail: 'the DragonScrollView enables no overlay scrollbar at a touch (barsOnTouch false on every axis); read back false from the same predicate' },
      'scroll-bounce': { key: 'dragonScroll.bounce', technique: 'native-property', detail: 'the DragonScrollView draws no overscroll effect on any axis, so the flags are kept and read back [x, y] only' },
    },
  },
  css: { 'scroll-container': ['overflow-x', 'overflow-y'], 'scroll-indicators-hidden': ['scrollbar-width'], 'scroll-bounce': ['overscroll-behavior-x', 'overscroll-behavior-y'] },
  lower: ({ box, el }) => {
    const x = scrolls(box.style.overflowX);
    const y = scrolls(box.style.overflowY);
    if (box.kind !== 'box' || !(x || y)) return [];
    const none = (p: Longhand): boolean => {
      const v = el === null ? null : (el.props.get(p) as ResolvedValue).value;
      return v !== null && v.kind === 'keyword' && v.value === 'none';
    };
    const bounceX = !none('overscroll-behavior-x');
    const bounceY = !none('overscroll-behavior-y');
    return [
      { kind: 'scroll-container', x, y },
      ...(none('scrollbar-width') ? [{ kind: 'scroll-indicators-hidden' } as const] : []),
      ...((x && !bounceX) || (y && !bounceY) ? [{ kind: 'scroll-bounce', bounceX, bounceY } as const] : []),
    ];
  },
};
