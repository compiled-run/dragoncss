// Fixture group text-fill-stroke (TXT-FX, compat §5). text-fill-stroke-initial: -webkit-text-fill-color at currentcolor under
// several colours, and zero-width strokes in other colours through the longhands and the -webkit-text-stroke shorthand, inherited,
// and on a flex row, in Ahem, both directions; Chrome draws each as it draws the text without them. text-fill-stroke-colors: fill
// colours other than currentcolor (a hex, transparent, hsl(), inherited, reset to currentColor under a fill, over a background, on
// an inline box and a flex row) and a currentcolor underline beneath a filled text, which Chrome paints in the decorating box's
// fill; iOS and Android fill the glyphs in the program's text colour (packages/parity/test/text-fill-color.test.ts).
// text-stroke-ahem: strokes 1px to 8px wide in explicit and currentcolor colours, inherited, over a background, on wrapped and
// touching lines and on inline boxes, and a transparent one, which iOS and Android stroke after each line's fill
// (packages/parity/test/text-stroke.test.ts). The reject: a stroke width keyword, which Chrome scales with the font.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const TEXT_FILL_STROKE: readonly FixtureSpec[] = [
  both('text-fill-stroke-initial'),
  both('text-fill-stroke-colors'),
  layout('text-stroke-ahem', ['ltr', 'rtl']),
  reject('reject-text-stroke-width', 'DRAGON_UNSUPPORTED_VALUE', 'thin', '-webkit-text-stroke-width: thin over text f:text0 is unsupported on'),
];
