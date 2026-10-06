// Fixture group casc-layer: cascade layers decided at build time as Chrome 145 orders them (css-cascade-5 §6.4): a layer-order
// statement, named, nested, dotted and anonymous layers, unlayered rules above every layer, !important reversing the order, @media
// inside a layer, and :host matching nothing in a document (css-scoping-1 §3.2.1); the forms Dragon does not decide are refused.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CASC_LAYER: readonly FixtureSpec[] = [
  both('casc-layer'),
  reject('reject-layer-in-media', 'DRAGON_UNSUPPORTED_AT_RULE', '@layer a { .a { width: 20px; } }', '@layer a in @media first declares a inside a condition'),
  reject('reject-layer-revert-layer', 'DRAGON_UNSUPPORTED_VALUE', 'revert-layer', 'width: revert-layer in a document with cascade layers is unsupported'),
  reject('reject-host-in-argument', 'DRAGON_UNSUPPORTED_SELECTOR', ':host', ':host inside a selector argument is not supported'),
];
