// The paint value hook (PNT1): the paint families whose values are more than one token (border radii, and later shadows,
// outlines and colour schemes) parse their own values, with the checks Chrome's parser makes beyond the webref grammar. The parse
// driver (stylesheet.ts parseValue) calls the parser of a property named here after the grammar check, for a value that is not a
// CSS-wide keyword.
import type { CssNode } from 'css-tree';
import type { Span } from '../types.ts';
import { CLIP_PATH_VALUE_PARSERS } from './properties/clip-path.ts';
import { CLIP_RECT_VALUE_PARSERS } from './properties/clip-rect.ts';
import { EFFECTS_VALUE_PARSERS, parseOpacityValue } from './properties/effects.ts';
import { FILTER_VALUE_PARSERS } from './properties/filter.ts';
import { FONT_VARIANT_VALUE_PARSERS } from './properties/font-variant.ts';
import { FONT_TUNING_VALUE_PARSERS } from './properties/font-tuning.ts';
import { FONT_STRETCH_VALUE_PARSERS } from './properties/font-stretch.ts';
import { FONT_FEATURES_VALUE_PARSERS } from './properties/font-features.ts';
import { LINE_CLAMP_VALUE_PARSERS } from './properties/line-clamp.ts';
import { OUTLINE_VALUE_PARSERS } from './properties/outline.ts';
import { LOGICAL_RADIUS_VALUE_PARSERS, RADIUS_VALUE_PARSERS } from './properties/radius.ts';
import { RESIZE_VALUE_PARSERS } from './properties/resize.ts';
import { SELECTION_VALUE_PARSERS } from './properties/selection.ts';
import { parseBoxShadow } from './properties/shadow.ts';
import { TEXT_SHADOW_VALUE_PARSERS } from './properties/text-shadow.ts';
import { TEXT_TRANSFORM_VALUE_PARSERS } from './properties/text-transform.ts';
import { TOUCH_ACTION_VALUE_PARSERS } from './properties/touch-action.ts';
import { VISIBILITY_VALUE_PARSERS } from './properties/visibility.ts';
import { parseBorderRadius, parseWebkitBorderRadius } from './shorthands/radius.ts';
import type { ParsedValue } from './stylesheet.ts';

export type PaintValueParser = (tokens: readonly CssNode[], base: Span) => ParsedValue;

/** Registration point (PNT1): the paint value parsers by property, one entry per family property. */
export const PAINT_VALUE_PARSERS: ReadonlyMap<string, PaintValueParser> = new Map<string, PaintValueParser>([
  ...Object.entries(RADIUS_VALUE_PARSERS),
  ['border-radius', parseBorderRadius],
  ['-webkit-border-radius', parseWebkitBorderRadius],
  ...Object.entries(LOGICAL_RADIUS_VALUE_PARSERS),
  ...Object.entries(EFFECTS_VALUE_PARSERS),
  // SVG-opacity: fill-opacity and stroke-opacity take opacity's <opacity-value>.
  ['fill-opacity', (tokens, base) => parseOpacityValue('fill-opacity', tokens, base)],
  ['stroke-opacity', (tokens, base) => parseOpacityValue('stroke-opacity', tokens, base)],
  ['box-shadow', parseBoxShadow],
  ...Object.entries(OUTLINE_VALUE_PARSERS),
  ...Object.entries(VISIBILITY_VALUE_PARSERS),
  ...Object.entries(SELECTION_VALUE_PARSERS),
  ...Object.entries(RESIZE_VALUE_PARSERS),
  ...Object.entries(TEXT_TRANSFORM_VALUE_PARSERS),
  ...Object.entries(LINE_CLAMP_VALUE_PARSERS),
  ...Object.entries(FONT_VARIANT_VALUE_PARSERS),
  ...Object.entries(FONT_TUNING_VALUE_PARSERS),
  ...Object.entries(FONT_STRETCH_VALUE_PARSERS),
  ...Object.entries(FONT_FEATURES_VALUE_PARSERS),
  ...Object.entries(TEXT_SHADOW_VALUE_PARSERS),
  ...Object.entries(FILTER_VALUE_PARSERS),
  ...Object.entries(TOUCH_ACTION_VALUE_PARSERS),
  ...Object.entries(CLIP_RECT_VALUE_PARSERS),
  ...Object.entries(CLIP_PATH_VALUE_PARSERS),
]);
