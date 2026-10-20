// Fixture group aliases (ALIAS): every legacy -webkit- alias Dragon resolves (packages/dragon/src/css/aliases.ts), alone and in
// the same rule as its property in both orders (the logical ones in both directions), so Chrome's computed values prove the alias is its property.
// The reject pins a value Chrome parses with -webkit-transform's legacy rules (UseAliasParsing: a unitless perspective()), which stays refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const ALIASES: readonly FixtureSpec[] = [
  // -webkit-background-clip alone, in both orders with background-clip, after the background shorthand and with !important, on
  // boxes with an opaque solid border and no padding: native refuses a clip that would show what is behind the box (BG2c).
  both('alias-background'),
  layout('alias-flex'),
  // -webkit-font-feature-settings alone, in both orders with font-feature-settings, with !important and inherited, over Ahem text.
  both('alias-font'),
  both('alias-logical'),
  layout('alias-paint'),
  // TXT2-i: -webkit-hyphens is no alias in Chrome 145 (css_properties.json5 lists none for hyphens), which drops it, so Dragon refuses it.
  reject('reject-webkit-hyphens', 'DRAGON_UNSUPPORTED_PROPERTY', '-webkit-hyphens: auto', '-webkit-hyphens is not supported'),
  reject('reject-alias-legacy-parsing', 'DRAGON_UNSUPPORTED_VALUE', 'perspective(100)', '-webkit-transform: perspective(100) is unsupported: Chrome parses -webkit-transform with legacy rules'),
];
