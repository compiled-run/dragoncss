// The 3D transform longhands' legacy aliases (aliases.ts): Chrome 145 css_properties.json5 alias_for (lines 9736, 9876, 9880 and
// 9924). The keyword fields and PerspectiveOrigin::ParseSingleValue ignore UseAliasParsing, so those aliases parse and compute exactly
// as their property. Perspective::ParseSingleValue takes a unitless length through -webkit-perspective (UseAliasParsing), which
// aliases.ts legacyAliasRefusal covers.
import type { TRANSFORM_EXTRA_LONGHANDS } from '../properties/transform-extra.ts';

export const TRANSFORM_EXTRA_ALIASES = {
  '-webkit-backface-visibility': 'backface-visibility',
  '-webkit-perspective': 'perspective',
  '-webkit-perspective-origin': 'perspective-origin',
  '-webkit-transform-style': 'transform-style',
} as const satisfies { readonly [alias: string]: (typeof TRANSFORM_EXTRA_LONGHANDS)[number] };
