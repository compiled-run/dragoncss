// Fixture group aliases (ALIAS): every legacy -webkit- alias Dragon resolves (packages/dragon/src/css/aliases.ts), alone and in
// the same rule as its property in both orders (the logical ones in both directions), so Chrome's computed values prove the alias is its property.
// The reject pins a value Chrome parses with -webkit-transform's legacy rules (UseAliasParsing: a unitless perspective()), which stays refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const ALIASES: readonly FixtureSpec[] = [
  layout('alias-flex'),
  both('alias-logical'),
  layout('alias-paint'),
  reject('reject-alias-legacy-parsing', 'DRAGON_UNSUPPORTED_VALUE', 'perspective(100)', '-webkit-transform: perspective(100) is unsupported: Chrome parses -webkit-transform with legacy rules'),
];
