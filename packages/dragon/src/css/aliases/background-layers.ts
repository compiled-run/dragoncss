// The background-layers family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for (line 9740). BackgroundClip's
// parse ignores UseAliasParsing, so -webkit-background-clip parses as background-clip, text included. -webkit-background-origin and
// -webkit-background-size parse with legacy rules (UseAliasParsing: border, padding and content boxes; one size for both axes), so
// they are not aliases here.
import type { BACKGROUND_LAYERS_LONGHANDS } from '../properties/background-layers.ts';

export const BACKGROUND_LAYERS_ALIASES = {
  '-webkit-background-clip': 'background-clip',
} as const satisfies { readonly [alias: string]: (typeof BACKGROUND_LAYERS_LONGHANDS)[number] };
