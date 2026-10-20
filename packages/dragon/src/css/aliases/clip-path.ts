// The clip-path family's legacy alias (aliases.ts): Chrome 145 css_properties.json5 alias_for. ClipPath's parse ignores
// UseAliasParsing, so -webkit-clip-path parses as clip-path (every value measured alike in packages/parity/test/clip-shape-parse.test.ts).
import type { CLIP_PATH_LONGHANDS } from '../properties/clip-path.ts';

export const CLIP_PATH_ALIASES = {
  '-webkit-clip-path': 'clip-path',
} as const satisfies { readonly [alias: string]: (typeof CLIP_PATH_LONGHANDS)[number] };
