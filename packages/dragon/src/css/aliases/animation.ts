// The animation family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for. None of them is parsed with
// UseAliasParsing, so each parses exactly as its property.
import type { ANIM_SHORTHANDS, AnimLonghand } from '../properties/animation.ts';

export const ANIMATION_ALIASES = {
  '-webkit-animation': 'animation',
  '-webkit-animation-delay': 'animation-delay',
  '-webkit-animation-direction': 'animation-direction',
  '-webkit-animation-duration': 'animation-duration',
  '-webkit-animation-fill-mode': 'animation-fill-mode',
  '-webkit-animation-iteration-count': 'animation-iteration-count',
  '-webkit-animation-name': 'animation-name',
  '-webkit-animation-play-state': 'animation-play-state',
  '-webkit-animation-timing-function': 'animation-timing-function',
  '-webkit-transition': 'transition',
  '-webkit-transition-delay': 'transition-delay',
  '-webkit-transition-duration': 'transition-duration',
  '-webkit-transition-property': 'transition-property',
  '-webkit-transition-timing-function': 'transition-timing-function',
} as const satisfies { readonly [alias: string]: AnimLonghand | keyof typeof ANIM_SHORTHANDS };
