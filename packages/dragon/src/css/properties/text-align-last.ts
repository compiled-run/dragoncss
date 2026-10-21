// text-align-last (css-text-3 §7.2): auto | start | end | left | right | center | justify, inherited, initial auto. It aligns the
// last line of a block container and each line before a forced break. The engine aligns every line by text-align, with a justified
// block's last line at start, which is text-align-last: auto; analysis/text-align-last.ts accepts another value only where it puts
// those lines where auto does, and refuses the rest on every target.
import type { PropertyAspect } from '../properties.ts';

export const TEXT_ALIGN_LAST_LONGHANDS = ['text-align-last'] as const;
export const TEXT_ALIGN_LAST_SHORTHANDS = [] as const;
export const TEXT_ALIGN_LAST_INHERITED: readonly (typeof TEXT_ALIGN_LAST_LONGHANDS)[number][] = ['text-align-last'];
export const TEXT_ALIGN_LAST_CONTAINER: readonly (typeof TEXT_ALIGN_LAST_LONGHANDS)[number][] = [];
export const TEXT_ALIGN_LAST_TEXT_ROLE: readonly (typeof TEXT_ALIGN_LAST_LONGHANDS)[number][] = ['text-align-last'];

export const TEXT_ALIGN_LAST_ASPECTS: { readonly [P in (typeof TEXT_ALIGN_LAST_LONGHANDS)[number]]: PropertyAspect } = {
  'text-align-last': { layout: true, paint: false },
};
