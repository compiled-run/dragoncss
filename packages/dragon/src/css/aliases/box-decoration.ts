// box-decoration-break's legacy name (aliases.ts). Chrome 145 lists -webkit-box-decoration-break as a surrogate_for
// box-decoration-break, not an alias_for (css_properties.json5 lines 6425-6429): the two share one ComputedStyle field, take the same
// keywords, and the later declaration wins between them in the cascade, as between an alias and its property
// (packages/parity/test/box-decoration-parse.test.ts pins both against Chrome). Neither is direction-aware, so Dragon resolves it as an alias.
import type { BOX_DECORATION_LONGHANDS } from '../properties/box-decoration.ts';

export const BOX_DECORATION_ALIASES = {
  '-webkit-box-decoration-break': 'box-decoration-break',
} as const satisfies { readonly [alias: string]: (typeof BOX_DECORATION_LONGHANDS)[number] };
