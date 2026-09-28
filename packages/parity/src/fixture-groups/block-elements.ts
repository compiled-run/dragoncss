// Fixture group block-elements: the block-level HTML elements with Chrome 145's user-agent defaults (p, h1-h6, the sectioning
// elements, lists as blocks, blockquote, figure, figcaption, address, hr, dl, dt, dd), margin collapsing between them, and the
// precise refusals of the defaults Dragon does not model.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const BLOCK_ELEMENTS: readonly FixtureSpec[] = [
  both('block-elements-defaults'),
  both('block-elements-text'),
  layout('block-elements-font-size'),
  both('block-elements-margin-collapse'),
  reject('reject-ua-li-marker', 'DRAGON_UNSUPPORTED_VALUE', '<li data-dragon-id="li" class="a"></li>', 'display: list-item on <li> li'),
  reject('reject-ua-nested-list', 'DRAGON_UNSUPPORTED_ELEMENT', '<ul data-dragon-id="inner" class="a"></ul>', '<ul> inner inside <ol> outer'),
  reject('reject-ua-hr-inset', 'DRAGON_UNSUPPORTED_VALUE', '<hr data-dragon-id="hr"></hr>', 'border-top-style, border-right-style, border-bottom-style, border-left-style: inset'),
  reject('reject-ua-min-font-size', 'DRAGON_UNSUPPORTED_VALUE', '<h6 data-dragon-id="i" class="a"></h6>', 'font-size: 4.812208000000001px on <h6> i'),
  reject('reject-element-pre', 'DRAGON_UNSUPPORTED_ELEMENT', '<pre data-dragon-id="pre" class="a"></pre>', '<pre> pre is not supported'),
];
