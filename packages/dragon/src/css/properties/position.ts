// Display, positioning scheme and insets (css-display-3, css-position-3).
import type { PropertyAspect } from '../properties.ts';

export const POSITION_LONGHANDS = ['display', 'position', 'top', 'right', 'bottom', 'left'] as const;
export const POSITION_SHORTHANDS = [] as const;
export const POSITION_INHERITED: readonly (typeof POSITION_LONGHANDS)[number][] = [];
export const POSITION_CONTAINER: readonly (typeof POSITION_LONGHANDS)[number][] = [];
export const POSITION_TEXT_ROLE: readonly (typeof POSITION_LONGHANDS)[number][] = [];

export const POSITION_ASPECTS: { readonly [P in (typeof POSITION_LONGHANDS)[number]]: PropertyAspect } = {
  display: { layout: true, paint: false },
  position: { layout: true, paint: false },
  top: { layout: true, paint: false },
  right: { layout: true, paint: false },
  bottom: { layout: true, paint: false },
  left: { layout: true, paint: false },
};
