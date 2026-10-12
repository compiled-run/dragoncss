// Fixture group casc-property: @property registrations decided at build time as Chrome 145 registers them
// (css-properties-values-api-1 §2-§3): initial values, inherits: false, invalid at computed-value time, the last valid rule winning,
// and typed values substituted into lengths, colours, flex-grow and order; the forms Dragon does not compute are refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CASC_PROPERTY: readonly FixtureSpec[] = [
  both('casc-property'),
  reject('reject-property-syntax-list', 'DRAGON_UNSUPPORTED_AT_RULE', '@property --x { syntax: "<length>+"; inherits: true; initial-value: 1px; }', '@property --x is not supported: syntax "<length>+" is not supported'),
  reject('reject-property-relative-value', 'DRAGON_UNSUPPORTED_VALUE', ' 2em', '--x: 2em is unsupported: --x is registered with syntax "<length>"'),
  reject('reject-property-transition', 'DRAGON_UNSUPPORTED_VALUE', 'width 1s, --x 1s', 'transition is unsupported here: it transitions --x'),
];
