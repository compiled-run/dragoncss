// The mask family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for (lines 7008-7096 and 9159-9180). MaskImage,
// MaskRepeat and MaskSize ignore UseAliasParsing, MaskPosition uses it only for a use counter, and Mask's none takes no aliased
// component (css_parsing_utils.cc ParseBackgroundOrMask), so those parse alike. MaskClip and MaskOrigin parse the prefixed boxes
// under the alias (ConsumePrefixedBackgroundBox), which take border-box as the unprefixed ones do; Dragon keeps every other box
// and refuses it. MaskComposite parses the prefixed compositing operators (ConsumePrefixedMaskComposite), which have no add, so
// aliases.ts legacyAliasRefusal refuses every -webkit-mask-composite value but a CSS-wide keyword.
import type { MASK_LONGHANDS, MASK_SHORTHANDS } from '../properties/mask.ts';

export const MASK_ALIASES = {
  '-webkit-mask': 'mask',
  '-webkit-mask-clip': 'mask-clip',
  '-webkit-mask-composite': 'mask-composite',
  '-webkit-mask-image': 'mask-image',
  '-webkit-mask-origin': 'mask-origin',
  '-webkit-mask-position': 'mask-position',
  '-webkit-mask-repeat': 'mask-repeat',
  '-webkit-mask-size': 'mask-size',
} as const satisfies { readonly [alias: string]: (typeof MASK_LONGHANDS)[number] | (typeof MASK_SHORTHANDS)[number] };
