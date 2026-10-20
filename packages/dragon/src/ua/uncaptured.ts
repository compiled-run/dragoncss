// The longhands no captured UA table holds, apart from the dataset (datasets.ts) so the capture script can read them too.
import { TEXT_DECORATION_LONGHANDS } from '../css/properties/text-decoration.ts';

/**
 * The text fill and stroke colours (TXT-FX): no UA rule sets them, and Chrome's getComputedStyle resolves their initial currentcolor
 * to the element's color, so a captured row would pin a literal colour that no longer follows color. They keep their initial value.
 */
export const TEXT_FILL_STROKE_COLOR_LONGHANDS = ['-webkit-text-fill-color', '-webkit-text-stroke-color'] as const;

/** The longhands the UA text-font rows set: no captured table holds them, so they are not in computed or userAgentDeclared. */
export const TEXT_FONT_LONGHANDS = ['font-weight', 'font-style'] as const;

/**
 * The longhands no captured UA table holds: the text-font rows', font-synthesis's (no UA rule sets it; its initial is auto) and the
 * text-decoration ones (the a:any-link rule is read from the unmodelled capture, TDEC-a) and the text fill and stroke colours.
 */
export const UNCAPTURED_LONGHANDS = [...TEXT_FONT_LONGHANDS, 'font-synthesis-weight', 'font-synthesis-style', 'font-synthesis-small-caps', ...TEXT_DECORATION_LONGHANDS, ...TEXT_FILL_STROKE_COLOR_LONGHANDS] as const;
