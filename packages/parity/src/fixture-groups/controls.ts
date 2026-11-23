// Fixture group controls (FORM-a, T052): A3 buttons painted as CSS boxes, as block containers that centre their contents safely
// and size to their content in block flow, as flex items, and as flex containers, in both directions; the button type changing
// nothing; Chrome's appearance display adjustment (an li with appearance: auto is a block, with no marker). The rejects name what
// A3 refuses: a themed button (FORM-b), an inline-level one (RF-INL), the UA control font, an absolutely positioned button, an
// auto-width flex button in block flow, and an inline element that appearance makes inline-block. A fieldset lays out its rendered
// legend in its block-start border (HTML §15.3.13); the rejects name the legend cutout paint, a non-block fieldset and the UA groove.
// FORM-b adds a single select with appearance: none or devolved to menulist-button, and refuses a list box, a themed menulist, a
// shrink-to-fit width and an optgroup.
import type { FixtureSpec } from '../fixtures.ts';
import { both, layout, reject } from './define.ts';

export const CONTROLS: readonly FixtureSpec[] = [
  both('controls-button-block'),
  both('fieldset-legend'),
  both('fieldset-positioned'),
  reject('reject-fieldset-positioned-bottom', 'DRAGON_UNSUPPORTED_VALUE', '0', 'bottom on the absolutely positioned b reads its containing block, the anonymous contents box of <fieldset> f'),
  reject('reject-fieldset-positioned-calc', 'DRAGON_UNSUPPORTED_VALUE', 'calc(100% - 10px)', 'height on the absolutely positioned b reads its containing block, the anonymous contents box of <fieldset> f'),
  reject('reject-fieldset-positioned-legend', 'DRAGON_UNSUPPORTED_VALUE', '0', 'top on the absolutely positioned b reads its containing block, the contents of <fieldset> f'),
  reject('reject-fieldset-grid-item', 'DRAGON_UNSUPPORTED_VALUE', '<fieldset data-dragon-id="f" class="f"></fieldset>', '<fieldset> f is a grid item'),
  reject('reject-fieldset-legend-contents', 'DRAGON_UNSUPPORTED_VALUE', '2px', 'the top border of <fieldset> f with the rendered legend <legend> l'),
  reject('reject-fieldset-legend-border', 'DRAGON_UNSUPPORTED_VALUE', '2px', 'the top border of <fieldset> f with the rendered legend <legend> l'),
  reject('reject-fieldset-display', 'DRAGON_UNSUPPORTED_VALUE', 'flex', 'display: flex on <fieldset> f is not laid out yet'),
  reject('reject-ua-fieldset-groove', 'DRAGON_UNSUPPORTED_VALUE', '<fieldset data-dragon-id="f"></fieldset>', 'border-top-style, border-right-style, border-bottom-style, border-left-style: groove'),
  both('controls-button-flex'),
  // GRID-items: block buttons (contents centred in a stretched area) and flex buttons (plain flex boxes) as grid items.
  both('grid-button-block'),
  both('grid-button-flex'),
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
  layout('controls-text-field'),
  // FIELD-font-width FW1: a field in a face Dragon does not measure, accepted natively only where its width never reads its intrinsic
  // width. ltr only, as controls-text-field: an rtl field's editor keeps its white space in an rtl block (DRAGON_UNSUPPORTED_BIDI).
  layout('controls-text-field-font-definite'),
  layout('controls-textarea'),
  layout('controls-text-field-search'),
  // FORM-checkbox: a themed checkbox, 13px unless sized, as a block and a flex item (the notes form's row), checked
  // and not, under a dark and a light accent; the rejects name what the slice does not draw.
  both('controls-checkbox'),
  reject('reject-checkbox-inline', 'DRAGON_UNSUPPORTED_VALUE', 'inline-block', 'display: inline-block on <input> c makes it an inline-level control'),
  reject('reject-checkbox-appearance', 'DRAGON_UNSUPPORTED_VALUE', 'none', 'appearance: none on <input type=checkbox> c is not supported'),
  reject('reject-checkbox-padding', 'DRAGON_UNSUPPORTED_VALUE', '3px', 'padding-top: 3px on <input type=checkbox> c is not supported'),
  reject('reject-checkbox-accent-alpha', 'DRAGON_UNSUPPORTED_VALUE', 'rgb(0 0 0 / 0.5)', 'a translucent accent-color on <input type=checkbox> c'),
  reject('reject-checkbox-disabled', 'DRAGON_UNSUPPORTED_ATTRIBUTE', '<input data-dragon-id="c" type="checkbox" disabled="">', 'attribute disabled on c is not supported'),
  reject('reject-checkbox-stretch', 'DRAGON_UNSUPPORTED_VALUE', '<input data-dragon-id="c" type="checkbox">', '<input type=checkbox> c with width: auto is stretched by its flex container'),
  reject('reject-checkbox-radio', 'DRAGON_UNSUPPORTED_ELEMENT', '<input data-dragon-id="c" type="radio">', '<input> c of type radio is not supported'),
  both('controls-select-none'),
  both('controls-select-button'),
  layout('controls-select-label'),
  both('controls-select-natural-width'),
  reject('reject-controls-select-multiple', 'DRAGON_UNSUPPORTED_ELEMENT', '<select data-dragon-id="s" multiple=""><option data-dragon-id="o">A</option></select>', '<select multiple> s is a list box, which waits for the FORM-b listbox package'),
  reject('reject-controls-select-appearance', 'DRAGON_UNSUPPORTED_VALUE', '<select data-dragon-id="s"><option data-dragon-id="o">A</option></select>', '<select> s with appearance: auto and no author background, border or box-shadow is Chrome\'s themed menulist'),
  reject('reject-controls-select-width', 'DRAGON_UNSUPPORTED_VALUE', '<select data-dragon-id="s" data-dragon-listed-options=""><option data-dragon-id="o">A</option></select>', 'width: auto on <select> s is not supported: Chrome sizes a select to its widest option'),
  reject('reject-controls-select-optgroup', 'DRAGON_UNSUPPORTED_ELEMENT', '<optgroup data-dragon-id="g"><option data-dragon-id="o">A</option></optgroup>', '<optgroup> g is not supported: an option group waits for FORM-b select'),
  // GRID-items: a range stays refused as a grid item; a fieldset's refusal is reject-fieldset-grid-item.
  reject('reject-grid-control-range', 'DRAGON_UNSUPPORTED_VALUE', '<input data-dragon-id="r" type="range">', '<input> r is a grid item, and a form control as a grid item is not supported yet'),
  reject('reject-controls-range-theme', 'DRAGON_UNSUPPORTED_VALUE', '<input data-dragon-id="r" type="range">', '<input type=range> r is painted by the platform theme'),
  reject('reject-controls-range-inline', 'DRAGON_UNSUPPORTED_VALUE', '<input data-dragon-id="r" type="range">', 'display: inline-block on <input> r makes it an inline-level control'),
  reject('reject-controls-input-password', 'DRAGON_UNSUPPORTED_ELEMENT', '<input data-dragon-id="r" type="password" value="XX">', '<input type=password> r is not supported'),
  reject('reject-controls-range-flex-direction', 'DRAGON_UNSUPPORTED_VALUE', 'column', 'flex-direction: column on <input type=range> r is not supported'),
  reject('reject-controls-range-thumb-abspos', 'DRAGON_UNSUPPORTED_VALUE', 'absolute', 'position: absolute on <div> r::thumb inside <input> r'),
  reject('reject-controls-range-part-direction', 'DRAGON_UNSUPPORTED_VALUE', 'rtl', 'direction on the track of <input> r is not supported'),
  reject('reject-controls-range-pseudo-state', 'DRAGON_UNSUPPORTED_SELECTOR', ':hover', null),
  reject('reject-controls-appearance-inline', 'DRAGON_UNSUPPORTED_VALUE', '<span data-dragon-id="s" class="a">XX</span>', 'display: inline-block on <span> s makes it an inline-level box'),
];
