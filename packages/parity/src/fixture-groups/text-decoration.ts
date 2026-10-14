// Fixture group text-decoration (TDEC-a, notes/T148J-tdec.md): the values every target refuses, and text-decoration-native (TDEC-b),
// the decorations iOS and Android draw, proven on device pixels by the decoration points (paint-samples/text-decoration.ts): Ahem
// solid underlines (skip-ink none, crossing the glyphs; skip-ink auto at 15px, clipped round them), a line-through, px and percent
// thicknesses and offsets, an overline, a transparent line and an inline box's underline, in both directions. The other decorated
// cases are in the web-only lane (fixture-groups/fonts.ts), where the decoration capture proves every decoration pixel.
// text-decoration-native-current: currentcolor lines (implicit and written) in the decorating box's colour, and none, which draws
// nothing of its own and leaves a decorated parent's line on the child's text.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const TEXT_DECORATION: readonly FixtureSpec[] = [
  both('text-decoration-native'),
  both('text-decoration-native-current'),
  reject('reject-text-decoration-wavy', 'DRAGON_UNSUPPORTED_VALUE', 'wavy', 'text-decoration: text-decoration-style: wavy is drawn by TDEC-c'),
  reject('reject-text-decoration-from-font', 'DRAGON_UNSUPPORTED_VALUE', 'from-font', 'text-decoration-thickness: text-decoration-thickness: from-font reads'),
  reject('reject-text-decoration-blink', 'DRAGON_UNSUPPORTED_VALUE', 'blink', 'text-decoration-line: blink is not drawn'),
  reject('reject-text-decoration-position-under', 'DRAGON_UNSUPPORTED_VALUE', 'under', 'text-underline-position: text-underline-position: under is drawn by TDEC-c'),
  reject('reject-text-decoration-skip-ink-all', 'DRAGON_CSS_INVALID_VALUE', 'all', '"all" is not a valid value for text-decoration-skip-ink: Chrome 145 does not parse'),
];
