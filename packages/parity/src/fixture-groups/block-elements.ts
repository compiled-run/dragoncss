// Fixture group block-elements: the block-level HTML elements with Chrome 145's user-agent defaults (p, h1-h6, the sectioning
// elements, lists as blocks, blockquote, figure, figcaption, address, hr, dl, dt, dd, form, pre, and the phrasing code), margin collapsing between them, and the
// precise refusals of the defaults Dragon does not model.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const BLOCK_ELEMENTS: readonly FixtureSpec[] = [
  both('block-elements-defaults'),
  both('block-elements-text'),
  layout('block-elements-font-size'),
  both('block-elements-margin-collapse'),
  // form is a block-level element whose only Chrome 145 UA values are display: block and unicode-bidi: isolate.
  both('block-elements-form'),
  reject('reject-ua-li-marker', 'DRAGON_UNSUPPORTED_VALUE', '<li data-dragon-id="li" class="a"></li>', 'display: list-item on <li> li'),
  reject('reject-ua-nested-list', 'DRAGON_UNSUPPORTED_ELEMENT', '<ul data-dragon-id="inner" class="a"></ul>', '<ul> inner inside <ol> outer'),
  reject('reject-ua-hr-inset', 'DRAGON_UNSUPPORTED_VALUE', '<hr data-dragon-id="hr"></hr>', 'border-top-style, border-right-style, border-bottom-style, border-left-style: inset'),
  reject('reject-ua-min-font-size', 'DRAGON_UNSUPPORTED_VALUE', '<h6 data-dragon-id="i" class="a"></h6>', 'font-size: 4.812208000000001px on <h6> i'),
  // code and pre compile with an author font-family; Chrome's UA monospace is sized at Chrome's fixed font size, which Dragon does
  // not model (computed-checks.ts checkMonospaceUa). ltr only, and no code inside a pre: the engine refuses preserved white space
  // in an rtl block (UAX #9 L1) and around inline boxes, as for the white-space fixtures.
  layout('code-pre'),
  reject('reject-element-pre', 'DRAGON_UNSUPPORTED_FONT', '<pre data-dragon-id="pre" class="a"></pre>', "<pre> pre uses Chrome's user-agent font-family: monospace"),
  reject('reject-ua-monospace-code', 'DRAGON_UNSUPPORTED_FONT', '<code data-dragon-id="c" class="a">X</code>', "<code> c uses Chrome's user-agent font-family: monospace"),
];
