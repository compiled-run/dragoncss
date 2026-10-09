// Fixture group controls (FORM-a, T052): A3 buttons painted as CSS boxes, as block containers that centre their contents safely
// and size to their content in block flow, as flex items, and as flex containers, in both directions; the button type changing
// nothing; the inherited longhands Chrome's UA rules reset on a button (line-height: normal, color: ButtonText) under an ancestor
// that sets them; Chrome's appearance display adjustment (an li with appearance: auto is a block, with no marker). The rejects name what
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
  both('controls-button-inherit'),
  reject('reject-controls-button-theme', 'DRAGON_UNSUPPORTED_VALUE', '<button data-dragon-id="b">XX</button>', '<button> b with appearance: auto and no author background or border is painted by the platform theme'),
  reject('reject-controls-button-inline', 'DRAGON_UNSUPPORTED_VALUE', '<button data-dragon-id="b">XX</button>', 'display: inline-block on <button> b makes it an inline-level control'),
  reject('reject-controls-button-font', 'DRAGON_UNSUPPORTED_FONT', '<button data-dragon-id="b">XX</button>', '<button> b uses Chrome\'s user-agent control font'),
  reject('reject-controls-button-abspos', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on <button> b is not supported on a form control'),
  reject('reject-controls-button-flex-width', 'DRAGON_UNSUPPORTED_VALUE', '<button data-dragon-id="b">XX</button>', '<button> b is a flex button with an auto width in block flow'),
  reject('reject-controls-appearance-inline', 'DRAGON_UNSUPPORTED_VALUE', '<span data-dragon-id="s" class="a">XX</span>', 'display: inline-block on <span> s makes it an inline-level box'),
];
