// Fixture group text-decoration (TDEC-a, notes/T148J-tdec.md): the values every target refuses. Decorated text is drawn on web
// only until TDEC-b, so the decorated cases are in the web-only lane (fixture-groups/fonts.ts) and the decoration capture.
import type { FixtureSpec } from '../fixtures.ts';
import { reject } from './define.ts';

export const TEXT_DECORATION: readonly FixtureSpec[] = [
  reject('reject-text-decoration-wavy', 'DRAGON_UNSUPPORTED_VALUE', 'wavy', 'text-decoration: text-decoration-style: wavy is drawn by TDEC-c'),
  reject('reject-text-decoration-from-font', 'DRAGON_UNSUPPORTED_VALUE', 'from-font', 'text-decoration-thickness: text-decoration-thickness: from-font reads'),
  reject('reject-text-decoration-blink', 'DRAGON_UNSUPPORTED_VALUE', 'blink', 'text-decoration-line: blink is not drawn'),
  reject('reject-text-decoration-position-under', 'DRAGON_UNSUPPORTED_VALUE', 'under', 'text-underline-position: text-underline-position: under is drawn by TDEC-c'),
  reject('reject-text-decoration-skip-ink-all', 'DRAGON_CSS_INVALID_VALUE', 'all', '"all" is not a valid value for text-decoration-skip-ink: Chrome 145 does not parse'),
];
