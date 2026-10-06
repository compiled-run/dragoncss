// Fixture group casc: cascade breadth. @supports decided at build time as Chrome 145 decides it (css-conditional-3 §6), and the
// CSS-wide keywords initial, revert and revert-layer (css-cascade-5 §7.3, §7.4); the forms Dragon cannot decide are refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CASC: readonly FixtureSpec[] = [
  both('casc-supports'),
  both('casc-css-wide'),
  reject('reject-supports-selector', 'DRAGON_UNSUPPORTED_AT_RULE', '@supports selector(a > b) { .a { width: 20px; } }', '@supports selector(a > b) in the stylesheet is not supported: selector() is not evaluated'),
  reject('reject-supports-unknown-property', 'DRAGON_UNSUPPORTED_AT_RULE', '@supports (foo: bar) { .a { width: 20px; } }', '@supports (foo: bar) in the stylesheet is not supported: Dragon cannot tell whether Chrome keeps (foo: bar)'),
  reject('reject-supports-mixed-operators', 'DRAGON_UNSUPPORTED_AT_RULE', '@supports (display: flex) and (width: 1px) or (height: 1px) { .a { width: 20px; } }', '@supports (display: flex) and (width: 1px) or (height: 1px) in the stylesheet is not supported: "and" and "or" mixed without parentheses'),
  reject('reject-supports-legacy-value', 'DRAGON_UNSUPPORTED_AT_RULE', '@supports not (height: -webkit-fill-available) { .a { height: 9px; } }', '@supports not (height: -webkit-fill-available) in the stylesheet is not supported: Dragon cannot tell whether Chrome keeps (height: -webkit-fill-available)'),
  reject('reject-supports-in-rule', 'DRAGON_UNSUPPORTED_AT_RULE', '@supports (display: flex) { width: 20px; }', '@supports in a rule block is not supported'),
];
