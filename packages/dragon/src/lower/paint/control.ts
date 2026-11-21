// FORM-b select S3: a menulist-button select's drop-down arrow on the native targets, in the select's used color. The box and the
// shown option's label are the border, background and text modules', as for any box.
import type { Rgba8 } from '../../css/color.ts';
import { usedColors } from './colors.ts';
import type { PaintLowering } from './types.ts';
import { ProgramError } from './types.ts';

export type ControlWrite = { readonly kind: 'select-arrow'; readonly color: Rgba8 };

const ARROW_PAINT = "Dragon strokes the arrow in the select's box view after every layout: the translated paint.ts menuListArrows gives the open three-point path of layout controls.ts menuListArrow in device px from the snapped border box and whole device px borders, stroked 2 device px wide, antialiased, with butt caps and miter joins, after the background and before the inset shadow and border";

export const CONTROL_LOWERING: PaintLowering<ControlWrite> = {
  name: 'control',
  vocabulary: {
    uikit: { 'select-arrow': { key: 'dragonSelectArrow', technique: 'dragon-owned-paint', detail: `DragonBoxView arrow path (verb-coded, device px from the view), stroke width in device px and colour (sRGB RGBA8). ${ARROW_PAINT}` } },
    'android-views': { 'select-arrow': { key: 'dragonSelectArrow', technique: 'dragon-owned-paint', detail: `DragonBoxView arrow path (verb-coded, device px from the view), stroke width in device px and colour (sRGB RGBA8). ${ARROW_PAINT}` } },
  },
  css: { 'select-arrow': ['appearance', 'color'] },
  lower: ({ box, el }) => {
    if (box.kind !== 'control' || box.control.kind !== 'select-menulist' || box.control.arrowWidth === 0) return [];
    if (el === null) throw new ProgramError(`${box.id}: a menulist-button select with no element has no arrow colour`);
    return [{ kind: 'select-arrow', color: usedColors(el).color }];
  },
};
