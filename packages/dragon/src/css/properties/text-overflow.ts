// text-overflow (css-overflow-4 §3.1): clip | ellipsis, the only values Chrome 145 parses (TextOverflowString is a test feature),
// not inherited, initial clip. It draws an ellipsis on each overflowing line of a block container whose overflow is not visible
// (packages/layout/src/truncate.ts), so it is both layout (the truncated fragments) and paint (the ellipsis glyphs).
import type { PropertyAspect } from '../properties.ts';

export const TEXT_OVERFLOW_LONGHANDS = ['text-overflow'] as const;
export const TEXT_OVERFLOW_SHORTHANDS = [] as const;
export const TEXT_OVERFLOW_INHERITED: readonly (typeof TEXT_OVERFLOW_LONGHANDS)[number][] = [];
export const TEXT_OVERFLOW_CONTAINER: readonly (typeof TEXT_OVERFLOW_LONGHANDS)[number][] = [];
export const TEXT_OVERFLOW_TEXT_ROLE: readonly (typeof TEXT_OVERFLOW_LONGHANDS)[number][] = [];

export const TEXT_OVERFLOW_ASPECTS: { readonly [P in (typeof TEXT_OVERFLOW_LONGHANDS)[number]]: PropertyAspect } = {
  'text-overflow': { layout: true, paint: true },
};
