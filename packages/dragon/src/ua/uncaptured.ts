// The longhands no captured UA table holds, apart from the dataset (datasets.ts) so the capture script can read them too.

/** The longhands the UA text-font rows set: no captured table holds them, so they are not in computed or userAgentDeclared. */
export const TEXT_FONT_LONGHANDS = ['font-weight', 'font-style'] as const;

/** The longhands no captured UA table holds: the text-font rows' and font-synthesis's (no UA rule sets it; its initial is auto). */
export const UNCAPTURED_LONGHANDS = [...TEXT_FONT_LONGHANDS, 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps'] as const;
