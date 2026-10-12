// Fixture group display-legacy: the display keywords Chrome 145 parses beyond css-display-3. -webkit-flex and -webkit-inline-flex
// lay out as flex and inline-flex; -webkit-box and -webkit-inline-box are refused precisely; run-in, which Chrome drops, is invalid.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const DISPLAY_LEGACY: readonly FixtureSpec[] = [
  both('display-webkit-flex'),
  reject('reject-display-webkit-box', 'DRAGON_UNSUPPORTED_VALUE', '-webkit-box', "display: -webkit-box is unsupported: it selects Chrome's legacy -webkit-box layout"),
  reject('reject-display-webkit-inline-box', 'DRAGON_UNSUPPORTED_VALUE', '-webkit-inline-box', "display: -webkit-inline-box is unsupported: it selects Chrome's legacy -webkit-box layout"),
  reject('reject-display-run-in', 'DRAGON_CSS_INVALID_VALUE', 'run-in'),
];
