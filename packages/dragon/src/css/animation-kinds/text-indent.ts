// How the text-indent family's longhand animates in Chrome 145 (animation-kinds.ts).
import { UNADMITTED, type AnimationKind } from './kinds.ts';
import type { TEXT_INDENT_LONGHANDS } from '../properties/text-indent.ts';

export const TEXT_INDENT_ANIMATION: { readonly [P in (typeof TEXT_INDENT_LONGHANDS)[number]]: AnimationKind } = {
  // TXT2-h: Chrome interpolates text-indent as a length; no runtime writer re-lays out text yet.
  'text-indent': UNADMITTED,
};
