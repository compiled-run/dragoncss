// FORM-b select S3: a menulist-button select's drop-down arrow on the native targets, in the select's used color. The box and the
// shown option's label are the border, background and text modules', as for any box. FORM-checkbox: a themed checkbox's two drawings.
import type { Rgba8 } from '../../css/color.ts';
import { isCheckboxType } from '../../analysis/elements/controls.ts';
import type { ResolvedValue } from '../../analysis/resolve.ts';
import type { CheckboxColors } from '../../forms/checkbox.ts';
import { checkboxColors } from '../../forms/checkbox.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ControlWrite = { readonly kind: 'select-arrow'; readonly color: Rgba8 } | { readonly kind: 'checkbox'; readonly checked: boolean; readonly colors: CheckboxColors };

const ARROW_PAINT = "Dragon strokes the arrow in the select's box view after every layout: the translated paint-menulist.ts menuListArrows gives the open three-point path of layout controls.ts menuListArrow in device px from the snapped border box and whole device px borders, stroked 2 device px wide, antialiased, with butt caps and miter joins, after the background and before the inset shadow and border";

const CHECKBOX_PAINT = "Dragon draws the checkbox in its box view on every draw from the translated controls.ts checkboxMarks of the view's device px size: the background round rect, then unchecked the border stroke, or checked the accent round rect and the check's open path, stroked with butt caps and miter joins, antialiased, after the background and before the border. The initial state is the checked attribute's; dragonSetCheckboxChecked sets it from the host and makes it dirty, after which a recompiled checked attribute no longer changes it (HTML §4.10.5.1.15 dirty checkedness)";

export const CONTROL_LOWERING: PaintLowering<ControlWrite> = {
  name: 'control',
  vocabulary: {
    uikit: {
      'select-arrow': { key: 'dragonSelectArrow', technique: 'dragon-owned-paint', detail: `DragonBoxView arrow path (verb-coded, device px from the view), stroke width in device px and colour (sRGB RGBA8). ${ARROW_PAINT}` },
      checkbox: { key: 'dragonCheckbox', technique: 'dragon-owned-paint', detail: `DragonBoxView checkbox state and its five colours (sRGB RGBA8). ${CHECKBOX_PAINT}` },
    },
    'android-views': {
      'select-arrow': { key: 'dragonSelectArrow', technique: 'dragon-owned-paint', detail: `DragonBoxView arrow path (verb-coded, device px from the view), stroke width in device px and colour (sRGB RGBA8). ${ARROW_PAINT}` },
      checkbox: { key: 'dragonCheckbox', technique: 'dragon-owned-paint', detail: `DragonBoxView checkbox state and its five colours (sRGB RGBA8). ${CHECKBOX_PAINT}` },
    },
  },
  css: { 'select-arrow': ['appearance', 'color'], checkbox: ['appearance', 'accent-color'] },
  lower: ({ box, el }) => {
    if ((box.kind === 'box' || (box.kind === 'control' && box.control.kind === 'theme-leaf')) && el !== null && el.element.tag === 'input' && isCheckboxType(el.element.attributes.get('type'))) {
      const accent = (el.props.get('accent-color') as ResolvedValue).value;
      return [{ kind: 'checkbox', checked: el.element.attributes.has('checked'), colors: checkboxColors(accent.kind === 'color' ? accent.value : null, { checkboxLightCheckOnLightAccent: false }) }];
    }
    if (box.kind !== 'control' || box.control.kind !== 'select-menulist' || box.control.arrowWidth === 0) return [];
    if (el === null) throw new ProgramError(`${box.id}: a menulist-button select with no element has no arrow colour`);
    return [{ kind: 'select-arrow', color: usedColors(el).color }];
  },
};
