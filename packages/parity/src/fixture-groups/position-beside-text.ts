// Fixture group position-beside-text (POSX-IFC): an absolutely positioned child beside text. In a flex or grid container the text
// is an anonymous item and the child takes its static position alone (css-flexbox-1 §4.1, css-grid-2 §9.2), so it lays out; in a
// block container it would sit in the text's inline formatting context, so both checks refuse it (reject-abspos-in-inline in
// milestone-1). The engine lays out an inline-flex or inline-grid box's contents as flex or grid; the compiler still refuses them
// beside text until a page proves them (the reject here).
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const POSITION_BESIDE_TEXT: readonly FixtureSpec[] = [
  both('flex-abspos-beside-text'),
  // A tab bar's cart badge in 1fr tracks and in fixed centred tracks, then static positions under each justify-items and a fixed child.
  both('grid-abspos-beside-text'),
  reject('reject-inline-flex-abspos-beside-text', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on a beside text in p'),
];
