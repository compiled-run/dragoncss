// Fixture group color-scheme (css-color-adjust-1 §2.1): color-scheme where it recolours nothing, in Ahem, both directions, on bordered
// and padded boxes with backgrounds and author colours: light on the root, dark, light dark, only dark in another ASCII case, dark
// light, a custom name beside dark, var(), light only, normal, the CSS-wide keywords, an <a> without href and a flex row, so every
// target proves them. The rejects: dark above a link, whose UA colour it lightens, and light dark on the root, whose canvas and text
// colour it darkens under a dark preference.
import type { FixtureSpec } from '../fixtures.ts';
import { layout, reject } from './define.ts';

export const COLOR_SCHEME: readonly FixtureSpec[] = [
  layout('color-scheme-plain', ['ltr', 'rtl']),
  reject('reject-color-scheme-link', 'DRAGON_UNSUPPORTED_VALUE', 'color-scheme: dark', 'color-scheme: dark on <a> l is unsupported'),
  reject('reject-color-scheme-root', 'DRAGON_UNSUPPORTED_VALUE', 'light dark', 'color-scheme: light dark on <html> html is unsupported'),
];
