// The mask family's legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for (lines 7008-7096 and 9159-9180). MaskImage,
// MaskRepeat and MaskSize ignore UseAliasParsing, MaskPosition uses it only for a use counter, and Mask's none takes no aliased
// component (css_parsing_utils.cc ParseBackgroundOrMask), so those parse alike. MaskClip and MaskOrigin parse the prefixed boxes
// under the alias (ConsumePrefixedBackgroundBox), and MaskComposite the prefixed compositing operators (ConsumePrefixedMaskComposite);
// both take the initial value as the unprefixed parsers do (border-box, and add, measured in packages/parity/test/mask-parse.test.ts),
// and Dragon keeps every other value and refuses it.
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
