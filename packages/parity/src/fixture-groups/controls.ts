// Fixture group controls (FORM-a, T052): A3 buttons painted as CSS boxes, as block containers that centre their contents safely
// and size to their content in block flow, as flex items, and as flex containers, in both directions; the button type changing
// nothing; Chrome's appearance display adjustment (an li with appearance: auto is a block, with no marker). The rejects name what
// A3 refuses: a themed button (FORM-b), an inline-level one (RF-INL), the UA control font, an absolutely positioned button, an
// auto-width flex button in block flow, and an inline element that appearance makes inline-block.
import type { FixtureSpec } from '../fixtures.ts';
import { both, reject } from './define.ts';

export const CONTROLS: readonly FixtureSpec[] = [
  both('controls-button-block'),
  both('controls-button-flex'),
  both('controls-button-demo'),
  both('controls-button-type'),
  both('controls-appearance-display'),
  reject('reject-controls-button-theme', 'DRAGON_UNSUPPORTED_VALUE', '<button data-dragon-id="b">XX</button>', '<button> b with appearance: auto and no author background or border is painted by the platform theme'),
  reject('reject-controls-button-inline', 'DRAGON_UNSUPPORTED_VALUE', '<button data-dragon-id="b">XX</button>', 'display: inline-block on <button> b makes it an inline-level control'),
  reject('reject-controls-button-font', 'DRAGON_UNSUPPORTED_FONT', '<button data-dragon-id="b">XX</button>', '<button> b uses Chrome\'s user-agent control font'),
  reject('reject-controls-button-abspos', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on <button> b is not supported on a form control'),
  reject('reject-controls-button-flex-width', 'DRAGON_UNSUPPORTED_VALUE', '<button data-dragon-id="b">XX</button>', '<button> b is a flex button with an auto width in block flow'),
  both('controls-range-block'),
  both('controls-range-flex'),
  reject('reject-controls-range-theme', 'DRAGON_UNSUPPORTED_VALUE', '<input data-dragon-id="r" type="range">', '<input type=range> r is painted by the platform theme'),
  reject('reject-controls-range-inline', 'DRAGON_UNSUPPORTED_VALUE', '<input data-dragon-id="r" type="range">', 'display: inline-block on <input> r makes it an inline-level control'),
  reject('reject-controls-input-text', 'DRAGON_UNSUPPORTED_ELEMENT', '<input data-dragon-id="r" type="text">', '<input> r of type text is not supported'),
  reject('reject-controls-range-flex-direction', 'DRAGON_UNSUPPORTED_VALUE', 'column', 'flex-direction: column on <input type=range> r is not supported'),
  reject('reject-controls-range-thumb-abspos', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on <div> r::thumb inside <input> r'),
  reject('reject-controls-range-part-direction', 'DRAGON_UNSUPPORTED_VALUE', 'rtl', 'direction on the track of <input> r is not supported'),
  reject('reject-controls-range-pseudo-state', 'DRAGON_UNSUPPORTED_SELECTOR', ':hover', null),
  reject('reject-controls-appearance-inline', 'DRAGON_UNSUPPORTED_VALUE', '<span data-dragon-id="s" class="a">XX</span>', 'display: inline-block on <span> s makes it an inline-level box'),
];
