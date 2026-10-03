// Fixture group color-scheme (PNT1, css-color-adjust-1 §2): a dark body with light, "light dark", "dark light", only, custom-ident,
// normal, inherit, initial and var() values on elements with explicit colours, in both environment directions; the used scheme
// changes no supported colour there. A dark root, whose canvas and initial colour Chrome resolves dark, is refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const COLOR_SCHEME: readonly FixtureSpec[] = [
  both('color-scheme-basic'),
  reject('color-scheme-reject-root', 'DRAGON_UNSUPPORTED_VALUE', 'dark', 'the root html has a dark used color scheme'),
];
